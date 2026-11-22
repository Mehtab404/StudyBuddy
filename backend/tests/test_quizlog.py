"""Saving quiz results, and the progress summary built from them (weak topics, questions still being missed)."""

import unittest
from datetime import timedelta

from support import ApiTestCase

from app import models, quizlog

ZERO_ID = "0" * 24


def answer(question="What makes ATP?", chosen=1, right=1, topic="Cell energy", **extra):
    return {
        "question": question,
        "options": ["Nucleus", "Mitochondria", "Ribosome", "Vacuole"],
        "answer_index": right,
        "chosen_index": chosen,
        "explanation": "The mitochondria makes ATP.",
        "topic": topic,
        **extra,
    }


class QuizLogTestCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.set = self.make_set(self.user)
        self.url = f"/sets/{self.set['id']}/quiz"

    def save(self, *answers, headers=None, url=None):
        return self.client.post(
            f"{url or self.url}/attempts", json={"answers": list(answers)}, headers=headers or self.auth(self.user)
        )

    def progress(self, headers=None, url=None):
        res = self.client.get(f"{url or self.url}/progress", headers=headers or self.auth(self.user))
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()


class SaveAttemptTests(QuizLogTestCase):
    def test_the_server_works_out_the_score(self):
        res = self.save(answer("Q1", chosen=1), answer("Q2", chosen=0), answer("Q3", chosen=1), answer("Q4", chosen=3))
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertEqual((body["score"], body["total"]), (2, 4))
        self.assertTrue(body["id"])

    def test_a_claimed_score_or_correctness_is_ignored(self):
        res = self.client.post(
            f"{self.url}/attempts",
            json={"score": 99, "total": 99, "answers": [answer("Q1", chosen=0, correct=True, score=5)]},
            headers=self.auth(self.user),
        )
        self.assertEqual((res.json()["score"], res.json()["total"]), (0, 1))
        stored = self.db.quiz_attempts.find_one({})
        self.assertFalse(stored["answers"][0]["correct"])

    def test_the_questions_are_stored_with_the_attempt(self):
        self.save(answer("Q1", chosen=0, topic="Cells"))
        stored = self.db.quiz_attempts.find_one({})
        self.assertEqual(stored["user_id"], models.parse_id(self.user["id"]))
        self.assertEqual(stored["set_id"], models.parse_id(self.set["id"]))
        [a] = stored["answers"]
        self.assertEqual((a["question"], a["topic"], a["chosen_index"], a["answer_index"]), ("Q1", "Cells", 0, 1))
        self.assertEqual(a["options"][1], "Mitochondria")
        self.assertFalse(a["correct"])

    def test_topic_and_explanation_are_optional(self):
        bare = {"question": "Q?", "options": ["a", "b", "c", "d"], "answer_index": 0, "chosen_index": 0}
        self.assertEqual(self.save(bare).status_code, 201)
        self.assertEqual(self.db.quiz_attempts.find_one({})["answers"][0]["topic"], "")

    def test_rejects_bad_answers(self):
        base = answer()
        bad = {
            "no answers": [],
            "too many": [base] * (quizlog.MAX_ANSWERS + 1),
            "three options": {**base, "options": ["a", "b", "c"]},
            "five options": {**base, "options": ["a", "b", "c", "d", "e"]},
            "right answer out of range": {**base, "answer_index": 4},
            "chosen out of range": {**base, "chosen_index": 4},
            "chosen negative": {**base, "chosen_index": -1},
            "chosen not a number": {**base, "chosen_index": "1"},
            "chosen is a boolean": {**base, "chosen_index": True},
            "right answer is a boolean": {**base, "answer_index": False},
            "empty question": {**base, "question": ""},
            "huge question": {**base, "question": "x" * 1001},
            "huge option": {**base, "options": ["x" * 501, "b", "c", "d"]},
            "huge topic": {**base, "topic": "x" * 101},
        }
        for name, value in bad.items():
            with self.subTest(name):
                answers = value if isinstance(value, list) else [value]
                self.assertEqual(self.save(*answers).status_code, 422)
        self.assertEqual(self.db.quiz_attempts.count_documents({}), 0)

    def test_a_full_quiz_is_accepted(self):
        res = self.save(*[answer(f"Q{i}") for i in range(quizlog.MAX_ANSWERS)])
        self.assertEqual(res.json()["total"], quizlog.MAX_ANSWERS)

    def test_you_cannot_save_results_into_someone_elses_set(self):
        other = self.signup()
        self.assertEqual(self.save(answer(), headers=self.auth(other)).status_code, 404)
        self.assertEqual(self.save(answer(), url=f"/sets/{ZERO_ID}/quiz").status_code, 404)
        self.assertEqual(self.save(answer(), url="/sets/nope/quiz").status_code, 404)
        self.assertEqual(self.db.quiz_attempts.count_documents({}), 0)

    def test_needs_a_login(self):
        self.assertEqual(self.client.post(f"{self.url}/attempts", json={"answers": [answer()]}).status_code, 401)
        self.assertEqual(self.client.get(f"{self.url}/progress").status_code, 401)

    def test_only_the_newest_attempts_are_kept(self):
        self.patch_object(quizlog, "MAX_ATTEMPTS_PER_SET", 3)
        ids = [self.save(answer(f"Q{i}")).json()["id"] for i in range(5)]
        kept = [str(a["_id"]) for a in self.db.quiz_attempts.find({})]
        self.assertEqual(sorted(kept), sorted(ids[2:]))

    def test_the_limit_is_per_set(self):
        self.patch_object(quizlog, "MAX_ATTEMPTS_PER_SET", 2)
        other_set = self.make_set(self.user, subject="Another")
        for _ in range(3):
            self.save(answer())
        self.save(answer(), url=f"/sets/{other_set['id']}/quiz")
        self.assertEqual(self.db.quiz_attempts.count_documents({"set_id": models.parse_id(other_set["id"])}), 1)
        self.assertEqual(self.db.quiz_attempts.count_documents({"set_id": models.parse_id(self.set["id"])}), 2)


class ProgressTests(QuizLogTestCase):
    def test_a_set_with_no_attempts(self):
        self.assertEqual(self.progress(), {"attempts": 0, "recent": [], "topics": [], "missed": []})

    def test_recent_attempts_come_newest_first_and_are_capped(self):
        for i in range(quizlog.RECENT_ATTEMPTS + 3):
            self.save(*[answer(f"Q{j}", chosen=1) for j in range(i % 4 + 1)])
        body = self.progress()
        self.assertEqual(body["attempts"], quizlog.RECENT_ATTEMPTS + 3)
        self.assertEqual(len(body["recent"]), quizlog.RECENT_ATTEMPTS)
        times = [(a["created_at"], a["id"]) for a in body["recent"]]
        self.assertEqual(times, sorted(times, reverse=True))
        last = quizlog.RECENT_ATTEMPTS + 2
        self.assertEqual(body["recent"][0]["total"], last % 4 + 1)  # the one saved last

    def test_topics_add_up_across_attempts_and_the_weakest_comes_first(self):
        self.save(answer("A1", chosen=1, topic="Cells"), answer("A2", chosen=1, topic="Cells"), answer("B1", chosen=0, topic="Genes"))
        self.save(answer("A3", chosen=0, topic="Cells"), answer("B2", chosen=0, topic="Genes"), answer("C1", chosen=1, topic="Energy"))
        topics = {t["topic"]: (t["answered"], t["correct"]) for t in self.progress()["topics"]}
        self.assertEqual(topics, {"Cells": (3, 2), "Genes": (2, 0), "Energy": (1, 1)})
        self.assertEqual([t["topic"] for t in self.progress()["topics"]], ["Genes", "Cells", "Energy"])

    def test_questions_without_a_topic_are_left_out_of_the_topics(self):
        self.save(answer("Old question", chosen=0, topic=""), answer("New question", chosen=0, topic="Cells"))
        self.assertEqual([t["topic"] for t in self.progress()["topics"]], ["Cells"])

    def test_a_tie_on_accuracy_puts_the_topic_with_more_answers_first(self):
        self.save(answer("A1", chosen=0, topic="Small"), answer("B1", chosen=0, topic="Big"), answer("B2", chosen=0, topic="Big"))
        self.assertEqual([t["topic"] for t in self.progress()["topics"]], ["Big", "Small"])

    def test_a_question_missed_and_later_answered_right_is_no_longer_missed(self):
        self.save(answer("Q1", chosen=0), answer("Q2", chosen=0))
        self.save(answer("Q1", chosen=1))  # learned it
        self.assertEqual([q["question"] for q in self.progress()["missed"]], ["Q2"])

    def test_a_question_answered_right_and_later_wrong_is_missed_again(self):
        self.save(answer("Q1", chosen=1))
        self.save(answer("Q1", chosen=0))
        self.assertEqual([q["question"] for q in self.progress()["missed"]], ["Q1"])

    def test_a_question_asked_in_several_attempts_is_listed_once(self):
        for _ in range(3):
            self.save(answer("Q1", chosen=0))
        self.assertEqual(len(self.progress()["missed"]), 1)

    def test_the_most_recently_missed_comes_first(self):
        self.save(answer("Old miss", chosen=0))
        self.save(answer("New miss", chosen=0))
        self.assertEqual([q["question"] for q in self.progress()["missed"]], ["New miss", "Old miss"])

    def test_missed_questions_are_complete_and_ready_to_ask_again(self):
        self.save(answer("Q1", chosen=0, right=2, topic="Cells"))
        [q] = self.progress()["missed"]
        self.assertEqual(q["options"], ["Nucleus", "Mitochondria", "Ribosome", "Vacuole"])
        self.assertEqual((q["answer_index"], q["topic"]), (2, "Cells"))
        self.assertEqual(q["explanation"], "The mitochondria makes ATP.")
        self.assertNotIn("chosen_index", q)  # it is a question to ask again, not a record of the old answer

    def test_no_more_than_30_missed_questions_are_returned(self):
        for start in (0, 30):
            self.save(*[answer(f"Q{i}", chosen=0) for i in range(start, start + 30)])
        self.assertEqual(len(self.progress()["missed"]), quizlog.MAX_MISSED)

    def test_the_history_survives_a_new_quiz(self):
        self.save(answer("From the first quiz", chosen=0, topic="Cells"))
        self.db.notes.update_one(
            {"_id": models.parse_id(self.set["id"])},
            {"$set": {"quiz": [{"question": "From the second quiz", "options": list("abcd"), "answer_index": 0, "explanation": "", "topic": "Genes"}]}},
        )
        body = self.progress()
        self.assertEqual([q["question"] for q in body["missed"]], ["From the first quiz"])
        self.assertEqual([t["topic"] for t in body["topics"]], ["Cells"])

    def test_each_set_has_its_own_history(self):
        other_set = self.make_set(self.user, subject="Another")
        self.save(answer("Q1", chosen=0))
        self.assertEqual(self.progress(url=f"/sets/{other_set['id']}/quiz")["attempts"], 0)

    def test_nobody_else_can_read_your_progress(self):
        self.save(answer("Private question", chosen=0))
        other = self.signup()
        res = self.client.get(f"{self.url}/progress", headers=self.auth(other))
        self.assertEqual(res.status_code, 404)
        self.assertNotIn("Private question", res.text)
        self.assertEqual(self.client.get(f"/sets/{ZERO_ID}/quiz/progress", headers=self.auth(self.user)).status_code, 404)


class CleanupTests(QuizLogTestCase):
    def test_deleting_a_set_deletes_its_results_and_only_its_results(self):
        other_set = self.make_set(self.user, subject="Another")
        self.save(answer("Q1"))
        self.save(answer("Q2"), url=f"/sets/{other_set['id']}/quiz")
        self.client.delete(f"/sets/{self.set['id']}", headers=self.auth(self.user))
        remaining = list(self.db.quiz_attempts.find({}))
        self.assertEqual([a["answers"][0]["question"] for a in remaining], ["Q2"])

    def test_deleting_the_account_deletes_the_results(self):
        self.save(answer())
        other = self.signup()
        other_set = self.make_set(other)
        self.save(answer("Theirs"), headers=self.auth(other), url=f"/sets/{other_set['id']}/quiz")
        res = self.client.post("/auth/delete-account", json={"password": "correct horse battery"}, headers=self.auth(self.user))
        self.assertEqual(res.status_code, 204)
        self.assertEqual([a["answers"][0]["question"] for a in self.db.quiz_attempts.find({})], ["Theirs"])

    def test_an_expired_guest_takes_its_results_with_it(self):
        from app import auth

        guest = self.guest()
        made = self.make_set(guest)
        self.save(answer(), headers=self.auth(guest), url=f"/sets/{made['id']}/quiz")
        self.db.users.update_one({"is_guest": True}, {"$set": {"created_at": models.now() - timedelta(days=30)}})
        self.assertEqual(auth.purge_expired_guests(self.db), 1)
        self.assertEqual(self.db.quiz_attempts.count_documents({}), 0)


class QuizTopicTests(ApiTestCase):
    """Generated quiz questions now carry a topic."""

    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.set = self.make_set(self.user)
        self.chat = self.patch("app.studyset.chat_json")

    def make_quiz(self, *questions):
        self.chat.return_value = {"questions": list(questions)}
        res = self.client.post(f"/sets/{self.set['id']}/quiz", json={"count": 5}, headers=self.auth(self.user))
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()["quiz"]

    def question(self, **overrides):
        return {"question": "Q?", "options": list("abcd"), "answer_index": 0, "explanation": "e", **overrides}

    def test_the_topic_is_kept(self):
        [q] = self.make_quiz(self.question(topic="  Cell energy  "))
        self.assertEqual(q["topic"], "Cell energy")

    def test_a_missing_or_odd_topic_becomes_empty_instead_of_failing(self):
        qs = self.make_quiz(self.question(), self.question(topic=None), self.question(topic=5), self.question(topic=["x"]))
        self.assertEqual([q["topic"] for q in qs], ["", "", "", ""])

    def test_a_very_long_topic_is_cut_to_100_characters(self):
        [q] = self.make_quiz(self.question(topic="x" * 500))
        self.assertEqual(len(q["topic"]), 100)

    def test_a_long_answer_from_the_ai_can_still_be_saved_as_a_result(self):
        [q] = self.make_quiz(
            self.question(question="q" * 1500, options=["o" * 600, "b", "c", "d"], explanation="e" * 3000, topic="t" * 300)
        )
        self.assertEqual((len(q["question"]), len(q["options"][0]), len(q["explanation"]), len(q["topic"])), (1000, 500, 2000, 100))
        res = self.client.post(
            f"/sets/{self.set['id']}/quiz/attempts",
            json={"answers": [{**q, "chosen_index": 0}]},
            headers=self.auth(self.user),
        )
        self.assertEqual(res.status_code, 201, res.text)

    def test_the_prompt_asks_for_a_topic(self):
        self.make_quiz(self.question(topic="T"))
        system = self.chat.call_args.args[0]
        self.assertIn('"topic"', system)

    def test_quizzes_saved_before_topics_existed_still_load(self):
        old = {"question": "Old?", "options": list("abcd"), "answer_index": 1, "explanation": "e"}  # no topic key
        self.db.notes.update_one({"_id": models.parse_id(self.set["id"])}, {"$set": {"quiz": [old]}})
        detail = self.client.get(f"/sets/{self.set['id']}", headers=self.auth(self.user)).json()
        self.assertEqual(detail["quiz"][0]["topic"], "")


if __name__ == "__main__":
    unittest.main()
