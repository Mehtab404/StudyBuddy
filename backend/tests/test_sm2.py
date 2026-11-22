import unittest
from datetime import date

from app.sm2 import MIN_EASE, next_schedule

TODAY = date(2026, 1, 10)


class NextScheduleTests(unittest.TestCase):
    def test_first_two_correct_answers_give_one_then_six_days(self):
        s = next_schedule(2.5, 0, 0, True, TODAY)
        self.assertEqual((s.interval_days, s.repetitions, s.due_date), (1, 1, date(2026, 1, 11)))
        s = next_schedule(s.ease_factor, s.interval_days, s.repetitions, True, TODAY)
        self.assertEqual((s.interval_days, s.repetitions), (6, 2))

    def test_later_intervals_grow_by_the_ease_factor(self):
        s = next_schedule(2.5, 6, 2, True, TODAY)
        self.assertEqual(s.interval_days, 15)

    def test_failing_restarts_the_streak_and_is_due_tomorrow(self):
        s = next_schedule(2.5, 30, 5, False, TODAY)
        self.assertEqual((s.interval_days, s.repetitions, s.due_date), (1, 0, date(2026, 1, 11)))

    def test_knew_it_leaves_the_ease_unchanged(self):
        self.assertAlmostEqual(next_schedule(2.5, 6, 2, True, TODAY).ease_factor, 2.5)

    def test_easy_raises_the_ease(self):
        self.assertAlmostEqual(next_schedule(2.5, 6, 2, True, TODAY, easy=True).ease_factor, 2.6)

    def test_easy_cards_come_back_later_than_normal_ones_over_time(self):
        normal = easy = (2.5, 6, 2)
        for _ in range(4):
            s = next_schedule(*normal, True, TODAY)
            normal = (s.ease_factor, s.interval_days, s.repetitions)
            s = next_schedule(*easy, True, TODAY, easy=True)
            easy = (s.ease_factor, s.interval_days, s.repetitions)
        self.assertGreater(easy[1], normal[1])

    def test_failing_lowers_the_ease_but_never_below_the_minimum(self):
        ease = 2.5
        for _ in range(10):
            ease = next_schedule(ease, 10, 3, False, TODAY).ease_factor
        self.assertAlmostEqual(ease, MIN_EASE)

    def test_easy_is_ignored_when_the_answer_was_wrong(self):
        s = next_schedule(2.5, 10, 3, False, TODAY, easy=True)
        self.assertEqual((s.interval_days, s.repetitions), (1, 0))
        self.assertAlmostEqual(s.ease_factor, next_schedule(2.5, 10, 3, False, TODAY).ease_factor)


if __name__ == "__main__":
    unittest.main()
