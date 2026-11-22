import os

from dotenv import load_dotenv

# Reads backend/.env and puts its values into environment variables
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Model that writes the answers, cards, quizzes and papers (a Groq production model, see console.groq.com/docs/models)
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip()

# Model for the fact-checking reviewer (verify.py). Unset: the same model that writes the answers. A different model is a
# more independent second opinion, and Groq counts the rate limit per model, so the load is split between the two.
REVIEW_MODEL = os.getenv("REVIEW_MODEL") or None

# e.g. mongodb://localhost:27017 or mongodb+srv://user:password@cluster.mongodb.net
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "study_guide")

# Websites allowed to call this API (browser CORS check). Comma-separated, no trailing slash, e.g.
# https://my-frontend.onrender.com. The local dev frontend is always allowed.
FRONTEND_ORIGINS = ["http://localhost:3000"] + [
    o.strip().rstrip("/") for o in os.getenv("FRONTEND_ORIGIN", "").split(",") if o.strip()
]

# The /debug endpoints expose pipeline internals (prompts, chunks, token usage). Off unless explicitly turned on, so a
# deployment never ships them by accident. Set ENABLE_DEBUG=true in backend/.env for local development.
ENABLE_DEBUG = os.getenv("ENABLE_DEBUG", "").strip().lower() in ("1", "true", "yes")

# Per-client request limits (app/ratelimit.py). On unless RATE_LIMIT_ENABLED=false.
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").strip().lower() not in ("0", "false", "no")

# How many reverse proxies sit in front of this app and add to X-Forwarded-For (Render: 1). The visitor's IP for rate
# limits is the entry that many places from the right, because anything further left can be written by the visitor.
# 0 (the default) ignores the header, which is right when nothing sits in front, such as local development.
TRUSTED_PROXY_HOPS = max(0, int(os.getenv("TRUSTED_PROXY_HOPS", "0")))

# Groq calls (app/groq_client.py). A call that gets no answer for this long is abandoned, and a failed call (rate limit,
# server error, dropped connection) is retried at most this many times, so one request cannot hang for minutes.
GROQ_TIMEOUT_SECONDS = float(os.getenv("GROQ_TIMEOUT_SECONDS", "90"))
GROQ_MAX_RETRIES = max(0, int(os.getenv("GROQ_MAX_RETRIES", "3")))

# DEBUG, INFO, WARNING or ERROR
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").strip().upper()

# Signs login tokens. Anyone who knows it can forge a login, so it must be long, random and secret.
JWT_SECRET = os.getenv("JWT_SECRET", "")
if len(JWT_SECRET) < 32:
    raise RuntimeError(
        "JWT_SECRET is missing or too short (need 32+ characters). Generate one with:\n"
        '  python -c "import secrets; print(secrets.token_urlsafe(48))"\n'
        "and add it to backend/.env as JWT_SECRET=..."
    )
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))  # default: 24 hours

# Guest mode: lets anyone try the app without signing up. A guest is a temporary account that, together with
# everything it created, is deleted this long after it was made. Set to 0 to turn guest mode off.
GUEST_EXPIRE_MINUTES = int(os.getenv("GUEST_EXPIRE_MINUTES", "1440"))  # default: 24 hours
