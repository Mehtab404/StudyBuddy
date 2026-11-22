"""A backend for the browser (Playwright) tests: the real API, with a fake database and a fake AI.

    python e2e_server.py [port]        (default port 8100)

  - The database is mongomock, an in-memory MongoDB. It starts empty and is gone when the server stops.
  - Groq and the embedding model are replaced with canned answers, so the tests are free, fast and always the same.
  - Rate limits are off, because a test run makes more sign-ups than a person would.

Never run this against real data or on a public address: it has no real database and the AI answers are made up.
"""

import os
import re
import sys
from unittest import mock

# Set before app.config is imported. These values win over anything in backend/.env.
os.environ["JWT_SECRET"] = "e2e-only-secret-not-used-anywhere-else-0123456789"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["GUEST_EXPIRE_MINUTES"] = "1440"
os.environ["FRONTEND_ORIGIN"] = "http://localhost:3100,http://127.0.0.1:3100"

import anyio.to_thread  # noqa: E402
import mongomock  # noqa: E402
import uvicorn  # noqa: E402

import app.database as database  # noqa: E402

# Everything reads the database through app.database, so swapping it here covers the routes and the start-up code
database.db = mongomock.MongoClient(tz_aware=True)["e2e"]

from app.flashcards import Flashcard, FlashcardsResponse  # noqa: E402
from app.checker import CheckResult  # noqa: E402

SOURCE = "The mitochondria is the organelle that produces most of the cell's ATP."


def fake_chat_json(system: str, user: str, **_kwargs) -> dict:
    """What Groq would answer, chosen by which prompt it was asked."""
    if "revision notes" in system:
        return {
            "topics": [
                {
                    "title": "Cell energy",
                    "explanation": "Cells make energy in the mitochondria.",
                    "key_points": ["The mitochondria makes ATP."],
                    "terms": [{"term": "ATP", "meaning": "the energy molecule"}],
                    "likely_questions": ["What makes ATP?"],
                }
            ]
        }
    if "quiz questions" in system:
        wanted = int(re.search(r"Write (\d+) questions", user).group(1))
        return {
            "questions": [
                {
                    "question": f"Question {i + 1}: what makes ATP?",
                    "options": ["Nucleus", "Mitochondria", "Ribosome", "Vacuole"],  # the right answer is always B
                    "answer_index": 1,
                    "explanation": "The mitochondria makes ATP.",
                    "topic": "Cell energy" if i % 2 == 0 else "Cell parts",
                }
                for i in range(wanted)
            ]
        }
    if "examiner" in system:
        return {
            "title": "Biology mock paper",
            "instructions": ["Answer all questions."],
            "sections": [
                {
                    "name": "Section A",
                    "instructions": "",
                    "questions": [
                        {"number": 1, "question": "What makes ATP?", "marks": 4, "options": [], "answer": "The mitochondria.", "marking_scheme": "4 marks"},
                        {"number": 2, "question": "Where is DNA stored?", "marks": 6, "options": [], "answer": "In the nucleus.", "marking_scheme": "6 marks"},
                    ],
                }
            ],
        }
    raise AssertionError(f"the e2e server has no canned answer for this prompt: {system[:60]!r}")


def fake_generate_flashcards(notes: str, max_cards: int) -> FlashcardsResponse:
    pairs = [("What makes ATP?", "The mitochondria."), ("Where is DNA stored?", "In the nucleus."), ("Where does photosynthesis happen?", "In the chloroplasts.")]
    return FlashcardsResponse(cards=[Flashcard(question=q, answer=a, source=SOURCE) for q, a in pairs[:max_cards]], dropped=0)


class OneAtATime:
    """Runs the routes one at a time. mongomock is not built for several threads at once, and a browser asks for several
    things at the same moment. The first request, or the start-up message, sets the limit."""

    def __init__(self, app):
        self.app = app
        self.limited = False

    async def __call__(self, scope, receive, send):
        if not self.limited:
            anyio.to_thread.current_default_thread_limiter().total_tokens = 1
            self.limited = True
        await self.app(scope, receive, send)


def start(port: int) -> None:
    patches = [
        mock.patch("app.chunk_store.embed_document_chunks", return_value={"embedding_model": None, "embedding_dim": None, "embedded_count": 0}),
        mock.patch("app.studyset.chat_json", side_effect=fake_chat_json),
        mock.patch("app.generate.generate_flashcards", side_effect=fake_generate_flashcards),
        mock.patch("app.generate.check_answers", side_effect=lambda items: [CheckResult("supported", "ok") for _ in items]),
        mock.patch("app.generate.GROQ_API_KEY", "e2e"),
    ]
    for p in patches:
        p.start()
    from app.main import app

    uvicorn.run(OneAtATime(app), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    start(int(sys.argv[1]) if len(sys.argv) > 1 else 8100)
