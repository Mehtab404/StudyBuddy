from datetime import date, datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from pymongo.database import Database

from app.auth import get_current_user
from app.cards import DEFAULT_PAGE, MAX_PAGE, CardOut, _update_card, card_cursor, card_out, get_owned_card
from app.database import get_db
from app.models import CardStatus
from app.pagination import Page, after, decode_cursor, trim
from app.sm2 import next_schedule

router = APIRouter(tags=["quiz"])


class ReviewIn(BaseModel):
    knew: bool
    easy: bool = False  # "I knew it easily": only counts together with knew=true, and raises the card's ease factor


def users_today(client_date: str | None) -> date:
    """The user's calendar day, from the date their browser sends in X-Client-Date (YYYY-MM-DD).

    The server runs on UTC, so its own date is wrong for part of the day for everyone else: a user in India (UTC+5:30)
    would see a card become due at 5:30 am. Local dates are never more than a day away from the UTC date, so anything
    further off, or not a date at all, is ignored and the UTC date is used. The worst a made-up date can do is change
    when the sender's own cards are due.
    """
    utc_today = datetime.now(timezone.utc).date()
    try:
        claimed = date.fromisoformat(client_date or "")
    except ValueError:
        return utc_today
    return claimed if abs((claimed - utc_today).days) <= 1 else utc_today


@router.get("/quiz/due", response_model=Page[CardOut])
def cards_due_today(
    x_client_date: str | None = Header(default=None),
    limit: int = Query(default=DEFAULT_PAGE, ge=1, le=MAX_PAGE),
    cursor: str | None = None,
    db: Database = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Your approved cards that are due today or overdue (never-reviewed cards count as due), one page at a time.

    Reviewing a card moves its due date into the future, so asking for the first page again after a study session gives
    the next cards without a cursor."""
    # ISO date strings compare correctly as text. {"due_date": None} would also match a missing field.
    query = {
        "user_id": user["_id"],
        "status": CardStatus.approved.value,
        "$or": [{"due_date": None}, {"due_date": {"$lte": users_today(x_client_date).isoformat()}}],
    }
    total = db.cards.count_documents(query)
    page_query = query
    if cursor:
        due_date, oid = decode_cursor(cursor, (str, type(None)), ObjectId)
        page_query = {"$and": [query, after("due_date", 1, due_date, oid)]}
    # Mongo sorts null before any string, so never-reviewed cards come first
    docs = list(db.cards.find(page_query).sort([("due_date", 1), ("_id", 1)]).limit(limit + 1))
    docs, more = trim(docs, limit)
    return Page(items=[card_out(d) for d in docs], next_cursor=card_cursor(docs[-1], "due_date") if more else None, total=total)


@router.post("/cards/{card_id}/review", response_model=CardOut)
def review_card(
    card_id: str,
    review: ReviewIn,
    x_client_date: str | None = Header(default=None),
    db: Database = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Records a quiz answer and reschedules the card with SM-2."""
    card = get_owned_card(db, card_id, user)
    if card["status"] != CardStatus.approved.value:
        raise HTTPException(status_code=400, detail="Only approved cards can be quizzed")

    s = next_schedule(
        card["ease_factor"],
        card["interval_days"],
        card["repetitions"],
        review.knew,
        users_today(x_client_date),
        easy=review.easy,
    )
    updated = _update_card(
        db,
        card,
        {
            "ease_factor": s.ease_factor,
            "interval_days": s.interval_days,
            "repetitions": s.repetitions,
            "due_date": s.due_date.isoformat(),
        },
    )
    return card_out(updated)
