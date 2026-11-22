from pymongo import ASCENDING, MongoClient
from pymongo.database import Database
from pymongo.errors import OperationFailure

from app.config import GENERATION_RUN_TTL_DAYS, MONGODB_DB, MONGODB_URL

# tz_aware so stored datetimes come back as UTC-aware, like the old timezone-aware columns.
# MongoClient connects lazily and pools connections itself.
client = MongoClient(MONGODB_URL, tz_aware=True, serverSelectionTimeoutMS=5000)
db = client[MONGODB_DB]


def get_db() -> Database:
    # The client is shared and thread-safe, so there is nothing to open or close per request
    return db


def _ensure_ttl_index(collection, field: str, days: int):
    """Makes MongoDB delete documents `days` days after their `field` date. Changing the number of days changes the
    existing index in place; creating it again with a different value would fail."""
    seconds = days * 24 * 3600
    try:
        collection.create_index(field, expireAfterSeconds=seconds)
    except OperationFailure:
        collection.database.command(
            "collMod", collection.name, index={"keyPattern": {field: 1}, "expireAfterSeconds": seconds}
        )


def _drop_index_if_exists(collection, name: str):
    """Removes an index that a newer one makes redundant. Does nothing if it is already gone."""
    try:
        collection.drop_index(name)
    except OperationFailure:
        pass


def init_indexes():
    # Safe to run every startup: creating an index that already exists is a no-op
    db.users.create_index("email", unique=True)
    db.users.create_index([("is_guest", ASCENDING), ("created_at", ASCENDING)])  # finding expired guests
    db.notes.create_index([("user_id", ASCENDING), ("created_at", -1)])  # list_sets: a user's sets, newest first
    db.cards.create_index("note_id")
    db.cards.create_index([("user_id", ASCENDING), ("status", ASCENDING), ("created_at", ASCENDING), ("_id", ASCENDING)])
    db.cards.create_index([("user_id", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)])
    db.cards.create_index([("user_id", ASCENDING), ("check_status", ASCENDING)])
    db.generation_runs.create_index([("user_id", ASCENDING), ("created_at", -1)])
    db.generation_runs.create_index("set_id")
    _ensure_ttl_index(db.generation_runs, "created_at", GENERATION_RUN_TTL_DAYS)
    db.chunks.create_index([("document_id", ASCENDING), ("chunk_index", ASCENDING)], unique=True)
    db.chunks.create_index("user_id")
    _drop_index_if_exists(db.notes, "user_id_1")  # covered by the (user_id, created_at) index above
    _drop_index_if_exists(db.cards, "user_id_1_status_1")  # covered by the (user_id, status, created_at, _id) index
