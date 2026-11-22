"""Per-client request limits, so one person (or a bot) cannot guess passwords or use up the Groq quota.

Sliding window kept in memory: each client gets at most `limit` requests per `window` seconds for each group of routes.
Login and signup are counted per IP address. Everything else is counted per logged-in user (from the token), or per IP
when there is no valid token.

The counts live in this process only. That is fine for one server process; with several workers or servers each one
counts on its own, and a shared store such as Redis would be needed for exact limits.
"""

import logging
import re
import time
from collections import deque
from dataclasses import dataclass

import jwt
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import JWT_SECRET, RATE_LIMIT_ENABLED, TRUSTED_PROXY_HOPS

log = logging.getLogger("ratelimit")


@dataclass(frozen=True)
class Rule:
    name: str
    methods: frozenset[str]
    path: re.Pattern
    limit: int
    window: int  # seconds
    per_user: bool  # False: counted per IP address


_ID = r"[^/]+"
RULES = [
    # Password guessing and mass account creation (including guest accounts)
    Rule("auth", frozenset({"POST"}), re.compile(r"^/auth/(login|signup|guest)$"), limit=10, window=60, per_user=False),
    # Every one of these calls Groq, some several times (ask with fact-checking makes up to 7 calls)
    Rule(
        "ai",
        frozenset({"POST"}),
        re.compile(rf"^(/flashcards(/upload)?|/sets/{_ID}/(ask|revision|quiz|paper|flashcards))$"),
        limit=15,
        window=60,
        per_user=True,
    ),
    # Editing a card's answer re-checks it against its source with Groq. Same name as above, so both share one quota.
    Rule("ai", frozenset({"PATCH"}), re.compile(rf"^/cards/{_ID}$"), limit=15, window=60, per_user=True),
    # Creating sets and rebuilding chunks run the embedding model on the server's CPU
    Rule(
        "indexing",
        frozenset({"POST"}),
        re.compile(rf"^(/sets(/upload)?|/sets/{_ID}/chunks/(rebuild|embed))$"),
        limit=10,
        window=60,
        per_user=True,
    ),
    # Searching a set's chunks embeds the query on the CPU, even though it is a GET
    Rule("indexing", frozenset({"GET"}), re.compile(rf"^/sets/{_ID}/chunks/search$"), limit=10, window=60, per_user=True),
]

# (rule name, client key) -> times of recent requests
_hits: dict[tuple[str, str], deque[float]] = {}
_last_sweep = 0.0
_SWEEP_EVERY = 300  # seconds between removing clients that have gone quiet


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    if TRUSTED_PROXY_HOPS == 0:
        return peer
    # Each proxy appends the address it received the request from, so the visitor's address is the one TRUSTED_PROXY_HOPS
    # places from the right. Entries further left were written by the visitor and could be anything.
    hops = [h.strip() for value in request.headers.getlist("x-forwarded-for") for h in value.split(",") if h.strip()]
    if len(hops) < TRUSTED_PROXY_HOPS:
        return peer  # header missing or too short: the request did not come through the proxy, so use the real peer
    return hops[-TRUSTED_PROXY_HOPS]


def _user_key(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    try:
        return jwt.decode(auth[7:], JWT_SECRET, algorithms=["HS256"])["sub"]
    except (jwt.PyJWTError, KeyError):
        return None  # a bad token is rejected later by the route itself; count it by IP until then


def _sweep(now: float) -> None:
    global _last_sweep
    if now - _last_sweep < _SWEEP_EVERY:
        return
    _last_sweep = now
    longest = max(r.window for r in RULES)
    for key in [k for k, q in _hits.items() if not q or now - q[-1] > longest]:
        del _hits[key]


def check(rule: Rule, key: str, now: float) -> int | None:
    """Records one request. Returns None if it is allowed, or the seconds to wait if the limit is reached."""
    q = _hits.setdefault((rule.name, key), deque())
    while q and now - q[0] >= rule.window:
        q.popleft()
    if len(q) >= rule.limit:
        return max(1, int(rule.window - (now - q[0])) + 1)
    q.append(now)
    return None


def reset() -> None:
    _hits.clear()
    _failed_logins.clear()


# Failed logins per email address. The per-IP limit above can be dodged by an attacker who changes IP (or fakes the
# X-Forwarded-For header behind a proxy); this one cannot, because it counts guesses against the account itself.
FAILED_LOGIN_LIMIT = 10
FAILED_LOGIN_WINDOW = 15 * 60  # seconds
_failed_logins: dict[str, deque[float]] = {}


def _recent_failures(email: str, now: float) -> deque[float]:
    q = _failed_logins.setdefault(email, deque())
    while q and now - q[0] >= FAILED_LOGIN_WINDOW:
        q.popleft()
    if not q:
        _failed_logins.pop(email, None)  # do not keep an entry for every email ever tried
        q = deque()
    return q


def login_blocked_for(email: str) -> int | None:
    """Seconds to wait if this email has had too many failed logins recently, else None."""
    if not RATE_LIMIT_ENABLED:
        return None
    now = time.monotonic()
    q = _recent_failures(email, now)
    if len(q) >= FAILED_LOGIN_LIMIT:
        return max(1, int(FAILED_LOGIN_WINDOW - (now - q[0])) + 1)
    return None


def record_failed_login(email: str) -> None:
    if not RATE_LIMIT_ENABLED:
        return
    now = time.monotonic()
    q = _recent_failures(email, now)
    q.append(now)
    _failed_logins[email] = q
    if len(q) == FAILED_LOGIN_LIMIT:
        log.warning("login locked for 15 minutes after %d failed attempts", FAILED_LOGIN_LIMIT)


async def rate_limit_middleware(request: Request, call_next):
    if not RATE_LIMIT_ENABLED:
        return await call_next(request)

    path = request.url.path.rstrip("/") or "/"
    rule = next((r for r in RULES if request.method in r.methods and r.path.match(path)), None)
    if rule is None:
        return await call_next(request)

    now = time.monotonic()
    _sweep(now)
    user = _user_key(request) if rule.per_user else None
    key = f"user:{user}" if user else f"ip:{_client_ip(request)}"

    wait = check(rule, key, now)
    if wait is not None:
        log.warning("rate limit hit: rule=%s key=%s path=%s", rule.name, key, path)
        return JSONResponse(
            status_code=429,
            content={"detail": f"Too many requests. Please wait {wait} seconds and try again."},
            headers={"Retry-After": str(wait)},
        )
    return await call_next(request)
