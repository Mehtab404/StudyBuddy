"""The request limiter: which routes are limited, how the client is identified, and what a blocked request gets."""

import unittest
from types import SimpleNamespace
from unittest import mock

from support import ApiTestCase

from app import ratelimit
from app.ratelimit import RULES, Rule, check


def rule_for(method: str, path: str) -> Rule | None:
    return next((r for r in RULES if method in r.methods and r.path.match(path)), None)


class RuleMatchingTests(unittest.TestCase):
    def test_login_signup_guest_and_upgrade_are_limited_per_ip(self):
        for path in ("/auth/login", "/auth/signup", "/auth/guest", "/auth/upgrade", "/auth/password", "/auth/delete-account"):
            with self.subTest(path=path):
                rule = rule_for("POST", path)
                self.assertEqual(rule.name, "auth")
                self.assertFalse(rule.per_user)

    def test_every_route_that_calls_groq_shares_the_ai_quota(self):
        calls = [
            ("POST", "/flashcards"),
            ("POST", "/flashcards/upload"),
            ("POST", "/sets/abc/ask"),
            ("POST", "/sets/abc/revision"),
            ("POST", "/sets/abc/quiz"),
            ("POST", "/sets/abc/paper"),
            ("POST", "/sets/abc/flashcards"),
            ("PATCH", "/cards/abc"),  # editing an answer re-checks it with Groq
        ]
        for method, path in calls:
            with self.subTest(path=path):
                rule = rule_for(method, path)
                self.assertIsNotNone(rule, f"{method} {path} has no limit")
                self.assertEqual(rule.name, "ai")
                self.assertTrue(rule.per_user)

    def test_routes_that_run_the_embedding_model_are_limited(self):
        calls = [
            ("POST", "/sets"),
            ("POST", "/sets/upload"),
            ("POST", "/sets/abc/chunks/rebuild"),
            ("POST", "/sets/abc/chunks/embed"),
            ("GET", "/sets/abc/chunks/search"),  # a GET, but it embeds the query
        ]
        for method, path in calls:
            with self.subTest(path=path):
                self.assertEqual(rule_for(method, path).name, "indexing")

    def test_cheap_routes_are_not_limited(self):
        free = [
            ("GET", "/sets"),
            ("GET", "/sets/abc"),
            ("GET", "/sets/abc/chunks"),
            ("GET", "/cards"),
            ("POST", "/cards/abc/approve"),
            ("POST", "/cards/abc/review"),
            ("DELETE", "/sets/abc"),
            ("GET", "/auth/me"),
            ("GET", "/quiz/due"),
        ]
        for method, path in free:
            with self.subTest(path=path):
                self.assertIsNone(rule_for(method, path))

    def test_a_path_cannot_sneak_past_with_extra_segments(self):
        self.assertIsNone(rule_for("POST", "/sets/abc/def/ask"))
        self.assertIsNone(rule_for("POST", "/auth/login/extra"))


class CheckTests(unittest.TestCase):
    RULE = Rule("t", frozenset({"POST"}), None, limit=3, window=60, per_user=True)

    def setUp(self):
        ratelimit.reset()
        self.addCleanup(ratelimit.reset)

    def test_allows_up_to_the_limit_then_says_how_long_to_wait(self):
        for i in range(3):
            self.assertIsNone(check(self.RULE, "k", now=100.0 + i))
        wait = check(self.RULE, "k", now=103.0)
        self.assertIsNotNone(wait)
        self.assertTrue(1 <= wait <= 60)

    def test_wait_matches_when_the_oldest_request_leaves_the_window(self):
        for i in range(3):
            check(self.RULE, "k", now=100.0)
        self.assertEqual(check(self.RULE, "k", now=130.0), 31)  # 30 s into a 60 s window

    def test_a_blocked_request_does_not_extend_the_block(self):
        for _ in range(3):
            check(self.RULE, "k", now=100.0)
        for t in (110.0, 120.0, 130.0):
            self.assertIsNotNone(check(self.RULE, "k", now=t))
        self.assertIsNone(check(self.RULE, "k", now=160.0))  # the first three have aged out

    def test_requests_are_allowed_again_after_the_window(self):
        for _ in range(3):
            check(self.RULE, "k", now=100.0)
        self.assertIsNotNone(check(self.RULE, "k", now=159.0))
        self.assertIsNone(check(self.RULE, "k", now=160.0))

    def test_clients_and_rules_are_counted_separately(self):
        other = Rule("other", frozenset({"POST"}), None, limit=3, window=60, per_user=True)
        for _ in range(3):
            check(self.RULE, "a", now=100.0)
        self.assertIsNotNone(check(self.RULE, "a", now=100.0))
        self.assertIsNone(check(self.RULE, "b", now=100.0))
        self.assertIsNone(check(other, "a", now=100.0))


def fake_request(headers: dict[str, str | list[str]] | None = None, peer: str | None = "10.0.0.9"):
    """The few parts of a Starlette Request that the client-address code reads."""
    values = {k.lower(): ([v] if isinstance(v, str) else v) for k, v in (headers or {}).items()}

    class Headers:
        def getlist(self, name):
            return values.get(name, [])

        def get(self, name, default=None):
            return values[name][0] if name in values else default

    return SimpleNamespace(client=SimpleNamespace(host=peer) if peer else None, headers=Headers())


class ClientIpTests(unittest.TestCase):
    def test_ignores_x_forwarded_for_when_nothing_is_in_front(self):
        with mock.patch.object(ratelimit, "TRUSTED_PROXY_HOPS", 0):
            request = fake_request({"X-Forwarded-For": "1.2.3.4"})
            self.assertEqual(ratelimit._client_ip(request), "10.0.0.9")

    def test_takes_the_entry_the_trusted_proxy_added(self):
        with mock.patch.object(ratelimit, "TRUSTED_PROXY_HOPS", 1):
            request = fake_request({"X-Forwarded-For": "203.0.113.5"})
            self.assertEqual(ratelimit._client_ip(request), "203.0.113.5")

    def test_a_visitor_cannot_choose_their_address_by_writing_the_header(self):
        # The visitor sent "6.6.6.6"; the proxy then appended the address it actually saw
        with mock.patch.object(ratelimit, "TRUSTED_PROXY_HOPS", 1):
            request = fake_request({"X-Forwarded-For": "6.6.6.6, 203.0.113.5"})
            self.assertEqual(ratelimit._client_ip(request), "203.0.113.5")

    def test_counts_hops_from_the_right_with_several_proxies(self):
        with mock.patch.object(ratelimit, "TRUSTED_PROXY_HOPS", 2):
            request = fake_request({"X-Forwarded-For": "6.6.6.6, 203.0.113.5, 10.1.1.1"})
            self.assertEqual(ratelimit._client_ip(request), "203.0.113.5")

    def test_reads_every_copy_of_the_header(self):
        with mock.patch.object(ratelimit, "TRUSTED_PROXY_HOPS", 1):
            request = fake_request({"X-Forwarded-For": ["6.6.6.6", "203.0.113.5"]})
            self.assertEqual(ratelimit._client_ip(request), "203.0.113.5")

    def test_a_missing_or_too_short_header_falls_back_to_the_peer(self):
        with mock.patch.object(ratelimit, "TRUSTED_PROXY_HOPS", 2):
            self.assertEqual(ratelimit._client_ip(fake_request()), "10.0.0.9")
            self.assertEqual(ratelimit._client_ip(fake_request({"X-Forwarded-For": "1.2.3.4"})), "10.0.0.9")

    def test_unknown_peer(self):
        with mock.patch.object(ratelimit, "TRUSTED_PROXY_HOPS", 0):
            self.assertEqual(ratelimit._client_ip(fake_request(peer=None)), "unknown")


class MiddlewareTests(ApiTestCase):
    """The limiter in front of the real app."""

    def setUp(self):
        super().setUp()
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", True)
        self.patch_object(ratelimit, "TRUSTED_PROXY_HOPS", 0)

    def test_the_eleventh_guest_request_in_a_minute_is_blocked(self):
        for i in range(10):
            self.assertEqual(self.client.post("/auth/guest").status_code, 201, f"request {i + 1}")
        res = self.client.post("/auth/guest")
        self.assertEqual(res.status_code, 429)
        self.assertIn("Too many requests", res.json()["detail"])
        self.assertGreaterEqual(int(res.headers["Retry-After"]), 1)
        self.assertEqual(self.db.users.count_documents({}), 10)  # the blocked one never reached the route

    def test_blocked_requests_still_carry_cors_headers(self):
        # Without them the browser hides the 429 and the page shows "can't reach the server"
        for _ in range(10):
            self.client.post("/auth/guest")
        res = self.client.post("/auth/guest", headers={"Origin": "http://localhost:3000"})
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.headers["access-control-allow-origin"], "http://localhost:3000")

    def test_ai_limit_is_per_user(self):
        a, b = self.signup(), self.signup()
        # PATCH /cards/{id} counts toward the AI limit. The card does not exist, so each allowed request is a 404.
        for i in range(15):
            res = self.client.patch(f"/cards/{'0' * 24}", json={"question": "q"}, headers=self.auth(a))
            self.assertEqual(res.status_code, 404, f"request {i + 1}")
        self.assertEqual(self.client.patch(f"/cards/{'0' * 24}", json={"question": "q"}, headers=self.auth(a)).status_code, 429)
        self.assertEqual(self.client.patch(f"/cards/{'0' * 24}", json={"question": "q"}, headers=self.auth(b)).status_code, 404)

    def test_chunk_search_is_limited_even_though_it_is_a_get(self):
        user = self.signup()
        statuses = [
            self.client.get(f"/sets/{'0' * 24}/chunks/search?q=hello", headers=self.auth(user)).status_code
            for _ in range(11)
        ]
        self.assertEqual(statuses, [404] * 10 + [429])

    def test_limits_are_per_ip_behind_a_proxy(self):
        self.patch_object(ratelimit, "TRUSTED_PROXY_HOPS", 1)
        for _ in range(10):
            self.client.post("/auth/guest", headers={"X-Forwarded-For": "198.51.100.1"})
        blocked = self.client.post("/auth/guest", headers={"X-Forwarded-For": "198.51.100.1"})
        elsewhere = self.client.post("/auth/guest", headers={"X-Forwarded-For": "198.51.100.2"})
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(elsewhere.status_code, 201)

    def test_rotating_a_fake_header_does_not_dodge_the_limit(self):
        self.patch_object(ratelimit, "TRUSTED_PROXY_HOPS", 1)
        # The visitor writes a new left-hand entry each time; the proxy always appends the same real address
        for i in range(10):
            self.client.post("/auth/guest", headers={"X-Forwarded-For": f"9.9.9.{i}, 198.51.100.1"})
        res = self.client.post("/auth/guest", headers={"X-Forwarded-For": "9.9.9.99, 198.51.100.1"})
        self.assertEqual(res.status_code, 429)

    def test_a_bad_token_is_counted_by_ip(self):
        self.patch_object(ratelimit, "TRUSTED_PROXY_HOPS", 0)
        bad = {"Authorization": "Bearer nonsense"}
        statuses = [self.client.patch(f"/cards/{'0' * 24}", json={"question": "q"}, headers=bad).status_code for _ in range(16)]
        self.assertEqual(statuses[:15], [401] * 15)
        self.assertEqual(statuses[15], 429)

    def test_unlimited_routes_are_never_blocked(self):
        user = self.signup()
        for _ in range(40):
            self.assertEqual(self.client.get("/sets", headers=self.auth(user)).status_code, 200)

    def test_can_be_turned_off(self):
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", False)
        for _ in range(15):
            self.assertEqual(self.client.post("/auth/guest").status_code, 201)


if __name__ == "__main__":
    unittest.main()
