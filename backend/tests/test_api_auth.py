"""Signup, login, tokens, lockout, guest mode and upgrading a guest, through the real HTTP routes."""

import time
import unittest
from datetime import timedelta

import jwt

from support import PASSWORD, ApiTestCase

from app import auth, models, ratelimit
from app.config import JWT_SECRET


def signup_body(email="ana@example.com", name="Ana", password=PASSWORD):
    return {"name": name, "email": email, "password": password}


class SignupTests(ApiTestCase):
    def test_signup_returns_a_token_that_works(self):
        res = self.client.post("/auth/signup", json=signup_body())
        self.assertEqual(res.status_code, 201)
        token = res.json()["access_token"]
        me = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["email"], "ana@example.com")
        self.assertEqual(me.json()["name"], "Ana")
        self.assertFalse(me.json()["is_guest"])

    def test_password_is_stored_as_a_hash(self):
        self.client.post("/auth/signup", json=signup_body())
        stored = self.db.users.find_one({"email": "ana@example.com"})
        self.assertNotIn(PASSWORD, str(stored))
        self.assertTrue(stored["password_hash"].startswith("$argon2"))

    def test_email_is_lowercased_and_trimmed(self):
        self.client.post("/auth/signup", json=signup_body(email="Ana@Example.COM"))
        self.assertIsNotNone(self.db.users.find_one({"email": "ana@example.com"}))

    def test_duplicate_email_is_rejected_whatever_the_case(self):
        self.assertEqual(self.client.post("/auth/signup", json=signup_body()).status_code, 201)
        again = self.client.post("/auth/signup", json=signup_body(email="ANA@example.com"))
        self.assertEqual(again.status_code, 409)
        self.assertEqual(self.db.users.count_documents({}), 1)

    def test_rejects_bad_input(self):
        bad = [
            signup_body(password="short"),  # under 8 characters
            signup_body(email="not-an-email"),
            signup_body(name=""),
            signup_body(name="   "),  # blank once trimmed
            {"email": "a@example.com", "password": PASSWORD},  # no name
        ]
        for body in bad:
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/auth/signup", json=body).status_code, 422)
        self.assertEqual(self.db.users.count_documents({}), 0)


class LoginTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.client.post("/auth/signup", json=signup_body())

    def login(self, email="ana@example.com", password=PASSWORD):
        # The login form is form-encoded, and the email goes in the "username" field
        return self.client.post("/auth/login", data={"username": email, "password": password})

    def test_login_with_the_right_password(self):
        res = self.login()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["token_type"], "bearer")

    def test_login_ignores_email_case(self):
        self.assertEqual(self.login(email="ANA@example.com").status_code, 200)

    def test_wrong_password_and_unknown_email_look_the_same(self):
        wrong = self.login(password="not the password")
        unknown = self.login(email="nobody@example.com")
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.json(), unknown.json())

    def test_account_locks_after_too_many_failures_even_for_the_right_password(self):
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", True)
        for _ in range(ratelimit.FAILED_LOGIN_LIMIT):
            ratelimit.record_failed_login("ana@example.com")
        res = self.login()  # the correct password
        self.assertEqual(res.status_code, 429)
        self.assertIn("Retry-After", res.headers)
        self.assertIn("failed logins", res.json()["detail"])

    def test_a_lock_on_one_account_does_not_block_another(self):
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", True)
        self.client.post("/auth/signup", json=signup_body(email="bo@example.com", name="Bo"))
        for _ in range(ratelimit.FAILED_LOGIN_LIMIT):
            ratelimit.record_failed_login("ana@example.com")
        self.assertEqual(self.login(email="bo@example.com").status_code, 200)

    def test_failed_logins_are_counted_against_the_account(self):
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", True)
        for _ in range(3):
            self.login(password="wrong password")
        self.assertEqual(len(ratelimit._failed_logins["ana@example.com"]), 3)

    def test_a_guest_cannot_log_in_with_a_password(self):
        self.client.post("/auth/guest")
        guest = self.db.users.find_one({"is_guest": True})
        self.assertEqual(self.login(email=guest["email"], password="anything").status_code, 401)
        self.assertEqual(self.login(email=guest["email"], password=PASSWORD).status_code, 401)


class TokenTests(ApiTestCase):
    def test_no_token_is_401(self):
        self.assertEqual(self.client.get("/auth/me").status_code, 401)

    def test_garbage_token_is_401(self):
        res = self.client.get("/auth/me", headers={"Authorization": "Bearer not.a.token"})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.headers["www-authenticate"], "Bearer")

    def test_expired_token_is_401(self):
        user = self.signup()
        expired = auth.create_access_token(user["id"], minutes=-1)
        res = self.client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})
        self.assertEqual(res.status_code, 401)

    def test_token_signed_with_another_secret_is_401(self):
        user = self.signup()
        forged = jwt.encode({"sub": user["id"]}, "x" * 40, algorithm="HS256")
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code, 401)

    def test_unsigned_token_is_401(self):
        user = self.signup()
        unsigned = jwt.encode({"sub": user["id"]}, None, algorithm="none")
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {unsigned}"}).status_code, 401)

    def test_token_without_a_user_id_is_401(self):
        token = jwt.encode({"foo": "bar"}, JWT_SECRET, algorithm="HS256")
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code, 401)

    def test_token_with_an_invalid_user_id_is_401(self):
        token = jwt.encode({"sub": "not-an-object-id"}, JWT_SECRET, algorithm="HS256")
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code, 401)

    def test_token_for_a_deleted_user_is_401(self):
        user = self.signup()
        self.db.users.delete_many({})
        self.assertEqual(self.client.get("/auth/me", headers=self.auth(user)).status_code, 401)


class GuestTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.patch_object(auth, "_last_purge", 0.0)

    def test_guest_gets_a_working_account(self):
        user = self.guest()
        me = self.client.get("/auth/me", headers=self.auth(user)).json()
        self.assertTrue(me["is_guest"])
        self.assertEqual(me["name"], "Guest")
        self.assertTrue(me["email"].endswith("@guest.invalid"))

    def test_every_guest_is_a_separate_account(self):
        self.assertNotEqual(self.guest()["id"], self.guest()["id"])

    def test_guest_can_use_the_app(self):
        user = self.guest()
        self.make_set(user)
        self.assertEqual(self.client.get("/sets", headers=self.auth(user)).json()["total"], 1)

    def test_guest_token_lasts_no_longer_than_the_guest_data(self):
        self.patch_object(auth, "GUEST_EXPIRE_MINUTES", 30)
        self.patch_object(auth, "JWT_EXPIRE_MINUTES", 1440)
        token = self.client.post("/auth/guest").json()["access_token"]
        claims = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        self.assertEqual(claims["exp"] - claims["iat"], 30 * 60)

    def test_guest_mode_can_be_turned_off(self):
        self.patch_object(auth, "GUEST_EXPIRE_MINUTES", 0)
        self.assertEqual(self.client.post("/auth/guest").status_code, 404)
        self.assertEqual(self.db.users.count_documents({}), 0)

    def test_a_signup_cannot_take_a_guest_address(self):
        res = self.client.post("/auth/signup", json=signup_body(email="guest-abc@guest.invalid"))
        self.assertEqual(res.status_code, 422)  # ".invalid" is not a valid address


class PurgeTests(ApiTestCase):
    """purge_expired_guests deletes old guests and everything they own, and nothing else."""

    def make_user(self, *, guest: bool, age_minutes: int, name: str) -> dict:
        doc = {
            "name": name,
            "email": f"{name}@example.com",
            "created_at": models.now() - timedelta(minutes=age_minutes),
        }
        if guest:
            doc["is_guest"] = True
        doc["_id"] = self.db.users.insert_one(doc).inserted_id
        note_id = self.db.notes.insert_one({"user_id": doc["_id"], "text": "x", "created_at": models.now()}).inserted_id
        self.db.cards.insert_one({"user_id": doc["_id"], "note_id": note_id})
        self.db.chunks.insert_one({"user_id": doc["_id"], "document_id": note_id, "chunk_index": 0})
        self.db.generation_runs.insert_one({"user_id": doc["_id"], "set_id": note_id})
        return doc

    def owned(self, user: dict) -> int:
        return sum(self.db[c].count_documents({"user_id": user["_id"]}) for c in ("notes", "cards", "chunks", "generation_runs"))

    def test_deletes_expired_guests_with_their_data(self):
        old = self.make_user(guest=True, age_minutes=auth.GUEST_EXPIRE_MINUTES + 5, name="old")
        self.assertEqual(auth.purge_expired_guests(self.db), 1)
        self.assertIsNone(self.db.users.find_one({"_id": old["_id"]}))
        self.assertEqual(self.owned(old), 0)

    def test_keeps_new_guests_real_users_and_upgraded_guests(self):
        fresh = self.make_user(guest=True, age_minutes=1, name="fresh")
        real = self.make_user(guest=False, age_minutes=auth.GUEST_EXPIRE_MINUTES * 10, name="real")
        self.assertEqual(auth.purge_expired_guests(self.db), 0)
        for user in (fresh, real):
            self.assertIsNotNone(self.db.users.find_one({"_id": user["_id"]}))
            self.assertEqual(self.owned(user), 4)

    def test_nothing_to_delete(self):
        self.assertEqual(auth.purge_expired_guests(self.db), 0)

    def test_creating_a_guest_clears_out_expired_ones(self):
        self.patch_object(auth, "_last_purge", -10_000_000.0)  # long enough ago that a clean-up is due
        old = self.make_user(guest=True, age_minutes=auth.GUEST_EXPIRE_MINUTES + 5, name="old")
        self.client.post("/auth/guest")
        self.assertIsNone(self.db.users.find_one({"_id": old["_id"]}))
        self.assertEqual(self.owned(old), 0)


class UpgradeTests(ApiTestCase):
    def upgrade(self, user, **overrides):
        return self.client.post("/auth/upgrade", json=signup_body(**overrides), headers=self.auth(user))

    def test_guest_becomes_a_real_account_and_keeps_its_sets(self):
        guest = self.guest()
        made = self.make_set(guest)

        res = self.upgrade(guest)
        self.assertEqual(res.status_code, 200)
        headers = {"Authorization": f"Bearer {res.json()['access_token']}"}

        me = self.client.get("/auth/me", headers=headers).json()
        self.assertEqual(me["id"], guest["id"])  # the same user, so the data stays attached
        self.assertEqual(me["email"], "ana@example.com")
        self.assertFalse(me["is_guest"])
        self.assertEqual([s["id"] for s in self.client.get("/sets", headers=headers).json()["items"]], [made["id"]])

    def test_upgraded_account_can_log_in_and_is_not_purged(self):
        guest = self.guest()
        self.upgrade(guest)
        login = self.client.post("/auth/login", data={"username": "ana@example.com", "password": PASSWORD})
        self.assertEqual(login.status_code, 200)
        self.db.users.update_one({"email": "ana@example.com"}, {"$set": {"created_at": models.now() - timedelta(days=30)}})
        self.assertEqual(auth.purge_expired_guests(self.db), 0)

    def test_upgrade_token_is_a_full_length_one(self):
        guest = self.guest()
        self.patch_object(auth, "GUEST_EXPIRE_MINUTES", 1)  # a guest token would last only a minute
        token = self.upgrade(guest).json()["access_token"]
        claims = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        self.assertEqual(claims["exp"] - claims["iat"], auth.JWT_EXPIRE_MINUTES * 60)

    def test_a_registered_user_cannot_upgrade(self):
        user = self.signup()
        self.assertEqual(self.upgrade(user, email="other@example.com").status_code, 409)

    def test_upgrade_with_a_taken_email_is_409_and_the_guest_stays_a_guest(self):
        self.signup(email="ana@example.com")
        guest = self.guest()
        self.assertEqual(self.upgrade(guest).status_code, 409)
        self.assertTrue(self.client.get("/auth/me", headers=self.auth(guest)).json()["is_guest"])

    def test_upgrade_needs_a_token(self):
        self.assertEqual(self.client.post("/auth/upgrade", json=signup_body()).status_code, 401)

    def test_upgrade_validates_the_form(self):
        guest = self.guest()
        self.assertEqual(self.upgrade(guest, password="short").status_code, 422)
        self.assertEqual(self.upgrade(guest, name="  ").status_code, 422)
        self.assertTrue(self.client.get("/auth/me", headers=self.auth(guest)).json()["is_guest"])


def token_issued_ago(user_id: str, seconds: int) -> str:
    """A valid token for the user that was made `seconds` ago."""
    issued = int(time.time()) - seconds
    return jwt.encode({"sub": user_id, "iat": issued, "exp": issued + 3600}, JWT_SECRET, algorithm="HS256")


class ChangePasswordTests(ApiTestCase):
    NEW = "a brand new passphrase"

    def setUp(self):
        super().setUp()
        self.user = self.signup(email="ana@example.com")

    def change(self, current=PASSWORD, new=NEW, headers=None):
        return self.client.post(
            "/auth/password",
            json={"current_password": current, "new_password": new},
            headers=headers or self.auth(self.user),
        )

    def login(self, password):
        return self.client.post("/auth/login", data={"username": "ana@example.com", "password": password})

    def test_the_new_password_works_and_the_old_one_does_not(self):
        self.assertEqual(self.change().status_code, 200)
        self.assertEqual(self.login(self.NEW).status_code, 200)
        self.assertEqual(self.login(PASSWORD).status_code, 401)

    def test_stores_a_hash_of_the_new_password(self):
        self.change()
        stored = self.db.users.find_one({"email": "ana@example.com"})
        self.assertNotIn(self.NEW, str(stored))
        self.assertTrue(stored["password_hash"].startswith("$argon2"))

    def test_returns_a_token_that_works(self):
        token = self.change().json()["access_token"]
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code, 200)

    def test_logins_made_before_the_change_stop_working(self):
        old = token_issued_ago(self.user["id"], 60)
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {old}"}).status_code, 200)
        self.change()
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {old}"}).status_code, 401)

    def test_a_wrong_current_password_changes_nothing(self):
        res = self.change(current="not my password")
        self.assertEqual(res.status_code, 403)  # not 401: the frontend would take that for an expired login
        self.assertEqual(self.login(PASSWORD).status_code, 200)
        self.assertNotIn("password_changed_at", self.db.users.find_one({"email": "ana@example.com"}))

    def test_wrong_guesses_are_counted_against_the_account(self):
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", True)
        for _ in range(3):
            self.change(current="guess")
        self.assertEqual(len(ratelimit._failed_logins["ana@example.com"]), 3)

    def test_a_locked_account_cannot_change_its_password_even_with_the_right_one(self):
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", True)
        for _ in range(ratelimit.FAILED_LOGIN_LIMIT):
            ratelimit.record_failed_login("ana@example.com")  # recorded directly: the per-IP limit would stop 11 requests
        before = self.db.users.find_one({"email": "ana@example.com"})["password_hash"]
        res = self.change()
        self.assertEqual(res.status_code, 429)
        self.assertIn("Retry-After", res.headers)
        self.assertEqual(self.db.users.find_one({"email": "ana@example.com"})["password_hash"], before)

    def test_the_new_password_must_be_valid_and_different(self):
        self.assertEqual(self.change(new="short").status_code, 422)
        self.assertEqual(self.change(new=PASSWORD).status_code, 422)
        self.assertEqual(self.change(current="").status_code, 422)
        self.assertEqual(self.login(PASSWORD).status_code, 200)

    def test_guests_have_no_password_to_change(self):
        guest = self.guest()
        self.assertEqual(self.change(headers=self.auth(guest)).status_code, 409)

    def test_needs_a_login(self):
        res = self.client.post("/auth/password", json={"current_password": PASSWORD, "new_password": self.NEW})
        self.assertEqual(res.status_code, 401)

    def test_other_accounts_are_not_affected(self):
        other = self.signup(email="bo@example.com")
        self.change()
        self.assertEqual(self.client.get("/auth/me", headers=self.auth(other)).status_code, 200)


class DeleteAccountTests(ApiTestCase):
    def delete(self, user, password=PASSWORD):
        body = {} if password is None else {"password": password}
        return self.client.post("/auth/delete-account", json=body, headers=self.auth(user))

    def seed(self, user):
        made = self.make_set(user)
        self.add_card(user, made["id"])
        self.db.generation_runs.insert_one({"user_id": models.parse_id(user["id"]), "set_id": models.parse_id(made["id"])})

    def owned(self, user) -> int:
        uid = models.parse_id(user["id"])
        return sum(self.db[c].count_documents({"user_id": uid}) for c in ("notes", "cards", "chunks", "generation_runs"))

    def test_deletes_the_account_and_all_its_data(self):
        user = self.signup(email="ana@example.com")
        self.seed(user)
        self.assertGreater(self.owned(user), 3)
        self.assertEqual(self.delete(user).status_code, 204)
        self.assertEqual(self.owned(user), 0)
        self.assertIsNone(self.db.users.find_one({"email": "ana@example.com"}))

    def test_the_account_can_no_longer_be_used(self):
        user = self.signup(email="ana@example.com")
        self.delete(user)
        self.assertEqual(self.client.get("/auth/me", headers=self.auth(user)).status_code, 401)
        login = self.client.post("/auth/login", data={"username": "ana@example.com", "password": PASSWORD})
        self.assertEqual(login.status_code, 401)

    def test_the_email_can_be_used_again(self):
        user = self.signup(email="ana@example.com")
        self.delete(user)
        self.signup(email="ana@example.com")

    def test_other_users_data_is_untouched(self):
        user, other = self.signup(), self.signup()
        self.seed(user)
        self.seed(other)
        before = self.owned(other)
        self.delete(user)
        self.assertEqual(self.owned(other), before)
        self.assertEqual(self.client.get("/sets", headers=self.auth(other)).json()["total"], 1)

    def test_a_wrong_or_missing_password_deletes_nothing(self):
        user = self.signup()
        self.seed(user)
        before = self.owned(user)
        for password in ("wrong password", None, ""):
            with self.subTest(password=password):
                self.assertEqual(self.delete(user, password).status_code, 403)
        self.assertEqual(self.owned(user), before)
        self.assertEqual(self.client.get("/auth/me", headers=self.auth(user)).status_code, 200)

    def test_wrong_guesses_are_counted_against_the_account(self):
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", True)
        user = self.signup(email="ana@example.com")
        for _ in range(3):
            self.delete(user, "guess")
        self.assertEqual(len(ratelimit._failed_logins["ana@example.com"]), 3)

    def test_a_locked_account_cannot_be_deleted_even_with_the_right_password(self):
        self.patch_object(ratelimit, "RATE_LIMIT_ENABLED", True)
        user = self.signup(email="ana@example.com")
        for _ in range(ratelimit.FAILED_LOGIN_LIMIT):
            ratelimit.record_failed_login("ana@example.com")  # recorded directly: the per-IP limit would stop 11 requests
        self.assertEqual(self.delete(user).status_code, 429)
        self.assertEqual(self.client.get("/auth/me", headers=self.auth(user)).status_code, 200)

    def test_a_guest_can_delete_without_a_password(self):
        guest = self.guest()
        self.seed(guest)
        self.assertEqual(self.delete(guest, None).status_code, 204)
        self.assertEqual(self.owned(guest), 0)
        self.assertEqual(self.db.users.count_documents({}), 0)

    def test_needs_a_login(self):
        self.assertEqual(self.client.post("/auth/delete-account", json={"password": PASSWORD}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
