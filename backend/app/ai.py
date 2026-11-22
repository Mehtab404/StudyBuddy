import logging

from fastapi import HTTPException

from app.config import GROQ_API_KEY
from app.flashcards import MODEL
from app.groq_client import friendly_message, get_client, json_answer
from app.trace import traced_create

log = logging.getLogger("ai")


def chat_json(system: str, user: str, *, max_tokens: int = 8000, label: str = "chat", model: str | None = None) -> dict:
    """One Groq call that must answer with a JSON object. Raises HTTP 502 if the call or the JSON fails.
    `model` picks another model than the default (Groq limits each model separately)."""
    if not GROQ_API_KEY or GROQ_API_KEY.startswith(("paste-", "your-")):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not set in backend/.env")
    try:
        client = get_client()
        completion = traced_create(
            client,
            label,
            model=model or MODEL,
            temperature=0.2,
            max_completion_tokens=max_tokens,
            reasoning_effort="low",
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        data = json_answer(completion)
    except HTTPException:
        raise
    except Exception as e:
        # The details go to the server log; the user gets a plain message without internal class names
        log.warning("AI call %r failed: %s: %s", label, type(e).__name__, e)
        raise HTTPException(status_code=502, detail=friendly_message(e))
    return data
