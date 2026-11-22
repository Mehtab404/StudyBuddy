"""Quiz results: what a student answered, and what that says about their weak spots.

  POST /sets/{id}/quiz/attempts    save one finished run through some quiz questions
  GET  /sets/{id}/quiz/progress    recent scores, accuracy per topic, and the questions still being missed

Every attempt keeps a copy of the questions it asked, with the options and the right answer. So the history stays
readable after the set's quiz is replaced with a new one, and "practise the ones you missed" works from what was stored.

The client reports which option was picked for each question. The server works out what was right and wrong, but cannot
check that the questions were really in the quiz. That is fine here: the numbers only describe the student's own
practice, and nobody else sees them.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, StrictInt
from pymongo.database import Database

from app import models
from app.auth import get_current_user
from app.database import get_db
from app.studyset import QuizQuestion, _get_set

router = APIRouter(prefix="/sets/{set_id}/quiz", tags=["quiz results"])

MAX_ANSWERS = 30  # as many questions as a quiz can have
MAX_ATTEMPTS_PER_SET = 100  # the oldest attempts beyond this are deleted, so a set's history cannot grow without limit
RECENT_ATTEMPTS = 10
MAX_MISSED = 30

Short = Annotated[str, Field(max_length=500)]


class AnswerIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    options: list[Short] = Field(min_length=4, max_length=4)
    # Strict: a string such as "1", or true, is a mistake and not a position
    answer_index: StrictInt = Field(ge=0, le=3)  # the right option
    chosen_index: StrictInt = Field(ge=0, le=3)  # the option the student picked
    explanation: str = Field(default="", max_length=2000)
    topic: str = Field(default="", max_length=100)


class AttemptIn(BaseModel):
    answers: list[AnswerIn] = Field(min_length=1, max_length=MAX_ANSWERS)


class AttemptOut(BaseModel):
    id: str
    created_at: datetime
    score: int  # answers that were right
    total: int  # questions answered


class TopicStat(BaseModel):
    topic: str
    answered: int
    correct: int


class Progress(BaseModel):
    attempts: int  # how many are stored (at most MAX_ATTEMPTS_PER_SET)
    recent: list[AttemptOut]  # newest first
    topics: list[TopicStat]  # weakest first. Only questions that came with a topic count
    missed: list[QuizQuestion]  # questions whose latest answer was wrong, most recently missed first


def _attempt_out(doc: dict) -> AttemptOut:
    return AttemptOut(id=str(doc["_id"]), created_at=doc["created_at"], score=doc["score"], total=doc["total"])


@router.post("/attempts", response_model=AttemptOut, status_code=201)
def save_attempt(set_id: str, body: AttemptIn, db: Database = Depends(get_db), user: dict = Depends(get_current_user)):
    doc = _get_set(db, set_id, user)
    answers = [{**a.model_dump(), "correct": a.chosen_index == a.answer_index} for a in body.answers]
    attempt = {
        "user_id": user["_id"],
        "set_id": doc["_id"],
        "created_at": models.now(),
        "score": sum(1 for a in answers if a["correct"]),
        "total": len(answers),
        "answers": answers,
    }
    attempt["_id"] = db.quiz_attempts.insert_one(attempt).inserted_id

    # Keep only the newest MAX_ATTEMPTS_PER_SET
    extra = db.quiz_attempts.count_documents({"set_id": doc["_id"]}) - MAX_ATTEMPTS_PER_SET
    if extra > 0:
        oldest = db.quiz_attempts.find({"set_id": doc["_id"]}, {"_id": 1}).sort([("created_at", 1), ("_id", 1)]).limit(extra)
        db.quiz_attempts.delete_many({"_id": {"$in": [a["_id"] for a in oldest]}})
    return _attempt_out(attempt)


@router.get("/progress", response_model=Progress)
def get_progress(set_id: str, db: Database = Depends(get_db), user: dict = Depends(get_current_user)):
    doc = _get_set(db, set_id, user)
    attempts = list(db.quiz_attempts.find({"set_id": doc["_id"]}).sort([("created_at", -1), ("_id", -1)]))

    topics: dict[str, list[int]] = {}  # topic -> [answered, correct]
    latest: dict[str, dict] = {}  # question text -> its most recent answer
    for attempt in attempts:  # newest first, so the first time a question is seen is its latest answer
        for a in attempt["answers"]:
            if a.get("topic"):
                counts = topics.setdefault(a["topic"], [0, 0])
                counts[0] += 1
                counts[1] += 1 if a["correct"] else 0
            latest.setdefault(a["question"], a)

    stats = [TopicStat(topic=t, answered=n, correct=c) for t, (n, c) in topics.items()]
    stats.sort(key=lambda s: (s.correct / s.answered, -s.answered, s.topic))  # lowest accuracy first
    missed = [a for a in latest.values() if not a["correct"]][:MAX_MISSED]  # dicts keep the order they were added in
    return Progress(
        attempts=len(attempts),
        recent=[_attempt_out(a) for a in attempts[:RECENT_ATTEMPTS]],
        topics=stats,
        missed=[QuizQuestion(**{k: a[k] for k in ("question", "options", "answer_index", "explanation", "topic")}) for a in missed],
    )
