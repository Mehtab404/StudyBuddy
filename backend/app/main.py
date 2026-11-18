import logging
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pymongo.database import Database
from starlette.middleware.base import BaseHTTPMiddleware

from app.auth import get_current_user, router as auth_router
from app.cards import router as cards_router
from app.ask import router as ask_router
from app.chunks_api import router as chunks_router
from app.config import ENABLE_DEBUG, FRONTEND_ORIGINS, GROQ_API_KEY, LOG_LEVEL
from app.database import get_db, init_indexes
from app.debug import router as debug_router
from app.generate import router as generate_router
from app.quiz import router as quiz_router
from app.ratelimit import rate_limit_middleware
from app.studyset import router as studyset_router

# Without this, the app's own loggers (chunk_store, trace, ratelimit, ...) print nothing below WARNING
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Collections are created on first write; indexes (incl. unique email) are created here
    init_indexes()
    log.info("started (debug endpoints %s)", "ON" if ENABLE_DEBUG else "off")
    yield


app = FastAPI(title="AI Study Guide", lifespan=lifespan)


async def log_requests(request: Request, call_next):
    """One line per request: method, path, status, time taken. Never logs bodies, tokens or query strings."""
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        # Full traceback goes to the server log; the user only gets a generic message
        log.exception("unhandled error: %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Something went wrong on the server. Please try again."})
    ms = (time.perf_counter() - start) * 1000
    level = logging.WARNING if response.status_code >= 500 else logging.INFO
    log.log(level, "%s %s -> %d (%.0f ms)", request.method, request.url.path, response.status_code, ms)
    return response


# Order matters: the middleware added last runs first. CORS must be outermost so that 429 and 500 responses still
# carry CORS headers; otherwise the browser hides them and the frontend shows "Can't reach the server".
app.add_middleware(BaseHTTPMiddleware, dispatch=rate_limit_middleware)
app.add_middleware(BaseHTTPMiddleware, dispatch=log_requests)

# Lets the Next.js frontend (localhost:3000, or FRONTEND_ORIGIN when deployed) call this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(generate_router)
app.include_router(cards_router)
app.include_router(quiz_router)
app.include_router(studyset_router)
app.include_router(chunks_router)
app.include_router(ask_router)
if ENABLE_DEBUG:
    app.include_router(debug_router)


@app.get("/")
def root():
    return {"message": "AI Study Guide API is running"}


class CheckStats(BaseModel):
    checked: int
    supported: int
    flagged: int
    flagged_rate: float  # 0.0 - 1.0, 0 when nothing has been checked


@app.get("/stats/checks", response_model=CheckStats)
def check_stats(db: Database = Depends(get_db), user: dict = Depends(get_current_user)):
    """Your hallucination-check results across every checked card (including rejected ones)."""
    rows = {
        row["_id"]: row["n"]
        for row in db.cards.aggregate(
            [
                {"$match": {"user_id": user["_id"], "check_status": {"$ne": None}}},
                {"$group": {"_id": "$check_status", "n": {"$sum": 1}}},
            ]
        )
    }
    supported, flagged = rows.get("supported", 0), rows.get("flagged", 0)
    checked = supported + flagged
    return CheckStats(checked=checked, supported=supported, flagged=flagged, flagged_rate=flagged / checked if checked else 0.0)


@app.get("/health")
def health():
    # Only reports whether the key exists - never return the key itself
    return {"status": "ok", "groq_key_loaded": bool(GROQ_API_KEY) and not GROQ_API_KEY.startswith(("paste-", "your-"))}
