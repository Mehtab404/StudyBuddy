"""The one Groq client the whole app shares.

Building a client for every call threw away its connection pool and gave each call the SDK's default timeout. A single
client keeps connections open between calls and applies one timeout and retry policy everywhere. The client is safe to
use from several threads at once, which the thread pools in studyset.py and flashcards.py rely on.
"""

from functools import lru_cache

from groq import Groq

from app.config import GROQ_API_KEY, GROQ_MAX_RETRIES, GROQ_TIMEOUT_SECONDS


@lru_cache(maxsize=1)
def get_client() -> Groq:
    return Groq(api_key=GROQ_API_KEY, timeout=GROQ_TIMEOUT_SECONDS, max_retries=GROQ_MAX_RETRIES)
