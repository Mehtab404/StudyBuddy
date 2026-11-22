"""The one Groq client the whole app shares, plus helpers for reading its answers.

Building a client for every call threw away its connection pool and gave each call the SDK's default timeout. A single
client keeps connections open between calls and applies one timeout and retry policy everywhere. The client is safe to
use from several threads at once, which the thread pools in studyset.py and flashcards.py rely on.
"""

import json
from functools import lru_cache

import groq
from groq import Groq

from app.config import GROQ_API_KEY, GROQ_MAX_RETRIES, GROQ_TIMEOUT_SECONDS


@lru_cache(maxsize=1)
def get_client() -> Groq:
    return Groq(api_key=GROQ_API_KEY, timeout=GROQ_TIMEOUT_SECONDS, max_retries=GROQ_MAX_RETRIES)


class AIAnswerError(Exception):
    """The AI answered, but not with something we can use. The message is safe to show to the user."""


def json_answer(completion) -> dict:
    """The JSON object a completion contains. Raises AIAnswerError with a plain message if it is cut off or malformed."""
    choice = completion.choices[0]
    if choice.finish_reason == "length":
        # The model ran out of output tokens part-way through, so the JSON is incomplete
        raise AIAnswerError("The AI's answer was cut off. Try again with shorter or fewer notes.")
    try:
        data = json.loads(choice.message.content or "")
    except json.JSONDecodeError:
        raise AIAnswerError("The AI sent back an answer in the wrong format. Please try again.")
    if not isinstance(data, dict):
        raise AIAnswerError("The AI sent back an answer in the wrong format. Please try again.")
    return data


def friendly_message(error: Exception) -> str:
    """What to tell the user about a failed AI call, without exposing internal class names or details."""
    if isinstance(error, AIAnswerError):
        return str(error)
    if isinstance(error, groq.APITimeoutError):
        return "The AI service took too long to answer. Please try again."
    if isinstance(error, groq.RateLimitError):
        return "The AI service is busy right now. Please wait a moment and try again."
    if isinstance(error, groq.BadRequestError) and "json_validate_failed" in str(error):
        # Groq's JSON mode rejects an answer that is cut off or not valid JSON with HTTP 400 instead of returning it
        return "The AI couldn't finish a valid answer. Try again, or use shorter or fewer notes."
    if isinstance(error, groq.APIConnectionError):
        return "Couldn't reach the AI service. Please try again."
    return "The AI service had a problem. Please try again."
