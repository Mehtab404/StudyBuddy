"""Paginated lists: sets, cards, the due queue and chunks, plus the cursor format and the split-out exam papers."""

import base64
import json
import unittest
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import HTTPException

from support import NOTES, ApiTestCase

from app import models
from app.pagination import after, decode_cursor, encode_cursor, trim

BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)


class CursorTests(unittest.TestCase):
    def test_round_trips_every_kind_of_value(self):
        oid = ObjectId()
        when = datetime(2026, 5, 6, 7, 8, 9, 123000, tzinfo=timezone.utc)
        cases = [
            ([when, oid], (datetime, ObjectId)),
            ([None, oid], (type(None), ObjectId)),
            (["2026-01-02", oid], (str, ObjectId)),
            ([7], (int,)),
        ]
        for values, types in cases:
            with self.subTest(values=values):
                self.assertEqual(decode_cursor(encode_cursor(*values), *types), values)

    def test_is_url_safe(self):
        cursor = encode_cursor(datetime.now(timezone.utc), ObjectId())
        self.assertRegex(cursor, r"^[A-Za-z0-9_-]+$")

    def test_a_naive_time_is_read_as_utc(self):
        raw = base64.urlsafe_b64encode(json.dumps([{"t": "2026-01-01T00:00:00"}]).encode()).decode()
        self.assertEqual(decode_cursor(raw, datetime), [datetime(2026, 1, 1, tzinfo=timezone.utc)])

    def test_rejects_anything_that_is_not_a_cursor_of_the_right_size(self):
        good = encode_cursor(BASE, ObjectId())
        wrong_size = encode_cursor(1)
        junk = [
            "",
            "not a cursor",
            "!!!!",
            good[:-3],  # cut off
            wrong_size,  # a one-value cursor where two are needed
            base64.urlsafe_b64encode(b'{"a": 1}').decode(),  # JSON, but not a list
            base64.urlsafe_b64encode(json.dumps([True, True]).encode()).decode(),  # booleans are not values
            base64.urlsafe_b64encode(json.dumps([{"o": "nope"}, 1]).encode()).decode(),  # not an object id
            base64.urlsafe_b64encode(json.dumps([{"x": 1}, 1]).encode()).decode(),  # an unknown tagged value
            base64.urlsafe_b64encode(json.dumps([[1], 1]).encode()).decode(),  # a nested list
            base64.urlsafe_b64encode(json.dumps([{"t": "yesterday"}, 1]).encode()).decode(),  # not a time
            encode_cursor("x", ObjectId()),  # a string where a date is needed
            encode_cursor(BASE, "x"),  # a string where an object id is needed
            encode_cursor(BASE, 5),
            encode_cursor(None, ObjectId()),  # a missing date
        ]
        for cursor in junk:
            with self.subTest(cursor=cursor[:30]):
                with self.assertRaises(HTTPException) as caught:
                    decode_cursor(cursor, datetime, ObjectId)
                self.assertEqual(caught.exception.status_code, 422)

    def test_trim(self):
        self.assertEqual(trim([1, 2, 3], 2), ([1, 2], True))
        self.assertEqual(trim([1, 2], 2), ([1, 2], False))
        self.assertEqual(trim([], 2), ([], False))

    def test_a_null_sort_value_is_only_allowed_ascending(self):
        after("due_date", 1, None, ObjectId())
        with self.assertRaises(ValueError):
            after("created_at", -1, None, ObjectId())


class SetPagingTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.signup()

    def make_sets(self, n: int, user=None) -> list[str]:
        """n sets with created_at one minute apart. Returns their ids, newest first."""
        user = user or self.user
        ids = []
        for i in range(n):
            made = self.make_set(user, subject=f"Set {i}")
            self.db.notes.update_one({"_id": models.parse_id(made["id"])}, {"$set": {"created_at": BASE + timedelta(minutes=i)}})
            ids.append(made["id"])
        return ids[::-1]

    def page(self, cursor=None, limit=None, user=None):
        params = {k: v for k, v in (("cursor", cursor), ("limit", limit)) if v is not None}
        return self.client.get("/sets", params=params, headers=self.auth(user or self.user))

    def walk(self, limit, user=None) -> list[dict]:
        """Every page in turn, until there is no next one."""
        pages, cursor = [], None
        for _ in range(50):
            res = self.page(cursor, limit, user)
            self.assertEqual(res.status_code, 200, res.text)
            pages.append(res.json())
            cursor = pages[-1]["next_cursor"]
            if cursor is None:
                return pages
        self.fail("never reached the last page")

    def test_pages_cover_every_set_once_newest_first(self):
        ids = self.make_sets(5)
        pages = self.walk(2)
        self.assertEqual([len(p["items"]) for p in pages], [2, 2, 1])
        self.assertEqual([s["id"] for p in pages for s in p["items"]], ids)
        self.assertEqual({p["total"] for p in pages}, {5})
        self.assertIsNone(pages[-1]["next_cursor"])

    def test_a_list_that_fits_in_one_page_has_no_cursor(self):
        self.make_sets(2)
        for limit in (2, 3, 50):
            with self.subTest(limit=limit):
                page = self.page(limit=limit).json()
                self.assertEqual((len(page["items"]), page["next_cursor"]), (2, None))

    def test_an_empty_list(self):
        self.assertEqual(self.page().json(), {"items": [], "next_cursor": None, "total": 0})

    def test_the_default_page_is_20(self):
        self.make_sets(21)
        page = self.page().json()
        self.assertEqual((len(page["items"]), page["total"]), (20, 21))
        self.assertIsNotNone(page["next_cursor"])

    def test_sets_with_the_same_time_are_not_skipped_or_repeated(self):
        ids = self.make_sets(5)
        self.db.notes.update_many({}, {"$set": {"created_at": BASE}})  # all tied: only the id can break the tie
        seen = [s["id"] for p in self.walk(2) for s in p["items"]]
        self.assertEqual(sorted(seen), sorted(ids))
        self.assertEqual(len(seen), len(set(seen)))

    def test_a_new_set_between_pages_causes_no_repeat_and_no_gap(self):
        ids = self.make_sets(4)
        first = self.page(limit=2).json()
        newest = self.make_set(self.user, subject="Brand new")  # made after page 1 was fetched
        second = self.page(first["next_cursor"], 2).json()
        self.assertEqual([s["id"] for s in first["items"]] + [s["id"] for s in second["items"]], ids)
        self.assertNotIn(newest["id"], [s["id"] for s in second["items"]])
        self.assertEqual(second["total"], 5)  # the total is current, the page position is not disturbed

    def test_a_set_deleted_between_pages_does_not_break_the_cursor(self):
        ids = self.make_sets(4)
        first = self.page(limit=2).json()
        self.client.delete(f"/sets/{ids[1]}", headers=self.auth(self.user))  # the last one of page 1: the cursor points at it
        second = self.page(first["next_cursor"], 2).json()
        self.assertEqual([s["id"] for s in second["items"]], ids[2:])

    def test_card_counts_are_right_on_every_page(self):
        ids = self.make_sets(4)
        for set_id, n in zip(ids, (1, 0, 3, 2)):
            for _ in range(n):
                self.add_card(self.user, set_id)
        counts = {s["id"]: s["card_count"] for p in self.walk(2) for s in p["items"]}
        self.assertEqual([counts[i] for i in ids], [1, 0, 3, 2])

    def test_only_your_own_sets_are_listed_and_counted(self):
        mine = self.make_sets(3)
        other = self.signup()
        self.make_sets(4, user=other)
        pages = self.walk(2)
        self.assertEqual(pages[0]["total"], 3)
        self.assertEqual([s["id"] for p in pages for s in p["items"]], mine)

    def test_someone_elses_cursor_shows_you_nothing_of_theirs(self):
        self.make_sets(3)
        other = self.signup()
        theirs = self.make_sets(3, user=other)
        cursor = self.page(limit=1, user=other).json()["next_cursor"]
        mine = self.page(cursor, 5).json()  # their cursor, my list
        self.assertFalse({s["id"] for s in mine["items"]} & set(theirs))

    def test_bad_limits_and_cursors_are_422(self):
        for limit in (0, -1, 51, "ten"):
            with self.subTest(limit=limit):
                self.assertEqual(self.page(limit=limit).status_code, 422)
        for cursor in ("garbage", encode_cursor(1), encode_cursor("x", "y")):
            with self.subTest(cursor=cursor):
                self.assertEqual(self.page(cursor).status_code, 422)


class CardPagingTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.set = self.make_set(self.user)

    def card(self, i: int, status="pending", **fields) -> str:
        return self.add_card(
            self.user, self.set["id"], status=status, created_at=BASE + timedelta(minutes=i), question=f"Question {i}?", **fields
        )

    def get(self, status="pending", **params):
        return self.client.get("/cards", params={"status": status, **params}, headers=self.auth(self.user))

    def test_pages_cover_every_card_oldest_first(self):
        ids = [self.card(i) for i in range(5)]
        got, cursor = [], None
        for _ in range(10):
            page = self.get(limit=2, **({"cursor": cursor} if cursor else {})).json()
            got += [c["id"] for c in page["items"]]
            self.assertEqual(page["total"], 5)
            cursor = page["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(got, ids)

    def test_cards_with_the_same_time_are_not_skipped_or_repeated(self):
        ids = [self.card(0) for _ in range(5)]  # identical created_at
        got, cursor = [], None
        for _ in range(10):
            page = self.get(limit=2, **({"cursor": cursor} if cursor else {})).json()
            got += [c["id"] for c in page["items"]]
            cursor = page["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(sorted(got), sorted(ids))
        self.assertEqual(len(got), len(set(got)))

    def test_the_total_counts_only_that_status(self):
        for i in range(3):
            self.card(i)
        for i in range(3, 5):
            self.card(i, status="approved")
        self.assertEqual(self.get("pending").json()["total"], 3)
        self.assertEqual(self.get("approved").json()["total"], 2)
        self.assertEqual(self.get("rejected").json()["total"], 0)

    def test_the_review_queue_shrinks_as_cards_are_resolved(self):
        ids = [self.card(i) for i in range(4)]
        first = self.get(limit=2).json()
        for card in first["items"]:
            self.client.post(f"/cards/{card['id']}/approve", headers=self.auth(self.user))
        again = self.get(limit=2).json()  # no cursor: the next cards have moved up
        self.assertEqual([c["id"] for c in again["items"]], ids[2:])
        self.assertEqual(again["total"], 2)

    def test_the_default_page_is_50_and_the_most_is_100(self):
        for i in range(55):
            self.card(i)
        self.assertEqual(len(self.get().json()["items"]), 50)
        self.assertEqual(self.get(limit=100).status_code, 200)
        self.assertEqual(self.get(limit=101).status_code, 422)
        self.assertEqual(self.get(limit=0).status_code, 422)

    # ---- search ----

    def test_search_looks_in_the_question_answer_and_source_ignoring_case(self):
        q = self.card(1, answer="Plain.", source="Plain source.")
        a = self.card(2, answer="Contains MITOCHONDRIA here.", source="Plain source.")
        s = self.card(3, answer="Plain.", source="The Mitochondria sentence.")
        self.card(4, answer="Nothing relevant.", source="Plain source.")
        self.db.cards.update_one({"_id": models.parse_id(q)}, {"$set": {"question": "What are mitochondria?"}})
        found = self.get(q="mitochondria").json()
        self.assertEqual([c["id"] for c in found["items"]], [q, a, s])
        self.assertEqual(found["total"], 3)

    def test_search_and_paging_work_together(self):
        for i in range(5):
            self.card(i, answer="a zebra fact")
        self.card(9, answer="something else")
        page1 = self.get(q="zebra", limit=2).json()
        page2 = self.get(q="zebra", limit=2, cursor=page1["next_cursor"]).json()
        page3 = self.get(q="zebra", limit=2, cursor=page2["next_cursor"]).json()
        self.assertEqual([len(p["items"]) for p in (page1, page2, page3)], [2, 2, 1])
        self.assertEqual({p["total"] for p in (page1, page2, page3)}, {5})
        self.assertIsNone(page3["next_cursor"])

    def test_search_is_text_not_a_pattern(self):
        self.card(1, answer="a.b")
        self.card(2, answer="axb")
        self.card(3, answer="what (is) this? [ok]")
        self.assertEqual(len(self.get(q="a.b").json()["items"]), 1)  # "." is a dot, not "any character"
        self.assertEqual(len(self.get(q=".*").json()["items"]), 0)
        for text in ("(", "[", "\\", "(is)", "?", "a{2", "*"):
            with self.subTest(text=text):
                self.assertEqual(self.get(q=text).status_code, 200)
        self.assertEqual(len(self.get(q="(is)").json()["items"]), 1)

    def test_an_empty_or_blank_search_means_no_filter(self):
        for i in range(3):
            self.card(i)
        for q in ("", "   "):
            self.assertEqual(self.get(q=q).json()["total"], 3)

    def test_search_does_not_cross_status_or_user(self):
        self.card(1, answer="secret pending", status="pending")
        self.card(2, answer="secret approved", status="approved")
        other = self.signup()
        self.add_card(other, self.make_set(other)["id"], status="approved", answer="secret theirs")
        self.assertEqual([c["answer"] for c in self.get("approved", q="secret").json()["items"]], ["secret approved"])

    def test_a_search_longer_than_200_characters_is_422(self):
        self.assertEqual(self.get(q="x" * 201).status_code, 422)

    def test_bad_cursors_are_422(self):
        for cursor in ("garbage", encode_cursor(1), encode_cursor(True, "x")):
            with self.subTest(cursor=cursor):
                self.assertEqual(self.get(cursor=cursor).status_code, 422)


class DueQueuePagingTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.set = self.make_set(self.user)

    def card(self, due_date=None, **fields) -> str:
        return self.add_card(self.user, self.set["id"], status="approved", due_date=due_date, **fields)

    def due(self, **params):
        return self.client.get("/quiz/due", params=params, headers=self.auth(self.user))

    def test_pages_run_from_never_reviewed_cards_into_dated_ones_without_a_gap(self):
        new = [self.card() for _ in range(3)]
        old = [self.card(due_date=f"2020-01-0{i}") for i in range(1, 4)]
        got, sizes, cursor = [], [], None
        for _ in range(10):
            page = self.due(limit=2, **({"cursor": cursor} if cursor else {})).json()
            got += [c["id"] for c in page["items"]]
            sizes.append(len(page["items"]))
            self.assertEqual(page["total"], 6)
            cursor = page["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(sizes, [2, 2, 2])  # the second page holds the last new card and the first dated one
        self.assertEqual(got[:3], sorted(new))  # new cards first, in id order
        self.assertEqual(got[3:], old)  # then by date

    def test_dated_cards_with_the_same_day_are_not_skipped_or_repeated(self):
        ids = [self.card(due_date="2020-01-01") for _ in range(5)]
        got, cursor = [], None
        for _ in range(10):
            page = self.due(limit=2, **({"cursor": cursor} if cursor else {})).json()
            got += [c["id"] for c in page["items"]]
            cursor = page["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(sorted(got), sorted(ids))

    def test_a_card_that_becomes_not_due_between_pages_does_not_upset_the_cursor(self):
        ids = [self.card() for _ in range(4)]
        first = self.due(limit=2).json()
        for card in first["items"]:  # study the first page
            self.client.post(f"/cards/{card['id']}/review", json={"knew": True}, headers=self.auth(self.user))
        second = self.due(limit=2, cursor=first["next_cursor"]).json()
        self.assertEqual([c["id"] for c in second["items"]], sorted(ids)[2:])
        self.assertEqual(second["total"], 2)

    def test_after_a_session_the_first_page_holds_the_next_cards(self):
        for _ in range(5):
            self.card()
        studied = {c["id"] for c in self.due(limit=3).json()["items"]}
        for card_id in studied:
            self.client.post(f"/cards/{card_id}/review", json={"knew": True}, headers=self.auth(self.user))
        next_page = self.due(limit=3).json()
        self.assertEqual((len(next_page["items"]), next_page["total"]), (2, 2))
        self.assertFalse(studied & {c["id"] for c in next_page["items"]})

    def test_cards_not_yet_due_are_not_counted(self):
        self.card()
        self.card(due_date="2999-01-01")
        self.assertEqual(self.due().json()["total"], 1)

    def test_bad_limits_and_cursors_are_422(self):
        self.assertEqual(self.due(limit=0).status_code, 422)
        self.assertEqual(self.due(limit=101).status_code, 422)
        self.assertEqual(self.due(cursor="garbage").status_code, 422)


class ChunkPagingTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.set = self.make_set(self.user, notes=NOTES * 30)
        self.url = f"/sets/{self.set['id']}/chunks"

    def get(self, **params):
        return self.client.get(self.url, params=params, headers=self.auth(self.user))

    def test_pages_cover_every_chunk_in_order(self):
        total = self.get(limit=500).json()["total"]
        self.assertGreater(total, 4)
        indexes, cursor = [], None
        for _ in range(100):
            page = self.get(limit=3, **({"cursor": cursor} if cursor else {})).json()
            self.assertEqual(page["total"], total)
            self.assertLessEqual(len(page["chunks"]), 3)
            self.assertIsNotNone(page["chunking"])
            indexes += [c["chunk_index"] for c in page["chunks"]]
            cursor = page["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(indexes, list(range(total)))

    def test_everything_fits_in_the_default_page_for_a_normal_set(self):
        page = self.get().json()
        self.assertIsNone(page["next_cursor"])
        self.assertEqual(len(page["chunks"]), page["total"])

    def test_content_can_still_be_left_out(self):
        page = self.get(include_content="false", limit=2).json()
        self.assertTrue(all(c["content"] is None for c in page["chunks"]))

    def test_rebuild_reports_the_total_too(self):
        res = self.client.post(self.url + "/rebuild", json={"chunk_size": 300, "chunk_overlap": 50}, headers=self.auth(self.user))
        body = res.json()
        self.assertEqual(body["total"], body["chunking"]["chunk_count"])
        self.assertEqual(len(body["chunks"]) + (0 if body["next_cursor"] is None else 1) > 0, True)

    def test_bad_limits_and_cursors_are_422(self):
        for params in ({"limit": 0}, {"limit": 501}, {"cursor": "garbage"}, {"cursor": encode_cursor("x")}, {"cursor": encode_cursor(1, 2)}):
            with self.subTest(params=params):
                self.assertEqual(self.get(**params).status_code, 422)

    def test_nobody_else_can_page_through_your_chunks(self):
        other = self.signup()
        self.assertEqual(self.client.get(self.url, params={"limit": 2}, headers=self.auth(other)).status_code, 404)


def fake_paper(*marks):
    questions = [{"number": i + 1, "question": f"Q{i + 1}", "marks": m, "options": [], "answer": "a", "marking_scheme": "m"} for i, m in enumerate(marks)]
    return {"title": "Mock paper", "instructions": ["Answer all"], "sections": [{"name": "A", "instructions": "", "questions": questions}]}


class PaperSplitTests(ApiTestCase):
    """GET /sets/{id} lists papers without their questions. One paper is loaded in full when it is opened."""

    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.set = self.make_set(self.user)
        self.chat = self.patch("app.studyset.chat_json", return_value=fake_paper(4, 6))

    def make_paper(self, user=None, marks=10):
        res = self.client.post(f"/sets/{self.set['id']}/paper", json={"total_marks": marks}, headers=self.auth(user or self.user))
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_the_set_lists_summaries_not_questions(self):
        detail = self.make_paper()
        [summary] = detail["papers"]
        self.assertEqual(
            set(summary), {"id", "created_at", "title", "total_marks", "duration_minutes", "question_count"}
        )
        self.assertEqual((summary["title"], summary["total_marks"], summary["question_count"]), ("Mock paper", 10, 2))
        self.assertNotIn("sections", summary)
        self.assertNotIn("sections", json.dumps(self.client.get(f"/sets/{self.set['id']}", headers=self.auth(self.user)).json()))

    def test_a_paper_loads_in_full_on_its_own(self):
        [summary] = self.make_paper()["papers"]
        res = self.client.get(f"/sets/{self.set['id']}/paper/{summary['id']}", headers=self.auth(self.user))
        self.assertEqual(res.status_code, 200)
        paper = res.json()
        self.assertEqual(paper["id"], summary["id"])
        self.assertEqual([q["question"] for s in paper["sections"] for q in s["questions"]], ["Q1", "Q2"])
        self.assertEqual(paper["sections"][0]["questions"][0]["answer"], "a")
        self.assertEqual(paper["instructions"], ["Answer all"])

    def test_each_summary_belongs_to_its_own_paper(self):
        self.make_paper(marks=10)
        self.chat.return_value = fake_paper(10, 10, 10, 10, 10, 10, 10, 10, 10, 10)
        papers = self.make_paper(marks=100)["papers"]
        self.assertEqual([p["question_count"] for p in papers], [2, 10])
        self.assertEqual([p["total_marks"] for p in papers], [10, 100])

    def test_unknown_missing_and_deleted_papers_are_404(self):
        [summary] = self.make_paper()["papers"]
        base = f"/sets/{self.set['id']}/paper"
        self.assertEqual(self.client.get(f"{base}/nope", headers=self.auth(self.user)).status_code, 404)
        self.client.delete(f"{base}/{summary['id']}", headers=self.auth(self.user))
        self.assertEqual(self.client.get(f"{base}/{summary['id']}", headers=self.auth(self.user)).status_code, 404)

    def test_nobody_else_can_read_your_paper(self):
        [summary] = self.make_paper()["papers"]
        other = self.signup()
        res = self.client.get(f"/sets/{self.set['id']}/paper/{summary['id']}", headers=self.auth(other))
        self.assertEqual(res.status_code, 404)
        self.assertNotIn("Q1", res.text)

    def test_deleting_a_paper_returns_the_remaining_summaries(self):
        self.make_paper()
        papers = self.make_paper()["papers"]
        res = self.client.delete(f"/sets/{self.set['id']}/paper/{papers[0]['id']}", headers=self.auth(self.user))
        self.assertEqual([p["id"] for p in res.json()["papers"]], [papers[1]["id"]])
        self.assertNotIn("sections", res.json()["papers"][0])

    def test_papers_saved_by_an_older_version_still_summarise(self):
        old = {
            "id": "abc",
            "created_at": models.now(),
            "title": "Old paper",
            "total_marks": 5,
            "instructions": [],
            "sections": [{"name": "A", "instructions": "", "questions": [{"number": 1, "question": "q", "marks": 5, "options": [], "answer": "", "marking_scheme": ""}]}],
        }  # no duration_minutes key at all
        self.db.notes.update_one({"_id": models.parse_id(self.set["id"])}, {"$set": {"papers": [old]}})
        [summary] = self.client.get(f"/sets/{self.set['id']}", headers=self.auth(self.user)).json()["papers"]
        self.assertEqual((summary["duration_minutes"], summary["question_count"]), (None, 1))


if __name__ == "__main__":
    unittest.main()
