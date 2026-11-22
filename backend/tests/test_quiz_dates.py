import unittest
from datetime import date, datetime, timedelta, timezone

from app.quiz import users_today


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


class UsersTodayTests(unittest.TestCase):
    def test_uses_the_date_the_browser_sends(self):
        # A user ahead of UTC (e.g. India) is already on tomorrow's date for part of the day
        tomorrow = _utc_today() + timedelta(days=1)
        self.assertEqual(users_today(tomorrow.isoformat()), tomorrow)
        yesterday = _utc_today() - timedelta(days=1)
        self.assertEqual(users_today(yesterday.isoformat()), yesterday)

    def test_falls_back_to_the_utc_date_without_a_header(self):
        self.assertEqual(users_today(None), _utc_today())

    def test_ignores_things_that_are_not_dates(self):
        for bad in ("", "tomorrow", "2026-13-45", "26-01-10", "1; DROP TABLE"):
            self.assertEqual(users_today(bad), _utc_today(), bad)

    def test_ignores_dates_more_than_a_day_from_utc(self):
        # No time zone is that far off, so these are mistakes or attempts to hide cards or make them all due
        for days in (-2, 2, 400, -400):
            far = (_utc_today() + timedelta(days=days)).isoformat()
            self.assertEqual(users_today(far), _utc_today(), far)


if __name__ == "__main__":
    unittest.main()
