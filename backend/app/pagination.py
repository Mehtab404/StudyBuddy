"""Cursor ("keyset") pagination for the list endpoints.

A list is sorted by one field with the document id as tie-breaker. A cursor holds the sort values of the last item of the
page, and the next page is "everything after those values". Unlike skip/offset, this stays correct when items are added
or removed between two requests, and it uses the indexes instead of counting past the skipped rows.

The cursor is an opaque string for the client: it passes back `next_cursor` as `cursor` and never looks inside.
"""

import base64
import binascii
import json
from datetime import datetime, timezone
from typing import Generic, TypeVar

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None  # pass it as `cursor` to get the next page. None: this was the last page
    total: int  # how many items match in all, not just on this page


def encode_cursor(*values) -> str:
    def plain(v):
        if isinstance(v, datetime):
            return {"t": v.isoformat()}
        if isinstance(v, ObjectId):
            return {"o": str(v)}
        return v

    raw = json.dumps([plain(v) for v in values], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str, *types) -> list:
    """The values inside a cursor made by encode_cursor. `types` gives the type each value must have (a type, or a tuple
    of types, one per value). Anything else is the client's mistake, so it answers 422 rather than running a query that
    compares a date with a string."""
    try:
        values = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        if not isinstance(values, list) or len(values) != len(types):
            raise ValueError("wrong shape")
        out = []
        for v, expected in zip(values, types):
            if isinstance(v, dict) and set(v) == {"t"}:
                when = datetime.fromisoformat(v["t"])
                v = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
            elif isinstance(v, dict) and set(v) == {"o"}:
                v = ObjectId(v["o"])
            elif not (v is None or (isinstance(v, (str, int)) and not isinstance(v, bool))):
                raise ValueError("unexpected value")
            if not isinstance(v, expected):
                raise ValueError("wrong type")
            out.append(v)
        return out
    except (ValueError, TypeError, binascii.Error, InvalidId):
        raise HTTPException(status_code=422, detail="Invalid cursor")


def after(field: str, direction: int, value, oid) -> dict:
    """Filter for the items that come after (`value`, `oid`) when sorted by `field` then `_id`, both in `direction`
    (1 ascending, -1 descending).

    `value` may be None for an ascending sort only. That is the due queue, where cards that were never reviewed have no
    date and MongoDB sorts null before every other value."""
    op = "$gt" if direction == 1 else "$lt"
    if value is None:
        if direction != 1:
            raise ValueError("a null sort value is only supported when sorting ascending")
        # Null comes first, so after one null: the nulls with a larger id, then every item that has a value
        return {"$or": [{field: None, "_id": {"$gt": oid}}, {field: {"$ne": None}}]}
    return {"$or": [{field: {op: value}}, {field: value, "_id": {op: oid}}]}


def trim(docs: list, limit: int) -> tuple[list, bool]:
    """Splits what a query asked for with `limit + 1` into (the page, whether there is a next page)."""
    return docs[:limit], len(docs) > limit
