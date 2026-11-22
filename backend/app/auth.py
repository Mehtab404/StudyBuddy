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
    # A password change ends every login made before it, so a stolen token stops working. Tokens count whole seconds,
    # so one made in the same second as the change still passes; the new token the change returns passes too.
    changed = user.get("password_changed_at")
    if changed is not None and payload.get("iat", 0) < int(changed.timestamp()):
        raise unauthorized
    return user


def _taken() -> HTTPException:
    return HTTPException(status_code=409, detail="An account with this email already exists")


def _clean_signup(body: SignupIn, db: Database) -> tuple[str, str]:
    """The normalized email and the trimmed name from a signup form. Raises if the name is blank or the email is in use."""
    email = _normalize_email(body.email)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Please enter your name")
    if db.users.find_one({"email": email}, {"_id": 1}):
        raise _taken()
    return email, name


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupIn, db: Database = Depends(get_db)):
    email, name = _clean_signup(body, db)
    try:
        result = db.users.insert_one(
            {"name": name, "email": email, "password_hash": hasher.hash(body.password), "created_at": now()}
        )
    except DuplicateKeyError:  # two signups with the same email raced past the check above
        raise _taken()
    return TokenOut(access_token=create_access_token(str(result.inserted_id)))


@router.post("/upgrade", response_model=TokenOut)
def upgrade(body: SignupIn, user: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    """Turns the signed-in guest into a real account. It is the same user, so every set, card and chunk the guest made
    stays attached. Returns a new, full-length token, because the guest's own token expires with the guest data."""
    not_a_guest = HTTPException(status_code=409, detail="This account is already registered")
    if not user.get("is_guest"):
        raise not_a_guest
    email, name = _clean_signup(body, db)
    try:
        result = db.users.update_one(
            {"_id": user["_id"], "is_guest": True},  # the filter also stops two upgrades racing each other
            {
                "$set": {"name": name, "email": email, "password_hash": hasher.hash(body.password), "created_at": now()},
                "$unset": {"is_guest": ""},  # no longer a guest, so the clean-up of expired guests skips it
            },
        )
    except DuplicateKeyError:
        raise _taken()
    if result.matched_count == 0:
        raise not_a_guest
    return TokenOut(access_token=create_access_token(str(user["_id"])))


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
_USER_DATA = ("cards", "chunks", "generation_runs", "quiz_attempts", "notes")
_PURGE_EVERY = 10 * 60  # seconds between clean-ups triggered by new guests
_last_purge = 0.0


def delete_users(db: Database, ids: list) -> None:
    """Deletes these accounts together with all their sets, cards, chunks and logs."""
    for name in _USER_DATA:
        db[name].delete_many({"user_id": {"$in": ids}})
    # The account goes last, so a delete that stops half way can be run again
    db.users.delete_many({"_id": {"$in": ids}})


def purge_expired_guests(db: Database) -> int:
    """Deletes guest accounts older than GUEST_EXPIRE_MINUTES together with their sets, cards and chunks."""
    cutoff = now() - timedelta(minutes=GUEST_EXPIRE_MINUTES)
    ids = [u["_id"] for u in db.users.find({"is_guest": True, "created_at": {"$lt": cutoff}}, {"_id": 1})]
    if not ids:
        return 0
    delete_users(db, ids)
    return len(ids)


def _check_current_password(user: dict, password: str) -> None:
    """Raises unless `password` is this user's. A wrong guess counts toward the account's failed-login lockout, so a
    stolen token cannot be used to guess the password.

    A wrong password is a 403, not a 401: the frontend treats every 401 as an expired login and signs the user out."""
    email = user["email"]
    wait = login_blocked_for(email)
    if wait is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Too many wrong passwords for this account. Please wait {(wait + 59) // 60} minutes and try again.",
            headers={"Retry-After": str(wait)},
        )
    try:
        hasher.verify(user.get("password_hash") or _DUMMY_HASH, password)
        ok = user.get("password_hash") is not None
    except (VerificationError, InvalidHashError):
        ok = False
    if not ok:
        record_failed_login(email)
        raise HTTPException(status_code=403, detail="Incorrect password")


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/password", response_model=TokenOut)
def change_password(body: ChangePasswordIn, user: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    """Changes the password. Every other login (token) of this account stops working; the response has a new one."""
    if user.get("is_guest"):
        raise HTTPException(status_code=409, detail="Guest accounts have no password. Create an account first.")
    _check_current_password(user, body.current_password)
    if body.new_password == body.current_password:
        raise HTTPException(status_code=422, detail="Choose a password that is different from the current one")
    db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hasher.hash(body.new_password), "password_changed_at": now()}},
    )
    return TokenOut(access_token=create_access_token(str(user["_id"])))


class DeleteAccountIn(BaseModel):
    password: str | None = Field(default=None, max_length=128)  # not needed for a guest, who has none


@router.post("/delete-account", status_code=204)
def delete_account(body: DeleteAccountIn, user: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    """Permanently deletes the account and everything in it: sets, cards, chunks and logs. It is a POST, not a DELETE,
    because it carries the password in a body."""
    if not user.get("is_guest"):
        _check_current_password(user, body.password or "")
    delete_users(db, [user["_id"]])


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
