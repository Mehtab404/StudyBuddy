"""Checks that cover the whole API at once, plus the chunk, ask, health and CORS endpoints."""

import re
import unittest
from unittest import mock

from support import NOTES, ApiTestCase

from app import models
from app.embeddings import EMBED_MODEL
from app.main import app

ZERO_ID = "0" * 24

# Everything a visitor who is not logged in may call. Any other route must answer 401.
PUBLIC = {
    ("GET", "/"),
    ("GET", "/health"),
    ("POST", "/auth/signup"),
    ("POST", "/auth/login"),
    ("POST", "/auth/guest"),
}


def all_routes() -> list[tuple[str, str]]:
    """(METHOD, path with every {param} filled in) for each route the app serves. Read from the OpenAPI schema, which
    lists the routes of included routers whatever FastAPI does internally to store them."""
    found = []
    for path, operations in app.openapi()["paths"].items():
        filled = re.sub(r"\{[^}]+\}", ZERO_ID, path)
        found.extend((method.upper(), filled) for method in operations)
    return found

class AuthRequiredTests(ApiTestCase):
    def test_every_route_except_the_public_ones_needs_a_login(self):
        routes = all_routes()
        self.assertGreater(len(routes), 30)  # the sweep really found the app's routes
        open_routes = set()
        for method, path in routes:
            res = self.client.request(method, path)
            if res.status_code != 401:
                open_routes.add((method, re.sub(ZERO_ID, "{id}", path)))
        public = {(m, re.sub(ZERO_ID, "{id}", p)) for m, p in PUBLIC}
        self.assertEqual(open_routes, public, "a route answers without a login, or a public route needs one")

    def test_every_route_rejects_a_forged_token_too(self):
        forged = {"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.e30.bad"}
        for method, path in all_routes():
            if (method, path) in PUBLIC:
                continue
            with self.subTest(method=method, path=path):
                self.assertEqual(self.client.request(method, path, headers=forged).status_code, 401)

    def test_the_debug_routes_are_off_unless_asked_for(self):
        self.assertFalse([p for _, p in all_routes() if p.startswith("/debug")])


class HealthAndErrorTests(ApiTestCase):
    def test_root_and_health(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/health").json()["status"], "ok")

    def test_health_never_shows_the_key(self):
        self.patch("app.main.GROQ_API_KEY", "gsk_super_secret_value")
        res = self.client.get("/health")
        self.assertTrue(res.json()["groq_key_loaded"])
        self.assertNotIn("gsk_super_secret_value", res.text)

    def test_a_placeholder_key_does_not_count_as_loaded(self):
        for key in ("", None, "paste-your-key-here", "your-key"):
            with self.subTest(key=key):
                self.patch("app.main.GROQ_API_KEY", key)
                self.assertFalse(self.client.get("/health").json()["groq_key_loaded"])

    def test_an_unexpected_crash_is_a_plain_500(self):
        user = self.signup()
        with mock.patch.object(self.db.notes, "find", side_effect=RuntimeError("secret internal detail")):
            res = self.client.get("/sets", headers=self.auth(user))
        self.assertEqual(res.status_code, 500)
        self.assertNotIn("secret", res.text)
        self.assertNotIn("RuntimeError", res.text)
        self.assertIn("Something went wrong", res.json()["detail"])


class CorsTests(ApiTestCase):
    ORIGIN = "http://localhost:3000"

    def preflight(self, method="PATCH", headers="authorization,content-type,x-client-date", origin=None):
        return self.client.options(
            "/sets",
            headers={
                "Origin": origin or self.ORIGIN,
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": headers,
            },
        )

    def test_the_frontend_may_call_with_the_headers_it_uses(self):
        for method in ("GET", "POST", "PATCH", "DELETE"):
            with self.subTest(method=method):
                res = self.preflight(method=method)
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.headers["access-control-allow-origin"], self.ORIGIN)

    def test_other_websites_are_refused(self):
        res = self.preflight(origin="https://evil.example")
        self.assertNotIn("access-control-allow-origin", res.headers)
        self.assertEqual(res.status_code, 400)

    def test_methods_and_headers_the_app_does_not_use_are_refused(self):
        self.assertEqual(self.preflight(method="PUT").status_code, 400)
        self.assertEqual(self.preflight(headers="x-something-else").status_code, 400)

    def test_a_normal_response_carries_the_header_for_an_allowed_origin_only(self):
        ok = self.client.get("/health", headers={"Origin": self.ORIGIN})
        self.assertEqual(ok.headers["access-control-allow-origin"], self.ORIGIN)
        bad = self.client.get("/health", headers={"Origin": "https://evil.example"})
        self.assertNotIn("access-control-allow-origin", bad.headers)


class ChunkEndpointTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.set = self.make_set(self.user, notes=NOTES * 20)  # long enough for several chunks
        self.url = f"/sets/{self.set['id']}/chunks"

    def get(self, path="", **params):
        return self.client.get(self.url + path, params=params, headers=self.auth(self.user))

    def post(self, path, body=None, **params):
        return self.client.post(self.url + path, json=body, params=params, headers=self.auth(self.user))

    def test_lists_the_stored_chunks(self):
        body = self.get().json()
        self.assertGreater(len(body["chunks"]), 1)
        self.assertEqual(body["chunking"]["chunk_count"], len(body["chunks"]))
        self.assertEqual([c["chunk_index"] for c in body["chunks"]], list(range(len(body["chunks"]))))
        self.assertTrue(all(c["content"] for c in body["chunks"]))

    def test_content_can_be_left_out(self):
        self.assertTrue(all(c["content"] is None for c in self.get(include_content="false").json()["chunks"]))

    def test_rebuild_with_new_settings_replaces_the_chunks(self):
        before = len(self.get().json()["chunks"])
        res = self.post("/rebuild", {"chunk_size": 300, "chunk_overlap": 50})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()["chunking"]["chunk_size"], res.json()["chunking"]["chunk_overlap"]), (300, 50))
        self.assertGreater(len(self.get().json()["chunks"]), before)
        self.assertEqual(self.db.chunks.count_documents({}), len(self.get().json()["chunks"]))  # no duplicates left

    def test_rebuild_keeps_the_settings_you_leave_out(self):
        self.post("/rebuild", {"chunk_size": 300, "chunk_overlap": 50})
        res = self.post("/rebuild", {"chunk_size": 400})
        self.assertEqual((res.json()["chunking"]["chunk_size"], res.json()["chunking"]["chunk_overlap"]), (400, 50))

    def test_rebuild_rejects_bad_settings(self):
        for body in ({"chunk_size": 100}, {"chunk_size": 9000}, {"chunk_overlap": -1}, {"chunk_size": 300, "chunk_overlap": 300}):
            with self.subTest(body=body):
                self.assertEqual(self.post("/rebuild", body).status_code, 422)

    def test_embed_says_so_when_the_model_cannot_run(self):
        self.assertEqual(self.post("/embed").status_code, 503)  # the fake embedder finds nothing to embed

    def test_embed_needs_chunks_first(self):
        self.db.notes.update_one({"_id": models.parse_id(self.set["id"])}, {"$unset": {"chunking": ""}})
        self.assertEqual(self.post("/embed").status_code, 409)

    def test_keyword_search_finds_the_matching_chunk(self):
        # Search only looks at chunks stamped with the current embedding model. Keyword mode needs no vectors, though.
        self.db.chunks.update_many({}, {"$set": {"embedding_model": EMBED_MODEL}})
        res = self.get("/search", q="chloroplasts photosynthesis", mode="keyword", k=2)
        self.assertEqual(res.status_code, 200, res.text)
        hits = res.json()
        self.assertTrue(hits)
        self.assertIn("chloroplasts", hits[0]["chunk"]["content"])
        self.assertIsNone(hits[0]["cosine"])  # keyword mode has no similarity score

    def test_search_without_any_match_or_embeddings_is_a_409(self):
        self.assertEqual(self.get("/search", q="zzzzqqqq", mode="keyword").status_code, 409)

    def test_search_validates_its_input(self):
        for params in ({"q": "a"}, {"q": "x" * 501}, {"q": "ok", "k": 0}, {"q": "ok", "k": 21}, {"q": "ok", "mode": "magic"}, {}):
            with self.subTest(params=params):
                self.assertEqual(self.get("/search", **params).status_code, 422)

    def test_nobody_else_can_read_or_change_your_chunks(self):
        other = self.signup()
        for method, path in (("GET", ""), ("POST", "/rebuild"), ("POST", "/embed"), ("GET", "/search?q=mitochondria&mode=keyword")):
            with self.subTest(path=path):
                res = self.client.request(method, self.url + path, headers=self.auth(other))
                self.assertEqual(res.status_code, 404)
        self.assertGreater(self.db.chunks.count_documents({}), 0)


class AskEndpointTests(ApiTestCase):
    """The answer itself needs Groq and the embedding model. Here: who may ask, and what is refused up front."""

    def setUp(self):
        super().setUp()
        self.user = self.signup()
        self.set = self.make_set(self.user)

    def ask(self, body, headers=None, set_id=None):
        return self.client.post(
            f"/sets/{set_id or self.set['id']}/ask", json=body, headers=headers or self.auth(self.user)
        )

    def test_you_cannot_ask_about_someone_elses_set(self):
        other = self.signup()
        self.assertEqual(self.ask({"question": "What makes ATP?"}, headers=self.auth(other)).status_code, 404)

    def test_an_unknown_set_is_404(self):
        self.assertEqual(self.ask({"question": "What makes ATP?"}, set_id=ZERO_ID).status_code, 404)

    def test_validates_the_question(self):
        turns = [{"role": "user", "content": "hi"}] * 21
        bad = [{"question": "hi"}, {"question": "x" * 5000}, {}, {"question": "What?", "mode": "magic"}, {"question": "What?", "history": turns}]
        for body in bad:
            with self.subTest(body=str(body)[:60]):
                self.assertEqual(self.ask(body).status_code, 422)

    def test_a_set_that_cannot_be_embedded_gets_a_plain_503(self):
        res = self.ask({"question": "What makes ATP?"})  # the fake embedder produces nothing
        self.assertEqual(res.status_code, 503)
        self.assertIn("try again", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()
