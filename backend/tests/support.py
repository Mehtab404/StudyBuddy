"""Shared set-up for the tests that call the API through FastAPI's TestClient.

Nothing here needs a MongoDB server, a Groq key or the embedding model:
  - the database is mongomock, an in-memory MongoDB, swapped in through FastAPI's `get_db` dependency
  - Groq and the embedding model are replaced with fakes by the tests that need them

Import this module before anything from `app`, because it makes sure JWT_SECRET exists (app/config.py refuses to load
without one).
"""

import logging
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("JWT_SECRET", "test-only-secret-not-used-anywhere-else-0123456789")

import mongomock  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, models, ratelimit  # noqa: E402
from app.database import get_db  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = "correct horse battery"
NOTES = (
    "The mitochondria is the organelle that produces most of the cell's ATP. "
    "Photosynthesis takes place in the chloroplasts of plant cells. "
    "The nucleus stores the cell's DNA and controls its activity."
)


class ApiTestCase(unittest.TestCase):
    """A fresh empty database, a fresh rate limiter and a TestClient for every test."""

    def setUp(self):
        logging.disable(logging.CRITICAL)  # no request log lines in the test output
        self.addCleanup(logging.disable, logging.NOTSET)
        self.db = mongomock.MongoClient(tz_aware=True)["test"]
        self.db.users.create_index("email", unique=True)
        app.dependency_overrides[get_db] = lambda: self.db
        self.addCleanup(app.dependency_overrides.clear)

        ratelimit.reset()
        self.addCleanup(ratelimit.reset)
        # The embedding model is a ~100 MB download. Pretend there is nothing to embed.
        self.patch(
            "app.chunk_store.embed_document_chunks",
            return_value={"embedding_model": None, "embedding_dim": None, "embedded_count": 0},
        )
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", False)  # the tests that are about limits turn it on
        self.patch_object(auth, "GUEST_EXPIRE_MINUTES", 60)  # the same whatever backend/.env says
        self.client = TestClient(app)
        self._emails = 0

    def patch(self, target: str, *args, **kwargs):
        """mock.patch that is undone when the test ends. Returns the mock."""
        patcher = mock.patch(target, *args, **kwargs)
        started = patcher.start()
        self.addCleanup(patcher.stop)
        return started

    def patch_object(self, obj, name: str, value):
        patcher = mock.patch.object(obj, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def signup(self, email: str | None = None, name: str = "Test User") -> dict:
        """Creates an account. Returns the Authorization header for it, plus the user's id under 'id'."""
        if email is None:
            self._emails += 1
            email = f"user{self._emails}@example.com"
        res = self.client.post("/auth/signup", json={"name": name, "email": email, "password": PASSWORD})
        self.assertEqual(res.status_code, 201, res.text)
        return self._headers(res.json()["access_token"])

    def guest(self) -> dict:
        res = self.client.post("/auth/guest")
        self.assertEqual(res.status_code, 201, res.text)
        return self._headers(res.json()["access_token"])

    def _headers(self, token: str) -> dict:
        user_id = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["id"]
        return {"Authorization": f"Bearer {token}", "id": user_id}

    @staticmethod
    def auth(headers: dict) -> dict:
        """Just the Authorization header, for passing to the client."""
        return {"Authorization": headers["Authorization"]}

    def make_set(self, headers: dict, notes: str = NOTES, **fields) -> dict:
        res = self.client.post("/sets", json={"notes": notes, **fields}, headers=self.auth(headers))
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()

    def add_card(self, headers: dict, note_id: str, status: str = "pending", **fields) -> str:
        """Puts a card straight into the database. Returns its id."""
        from bson import ObjectId

        card = models.new_card(
            note_id=ObjectId(note_id),
            user_id=ObjectId(headers["id"]),
            question=fields.pop("question", "What makes ATP?"),
            answer=fields.pop("answer", "The mitochondria."),
            source=fields.pop("source", "The mitochondria is the organelle that produces most of the cell's ATP."),
            check_status=fields.pop("check_status", "supported"),
            check_reason=fields.pop("check_reason", "ok"),
        )
        card["status"] = status
        card.update(fields)
        return str(self.db.cards.insert_one(card).inserted_id)
