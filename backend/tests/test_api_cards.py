"""Flashcards over HTTP: generating them, reviewing and editing them, the quiz queue, and who may touch which card."""

import unittest
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from support import NOTES, ApiTestCase

from app import models
from app.checker import CheckResult
from app.flashcards import Flashcard, FlashcardsResponse

ZERO_ID = "0" * 24


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def fake_cards(*questions, dropped=0):
    source = "The mitochondria is the organelle that produces most of the cell's ATP."
    return FlashcardsResponse(
        cards=[Flashcard(question=q, answer=f"Answer to {q}", source=source) for q in questions], dropped=dropped
    )


class CardTestCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.set = self.make_set(self.user)

    def card(self, **fields) -> str:
        return self.add_card(self.user, self.set["id"], **fields)

    def get_card(self, card_id: str) -> dict:
        return models_card(self.db, card_id)


def models_card(db, card_id: str) -> dict:
    return db.cards.find_one({"_id": models.parse_id(card_id)})


class ListAndModerateTests(CardTestCase):
    def test_lists_pending_cards_by_default_oldest_first(self):
        first = self.card(question="first")
        second = self.card(question="second")
        self.card(question="approved one", status="approved")
        res = self.client.get("/cards", headers=self.auth(self.user))
        self.assertEqual([c["id"] for c in res.json()["items"]], [first, second])

    def test_filters_by_status(self):
        self.card(status="approved")
        self.card(status="rejected")
        self.card()
        for status in ("pending", "approved", "rejected"):
            with self.subTest(status=status):
                cards = self.client.get(f"/cards?status={status}", headers=self.auth(self.user)).json()["items"]
                self.assertEqual([c["status"] for c in cards], [status])
        self.assertEqual(self.client.get("/cards?status=bogus", headers=self.auth(self.user)).status_code, 422)

    def test_only_your_own_cards_are_listed(self):
        self.card()
        other = self.signup()
        self.assertEqual(self.client.get("/cards", headers=self.auth(other)).json(), {"items": [], "next_cursor": None, "total": 0})

    def test_approve_and_reject(self):
        card_id = self.card()
        res = self.client.post(f"/cards/{card_id}/approve", headers=self.auth(self.user))
        self.assertEqual((res.status_code, res.json()["status"]), (200, "approved"))
        res = self.client.post(f"/cards/{card_id}/reject", headers=self.auth(self.user))
        self.assertEqual(res.json()["status"], "rejected")
        self.assertEqual(self.get_card(card_id)["status"], "rejected")

    def test_a_new_card_starts_unreviewed(self):
        body = self.client.post(f"/cards/{self.card()}/approve", headers=self.auth(self.user)).json()
        self.assertEqual((body["ease_factor"], body["interval_days"], body["repetitions"], body["due_date"]), (2.5, 0, 0, None))


class OwnershipTests(CardTestCase):
    """Another user's card gets the same 404 as one that does not exist, and is never changed."""

    def test_nobody_can_touch_someone_elses_card(self):
        card_id = self.card(status="approved")
        before = self.get_card(card_id)
        other = self.signup()
        attempts = [
            ("POST", f"/cards/{card_id}/approve", {}),
            ("POST", f"/cards/{card_id}/reject", {}),
            ("PATCH", f"/cards/{card_id}", {"question": "hacked"}),
            ("POST", f"/cards/{card_id}/review", {"knew": True}),
        ]
        for method, path, body in attempts:
            with self.subTest(method=method, path=path):
                res = self.client.request(method, path, json=body, headers=self.auth(other))
                self.assertEqual(res.status_code, 404)
                self.assertEqual(res.json()["detail"], "Card not found")
        self.assertEqual(self.get_card(card_id), before)

    def test_missing_and_malformed_ids_are_the_same_404(self):
        for card_id in (ZERO_ID, "nope", "12"):
            for action in ("approve", "reject", "review"):
                with self.subTest(card_id=card_id, action=action):
                    res = self.client.post(f"/cards/{card_id}/{action}", json={"knew": True}, headers=self.auth(self.user))
                    self.assertEqual(res.status_code, 404)

    def test_someone_elses_cards_never_show_in_your_queue(self):
        other = self.signup()
        other_set = self.make_set(other)
        self.add_card(other, other_set["id"], status="approved")
        self.assertEqual(self.client.get("/quiz/due", headers=self.auth(self.user)).json()["items"], [])


class DeleteCardTests(CardTestCase):
    def delete(self, card_id, user=None):
        return self.client.delete(f"/cards/{card_id}", headers=self.auth(user or self.user))

    def test_deletes_a_card_of_any_status(self):
        for status in ("pending", "approved", "rejected"):
            with self.subTest(status=status):
                card_id = self.card(status=status)
                self.assertEqual(self.delete(card_id).status_code, 204)
                self.assertIsNone(self.get_card(card_id))

    def test_only_that_card_goes(self):
        keep, gone = self.card(), self.card()
        self.delete(gone)
        self.assertIsNotNone(self.get_card(keep))
        self.assertEqual(self.client.get(f"/sets/{self.set['id']}", headers=self.auth(self.user)).json()["card_count"], 1)

    def test_deleting_twice_is_a_404(self):
        card_id = self.card()
        self.delete(card_id)
        self.assertEqual(self.delete(card_id).status_code, 404)

    def test_nobody_can_delete_someone_elses_card(self):
        card_id = self.card()
        other = self.signup()
        self.assertEqual(self.delete(card_id, other).status_code, 404)
        self.assertIsNotNone(self.get_card(card_id))

    def test_bad_ids_are_404(self):
        for card_id in (ZERO_ID, "nope"):
            self.assertEqual(self.delete(card_id).status_code, 404)


class EditTests(CardTestCase):
    def setUp(self):
        super().setUp()
        self.check = self.patch("app.cards.check_answers", return_value=[CheckResult("flagged", "adds a fact")])

    def edit(self, card_id, **body):
        return self.client.patch(f"/cards/{card_id}", json=body, headers=self.auth(self.user))

    def test_a_changed_answer_is_checked_against_the_source_again(self):
        card_id = self.card(status="approved", check_status="supported", check_reason="ok")
        res = self.edit(card_id, answer="The mitochondria, which Darwin discovered.")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["answer"], "The mitochondria, which Darwin discovered.")
        self.assertEqual((res.json()["check_status"], res.json()["check_reason"]), ("flagged", "adds a fact"))
        self.check.assert_called_once_with(
            [("The mitochondria, which Darwin discovered.", "The mitochondria is the organelle that produces most of the cell's ATP.")]
        )

    def test_editing_the_question_does_not_call_the_checker(self):
        res = self.edit(self.card(), question="A new question?")
        self.assertEqual(res.json()["question"], "A new question?")
        self.assertEqual(res.json()["check_status"], "supported")  # unchanged
        self.check.assert_not_called()

    def test_saving_the_same_answer_does_not_call_the_checker(self):
        self.edit(self.card(answer="Same."), answer="Same.")
        self.check.assert_not_called()

    def test_an_edit_leaves_the_status_and_schedule_alone(self):
        card_id = self.card(status="approved", interval_days=6, repetitions=2, due_date="2030-01-01")
        res = self.edit(card_id, question="Reworded?").json()
        self.assertEqual((res["status"], res["interval_days"], res["repetitions"], res["due_date"]), ("approved", 6, 2, "2030-01-01"))

    def test_the_source_cannot_be_edited(self):
        card_id = self.card()
        self.edit(card_id, source="Something I made up", question="Still a question?")
        self.assertEqual(self.get_card(card_id)["source"], "The mitochondria is the organelle that produces most of the cell's ATP.")

    def test_an_empty_edit_changes_nothing(self):
        card_id = self.card()
        self.assertEqual(self.edit(card_id).status_code, 200)
        self.check.assert_not_called()

    def test_blank_fields_are_rejected(self):
        card_id = self.card()
        self.assertEqual(self.edit(card_id, question="").status_code, 422)
        self.assertEqual(self.edit(card_id, answer="").status_code, 422)
        self.assertEqual(self.get_card(card_id)["question"], "What makes ATP?")


class ReviewTests(CardTestCase):
    def review(self, card_id, knew=True, easy=False, date_header=None):
        headers = self.auth(self.user)
        if date_header:
            headers["X-Client-Date"] = date_header
        return self.client.post(f"/cards/{card_id}/review", json={"knew": knew, "easy": easy}, headers=headers)

    def test_a_new_card_that_was_known_is_due_tomorrow(self):
        res = self.review(self.card(status="approved"))
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual((body["interval_days"], body["repetitions"]), (1, 1))
        self.assertAlmostEqual(body["ease_factor"], 2.5)
        self.assertEqual(body["due_date"], (utc_today() + timedelta(days=1)).isoformat())

    def test_the_second_and_third_successes_stretch_the_interval(self):
        card_id = self.card(status="approved")
        intervals = [self.review(card_id).json()["interval_days"] for _ in range(3)]
        self.assertEqual(intervals, [1, 6, 15])  # 1, 6, then 6 x 2.5

    def test_forgetting_resets_the_streak_and_lowers_the_ease(self):
        card_id = self.card(status="approved", repetitions=3, interval_days=20)
        body = self.review(card_id, knew=False).json()
        self.assertEqual((body["repetitions"], body["interval_days"]), (0, 1))
        self.assertAlmostEqual(body["ease_factor"], 1.96)

    def test_too_easy_raises_the_ease(self):
        body = self.review(self.card(status="approved"), easy=True).json()
        self.assertAlmostEqual(body["ease_factor"], 2.6)

    def test_easy_is_ignored_when_the_answer_was_wrong(self):
        body = self.review(self.card(status="approved"), knew=False, easy=True).json()
        self.assertAlmostEqual(body["ease_factor"], 1.96)

    def test_ease_never_drops_below_the_minimum(self):
        card_id = self.card(status="approved")
        for _ in range(10):
            body = self.review(card_id, knew=False).json()
        self.assertAlmostEqual(body["ease_factor"], 1.3)

    def test_the_due_date_follows_the_users_calendar_day(self):
        tomorrow = utc_today() + timedelta(days=1)  # a user ahead of UTC is already on tomorrow's date
        body = self.review(self.card(status="approved"), date_header=tomorrow.isoformat()).json()
        self.assertEqual(body["due_date"], (tomorrow + timedelta(days=1)).isoformat())

    def test_a_made_up_date_falls_back_to_the_server_date(self):
        expected = (utc_today() + timedelta(days=1)).isoformat()
        for header in ("2001-01-01", "next week", "2999-12-31", "", "2026-13-45"):
            with self.subTest(header=header):
                card_id = self.card(status="approved")
                self.assertEqual(self.review(card_id, date_header=header or None).json()["due_date"], expected)

    def test_only_approved_cards_can_be_reviewed(self):
        for status in ("pending", "rejected"):
            with self.subTest(status=status):
                res = self.review(self.card(status=status))
                self.assertEqual(res.status_code, 400)
                self.assertIn("approved", res.json()["detail"])

    def test_the_answer_is_required(self):
        res = self.client.post(f"/cards/{self.card(status='approved')}/review", json={}, headers=self.auth(self.user))
        self.assertEqual(res.status_code, 422)


class DueQueueTests(CardTestCase):
    def due(self, date_header=None):
        headers = self.auth(self.user)
        if date_header:
            headers["X-Client-Date"] = date_header
        return self.client.get("/quiz/due", headers=headers)

    def test_lists_unreviewed_and_due_and_overdue_cards_only(self):
        today = utc_today()
        never = self.card(status="approved", question="never reviewed")
        overdue = self.card(status="approved", question="overdue", due_date=(today - timedelta(days=5)).isoformat())
        due_today = self.card(status="approved", question="today", due_date=today.isoformat())
        self.card(status="approved", question="tomorrow", due_date=(today + timedelta(days=1)).isoformat())
        self.card(status="pending", question="pending")
        self.card(status="rejected", question="rejected")
        res = self.due()
        self.assertEqual([c["id"] for c in res.json()["items"]], [never, overdue, due_today])  # never-reviewed first, then by date

    def test_a_card_due_tomorrow_is_due_for_a_user_already_on_tomorrow(self):
        tomorrow = utc_today() + timedelta(days=1)
        self.card(status="approved", due_date=tomorrow.isoformat())
        self.assertEqual(self.due().json()["items"], [])
        self.assertEqual(len(self.due(date_header=tomorrow.isoformat()).json()["items"]), 1)

    def test_a_reviewed_card_leaves_the_queue(self):
        card_id = self.card(status="approved")
        self.assertEqual(self.due().json()["total"], 1)
        self.client.post(f"/cards/{card_id}/review", json={"knew": True}, headers=self.auth(self.user))
        self.assertEqual(self.due().json()["items"], [])


class GenerateTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.patch("app.generate.GROQ_API_KEY", "gsk_test")
        self.generate = self.patch("app.generate.generate_flashcards", return_value=fake_cards("Q one?", "Q two?"))
        self.check = self.patch(
            "app.generate.check_answers", side_effect=lambda items: [CheckResult("supported", "ok") for _ in items]
        )

    def post(self, body=None, headers=None):
        return self.client.post("/flashcards", json={"notes": NOTES} if body is None else body, headers=headers or self.auth(self.user))

    def test_saves_the_cards_as_pending_with_their_check_results(self):
        res = self.post({"notes": NOTES, "max_cards": 5})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual([c["question"] for c in body["cards"]], ["Q one?", "Q two?"])
        self.assertTrue(all(c["status"] == "pending" and c["check_status"] == "supported" for c in body["cards"]))
        self.assertEqual(self.db.cards.count_documents({"user_id": models.parse_id(self.user["id"])}), 2)
        self.generate.assert_called_once_with(NOTES, 5)
        # the notes were saved too, and the cards point at them
        self.assertEqual(self.db.notes.find_one({"_id": models.parse_id(body["note_id"])})["text"], NOTES)

    def test_flagged_cards_keep_their_reason(self):
        self.check.side_effect = lambda items: [CheckResult("flagged", "adds a date") for _ in items]
        card = self.post().json()["cards"][0]
        self.assertEqual((card["check_status"], card["check_reason"]), ("flagged", "adds a date"))

    def test_reports_how_many_cards_were_dropped(self):
        self.generate.return_value = fake_cards("Only one?", dropped=3)
        self.assertEqual(self.post().json()["dropped"], 3)

    def test_no_cards_is_not_an_error(self):
        self.generate.return_value = fake_cards()
        body = self.post().json()
        self.assertEqual(body["cards"], [])

    def test_an_ai_failure_is_a_502_with_a_plain_message_and_nothing_is_left_behind(self):
        self.generate.side_effect = RuntimeError("secret internal detail")
        res = self.post()
        self.assertEqual(res.status_code, 502)
        self.assertNotIn("RuntimeError", res.text)
        self.assertNotIn("secret", res.text)
        self.assertEqual(self.db.notes.count_documents({}), 0)
        self.assertEqual(self.db.cards.count_documents({}), 0)

    def test_without_a_groq_key_it_says_so(self):
        self.patch("app.generate.GROQ_API_KEY", "")
        res = self.post()
        self.assertEqual(res.status_code, 500)
        self.assertIn("GROQ_API_KEY", res.json()["detail"])
        self.generate.assert_not_called()

    def test_validates_the_request(self):
        for body in ({"notes": "too short"}, {"notes": NOTES, "max_cards": 0}, {"notes": NOTES, "max_cards": 31}, {}):
            with self.subTest(body=body):
                self.assertEqual(self.post(body).status_code, 422)
        self.generate.assert_not_called()

    def test_needs_a_login(self):
        self.assertEqual(self.client.post("/flashcards", json={"notes": NOTES}).status_code, 401)
        self.generate.assert_not_called()

    def test_upload_a_text_file(self):
        res = self.client.post(
            "/flashcards/upload",
            files={"file": ("notes.txt", NOTES.encode(), "text/plain")},
            data={"max_cards": "4"},
            headers=self.auth(self.user),
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.generate.assert_called_once_with(NOTES, 4)

    def test_upload_problems(self):
        cases = {
            "wrong type": (("notes.docx", b"x" * 100, "application/octet-stream"), 422),
            "too little text": (("notes.txt", b"tiny", "text/plain"), 422),
            "not a pdf": (("notes.pdf", b"plain text", "application/pdf"), 422),
        }
        for name, (file, status) in cases.items():
            with self.subTest(name):
                res = self.client.post("/flashcards/upload", files={"file": file}, headers=self.auth(self.user))
                self.assertEqual(res.status_code, status, res.text)
        self.generate.assert_not_called()

    def test_cards_for_a_study_set_are_attached_to_it(self):
        made = self.make_set(self.user)
        res = self.client.post(f"/sets/{made['id']}/flashcards", json={"max_cards": 5}, headers=self.auth(self.user))
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["note_id"], made["id"])
        self.assertEqual(self.client.get(f"/sets/{made['id']}", headers=self.auth(self.user)).json()["card_count"], 2)
        self.assertEqual(self.db.notes.count_documents({}), 1)  # no extra note

    def test_a_failed_set_generation_keeps_the_set(self):
        made = self.make_set(self.user)
        self.generate.side_effect = HTTPException(status_code=502, detail="down")
        self.client.post(f"/sets/{made['id']}/flashcards", json={"max_cards": 5}, headers=self.auth(self.user))
        self.assertEqual(self.db.notes.count_documents({}), 1)


class CheckStatsTests(CardTestCase):
    def test_counts_supported_and_flagged_cards_of_every_status(self):
        for status in ("pending", "approved", "rejected"):
            self.card(status=status, check_status="supported")
        self.card(check_status="flagged")
        self.card(check_status=None)  # never checked: not counted
        other = self.signup()
        self.add_card(other, self.make_set(other)["id"], check_status="flagged")  # someone else's: not counted
        stats = self.client.get("/stats/checks", headers=self.auth(self.user)).json()
        self.assertEqual((stats["checked"], stats["supported"], stats["flagged"]), (4, 3, 1))
        self.assertAlmostEqual(stats["flagged_rate"], 0.25)

    def test_no_cards_means_a_zero_rate_not_a_crash(self):
        stats = self.client.get("/stats/checks", headers=self.auth(self.user)).json()
        self.assertEqual((stats["checked"], stats["flagged_rate"]), (0, 0.0))


if __name__ == "__main__":
    unittest.main()
