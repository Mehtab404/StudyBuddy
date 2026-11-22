from datetime import datetime, timedelta, timezone
import time
import uuid

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app.config import GUEST_EXPIRE_MINUTES, JWT_EXPIRE_MINUTES, JWT_SECRET
from app.database import get_db
from app.models import now, parse_id
from app.ratelimit import login_blocked_for, record_failed_login

ALGORITHM = "HS256"

# Argon2id with the library's recommended defaults. Each hash embeds its own random salt.
hasher = PasswordHasher()
# Verified against when the email is unknown, so "no such user" takes as long as "wrong password"
_DUMMY_HASH = hasher.hash("not-a-real-password")

# Also makes the Authorize button appear on /docs. tokenUrl is where it sends the login form.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: str
    name: str | None = None  # accounts made before names were asked for have none
    created_at: datetime | None = None
    is_guest: bool = False  # a temporary account made by "Continue as guest"


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def create_access_token(user_id: str, minutes: int = JWT_EXPIRE_MINUTES) -> str:
    issued = datetime.now(timezone.utc)
    claims = {
        "sub": user_id,  # who the token is for
        "iat": issued,
        "exp": issued + timedelta(minutes=minutes),  # checked automatically on decode
    }
    return jwt.encode(claims, JWT_SECRET, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Database = Depends(get_db)) -> dict:
    """Dependency for protected routes: verifies the token and loads its user document."""
    unauthorized = HTTPException(
        status_code=401, detail="Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}
    )
    try:
        # Pinning algorithms=[...] stops attackers choosing a weaker one (e.g. "none")
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        user_id = parse_id(payload["sub"])
    except (jwt.PyJWTError, KeyError):
        raise unauthorized
    user = db.users.find_one({"_id": user_id}) if user_id else None
    if user is None:
        raise unauthorized
    return user


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupIn, db: Database = Depends(get_db)):
    email = _normalize_email(body.email)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Please enter your name")
    taken = HTTPException(status_code=409, detail="An account with this email already exists")
    if db.users.find_one({"email": email}, {"_id": 1}):
        raise taken

    try:
        result = db.users.insert_one(
            {"name": name, "email": email, "password_hash": hasher.hash(body.password), "created_at": now()}
        )
    except DuplicateKeyError:  # two signups with the same email raced past the check above
        raise taken
    return TokenOut(access_token=create_access_token(str(result.inserted_id)))


@router.post("/login", response_model=TokenOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Database = Depends(get_db)):
    """Form fields: username (your email) and password. Form-encoded so /docs' Authorize button works."""
    email = _normalize_email(form.username)
    wait = login_blocked_for(email)
    if wait is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed logins for this account. Please wait {(wait + 59) // 60} minutes and try again.",
            headers={"Retry-After": str(wait)},
        )
    user = db.users.find_one({"email": email})

    password_ok = False
    try:
        # Guest accounts have no password, so nothing can match: they only get in through /auth/guest
        stored_hash = user.get("password_hash") if user else None
        hasher.verify(stored_hash or _DUMMY_HASH, form.password)
        password_ok = user is not None and stored_hash is not None
    except (VerificationError, InvalidHashError):
        pass

    if not password_ok:
        record_failed_login(email)
        # Same message whether the email or the password was wrong
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    # Upgrade the stored hash if the library's recommended settings have changed since it was made
    if hasher.check_needs_rehash(user["password_hash"]):
        db.users.update_one({"_id": user["_id"]}, {"$set": {"password_hash": hasher.hash(form.password)}})
    return TokenOut(access_token=create_access_token(str(user["_id"])))


@router.get("/me", response_model=UserOut)
def me(user: dict = Depends(get_current_user)):
    return UserOut(
        id=str(user["_id"]),
        email=user["email"],
        name=user.get("name"),
        created_at=user.get("created_at"),
        is_guest=bool(user.get("is_guest")),
    )


# Collections that hold a user's data, each keyed by user_id
_USER_DATA = ("cards", "chunks", "generation_runs", "notes")
_PURGE_EVERY = 10 * 60  # seconds between clean-ups triggered by new guests
_last_purge = 0.0


def purge_expired_guests(db: Database) -> int:
    """Deletes guest accounts older than GUEST_EXPIRE_MINUTES together with their sets, cards and chunks."""
    cutoff = now() - timedelta(minutes=GUEST_EXPIRE_MINUTES)
    ids = [u["_id"] for u in db.users.find({"is_guest": True, "created_at": {"$lt": cutoff}}, {"_id": 1})]
    if not ids:
        return 0
    for name in _USER_DATA:
        db[name].delete_many({"user_id": {"$in": ids}})
    # The account goes last, so a clean-up that stops half way is retried next time
    db.users.delete_many({"_id": {"$in": ids}})
    return len(ids)


@router.post("/guest", response_model=TokenOut, status_code=201)
def guest(db: Database = Depends(get_db)):
    """Creates a temporary account so anyone can try the app without signing up."""
    global _last_purge
    if GUEST_EXPIRE_MINUTES <= 0:
        raise HTTPException(status_code=404, detail="Guest mode is turned off")

    if time.monotonic() - _last_purge > _PURGE_EVERY:
        _last_purge = time.monotonic()
        purge_expired_guests(db)

    # The email only has to be unique. ".invalid" can never be a real address, and signup rejects it, so no
    # real account can collide with it.
    result = db.users.insert_one(
        {
            "name": "Guest",
            "email": f"guest-{uuid.uuid4().hex}@guest.invalid",
            "is_guest": True,
            "created_at": now(),
        }
    )
    # The token stops working at the same time the guest's data is deleted
    return TokenOut(access_token=create_access_token(str(result.inserted_id), min(JWT_EXPIRE_MINUTES, GUEST_EXPIRE_MINUTES)))
