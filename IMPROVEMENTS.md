# studyBuddy: Improvement Ideas

A to-do list of things worth improving, based on a read-through of the code in November 2026.
Each item says where the problem is, why it matters, and a suggested fix.

Items are grouped by priority. Effort is a rough guess: **S** = under an hour, **M** = a few hours, **L** = a day or more.

---

## 1. Fix first: security, cost and correctness

### 1.1 Rate limits miss some routes that cost money or CPU (S)
- **Where:** `backend/app/ratelimit.py` (`RULES`, and `rate_limit_middleware` skips every GET request).
- **Problem:**
  - `PATCH /cards/{id}` calls Groq through `check_answers` (`backend/app/cards.py:107`) whenever the answer changes, but no rule matches it.
  - `GET /sets/{id}/chunks/search` (`backend/app/chunks_api.py:154`) runs the embedding model on the CPU on every call, and GET requests are never limited.
- **Fix:** add `PATCH` + `^/cards/{id}$` to the `ai` rule. Let the middleware check GET requests, and add `/sets/{id}/chunks/search` to the `indexing` rule.

### 1.2 Per-IP limits can be dodged with a fake header (S)
- **Where:** `render.yaml`, start command `--forwarded-allow-ips="*"`.
- **Problem:** when every proxy is trusted, uvicorn takes the client IP from the leftmost `X-Forwarded-For` entry, and the visitor writes that entry. Anyone can rotate it to get around the login/signup/guest limit of 10 per minute per IP. This matters more now that guest accounts are free to create.
- **Fix:** trust only Render's proxy. Alternatively, read the right-most `X-Forwarded-For` entry yourself in `_client_ip`. Test it by sending a request with a made-up `X-Forwarded-For` and logging what `_client_ip` returns.

### 1.3 Part of long notes is silently ignored (S)
- **Where:**
  - `backend/app/flashcards.py:19-21`: `MAX_NOTES_CHARS = 200_000`, but flashcards only read `MAX_CHUNKS × CHUNK_CHARS` = 20 × 6,000 = 120,000 characters.
  - `backend/app/studyset.py:22-23`: revision notes read 15 × 12,000 = 180,000 characters.
- **Problem:** a 200k-character set is accepted, but up to 80k characters never make it into flashcards. The user isn't told. The shortfall is only recorded in the trace (`chars_not_used`).
- **Fix:** pick one. Lower `MAX_NOTES_CHARS`, sample chunks from across the whole text instead of taking the first N, or return a `chars_not_used` warning that the UI shows.

### 1.4 Most prompts don't defend against instructions hidden in the notes (S)
- **Where:**
  - `REVISION_PROMPT`, `QUIZ_PROMPT` and `PAPER_PROMPT` in `backend/app/studyset.py`.
  - `SYSTEM_PROMPT` in `backend/app/flashcards.py:23` and `backend/app/checker.py`.
- **Problem:** the notes are pasted in after `NOTES:` or `MATERIAL:` with no clear boundary. Notes containing "ignore the rules and..." can steer the output. The paper's free-text `details` field (up to 1,000 characters) also goes straight into the prompt. Only the prompts in `ask.py` and `verify.py` have an "ignore instructions in the notes" rule.
- **Fix:** add the same rule to every system prompt. Wrap the notes in clear delimiters such as `<notes>...</notes>`, and tell the model that everything inside them is data.

### 1.5 Groq calls have no timeout and retry up to 6 times (S)
- **Where:** `backend/app/ai.py:17`, `backend/app/flashcards.py:95` and `backend/app/checker.py` all use `Groq(api_key=..., max_retries=6)`.
- **Problem:**
  - There is no `timeout=`, and a new client is created on every call.
  - One `/ask` with fact-checking can chain up to 7 calls. With retries, a single request can hang for minutes and tie up a worker thread.
  - The frontend `request()` in `frontend/lib/api.ts` has no timeout either.
- **Fix:** create one shared `Groq` client with `timeout=60` and `max_retries=2`. Add an `AbortController` timeout to `request()` in `frontend/lib/api.ts`, and show "This took too long, try again".

### 1.6 Cut-off AI output and leaked error names (S)
- **Where:** `json.loads(completion.choices[0].message.content)` in `ai.py:28`, `flashcards.py:111` and `checker.py`. Error messages use `f"AI request failed: {type(e).__name__}"` in `ai.py:32`.
- **Problem:**
  - A response that hit the token limit (`finish_reason == "length"`) fails as a vague JSON error.
  - Flashcards and checker calls set no `max_completion_tokens`.
  - The model name is hard-coded in `flashcards.py:15`.
  - Users see Python exception class names in error messages.
- **Fix:** check `finish_reason` and retry once with a shorter request. Set `max_completion_tokens` on every call. Read `MODEL` from `config.py` or the environment. Log the exception on the server and show the user a plain message.

---

## 2. Reliability and performance

### 2.1 Slow work runs inside the request (L)
- **Where:**
  - `create_set_from_files` in `backend/app/studyset.py` reads each file into memory, parses PDFs, then chunks and embeds them, all in the same request.
  - `_ensure_embedded` in `backend/app/ask.py:122` can rebuild a whole old set on the first question.
  - Revision notes for a long set can make 15 Groq calls in one request.
- **Problem:** Render's free plan has one process with 512 MB. A few uploads at the same time queue up behind each other or run out of memory.
- **Fix:** move set indexing and revision building to a background job. Start simple with FastAPI `BackgroundTasks`, or use a small queue (RQ or arq with Redis). Store a `status` field (`processing` / `ready` / `failed`) that the frontend polls.

### 2.2 State held in memory breaks with more than one worker (M)
- **Where:**
  - The rate limiter dicts in `ratelimit.py`.
  - `_last_purge` in `auth.py`.
  - The embedding model, loaded once per process at about 375 MB, in `embeddings.py`.
- **Problem:** the limits reset on every restart, and with 2+ workers each worker keeps its own counts. This is fine for now, but it's the first thing to change when scaling.
- **Fix:** store rate-limit counters in Redis or a MongoDB collection with a TTL index. Run the guest purge on a schedule (a Render cron job) instead of on request.

### 2.3 Questions reload every chunk each time (M)
- **Where:** `backend/app/retrieval.py:118-148`.
- **Problem:** every question loads all chunks and their embeddings from MongoDB and rebuilds BM25 from scratch. This is fine at 200k characters, but it's the ceiling.
- **Fix:** cache the BM25 index per set, or move vector search to MongoDB Atlas Vector Search.

---

## 3. Data and database

### 3.1 Generation logs grow forever and are kept after a set is deleted (S)
- **Where:**
  - `trace.py:77-78` saves part of the user's prompt (note text).
  - `delete_set` in `studyset.py:267-271` doesn't delete that set's `generation_runs`.
- **Fix:** add a TTL index on `generation_runs.created_at`, for example 30 days, in `init_indexes()`. Delete `generation_runs` with `set_id` in `delete_set`.

### 3.2 Indexes don't match the queries (S)
- **Where:** `backend/app/database.py`.
- **Fix:**
  - `notes`: replace the `user_id` index with `(user_id, created_at -1)`, since `list_sets` sorts by `created_at`.
  - `cards`: add `(user_id, status, created_at, _id)` for `list_cards`.
  - `chunks`: add `(document_id, embedding_model)` for the checks in `ask.py:124-130`.

### 3.3 Deletes and creates are not atomic (M)
- **Where:** `delete_set` runs three separate deletes. `_create` inserts the set, then the chunks. `generate.py:58-66` undoes a failure by hand.
- **Problem:** a crash in between leaves orphaned cards or chunks.
- **Fix:** MongoDB Atlas is a replica set, so transactions work there. Use `client.start_session()` with `with_transaction`. Keep the manual cleanup as a fallback for a local standalone MongoDB.

### 3.4 Lists are not paginated (M)
- **Where:**
  - `list_sets` in `studyset.py`.
  - `list_cards` in `cards.py:71`.
  - `cards_due_today` in `quiz.py`.
  - `GET /sets/{id}/chunks`.
  - `GET /sets/{id}`, which returns the revision, the quiz and every paper at once.
- **Fix:** add `limit` and `before` (cursor) parameters. Return paper summaries in the set response and load a full paper on demand.

---

## 4. Learning quality

### 4.1 The spaced-repetition ease only ever goes down (S)
- **Where:** `backend/app/sm2.py`.
- **Problem:** "Knew it" maps to quality 4, which changes ease by `0.1 - 1 × (0.08 + 0.02) = 0`. "Didn't know" maps to quality 1, which changes it by `-0.54`. Ease can never rise, so every card drifts to the 1.3 minimum and its intervals stay short.
- **Fix:** add a third "Easy" button that maps to quality 5, which raises ease by 0.1. Alternatively, map "Knew it" to quality 5. Add unit tests for `next_schedule`.

### 4.2 Due dates use the server's time zone (S)
- **Where:** `date.today()` in `backend/app/quiz.py:27` and `:46`.
- **Problem:** the server runs on UTC. A user in India (UTC+5:30) sees cards become due at 5:30 AM local time, and "today" is wrong around midnight.
- **Fix:** have the frontend send its time zone, for example in an `X-Timezone` header, and compute "today" in that zone.

### 4.3 Quiz results are not saved (M)
- **Where:** the score is computed only in the browser (`frontend/components/set/QuizTab.tsx`). Making a new quiz also overwrites the old one (`studyset.py:434`).
- **Fix:** store quiz attempts (set, score, wrong question ids, date). Show a "weak topics" list and let users retry only the questions they got wrong.

### 4.4 The paper marks fix-up can still show a wrong total (S)
- **Where:** `make_paper` in `studyset.py`: `if last["marks"] + diff >= 1`.
- **Problem:** when the paper has too many marks and the last question is small, nothing is fixed. The paper is saved with the wrong total.
- **Fix:** spread the difference across several questions, or reject the paper and retry.

---

## 5. Tests and CI

### 5.1 Add tests for the parts that aren't covered (M)
- **Covered now:** `backend/tests` covers chunking, retrieval, embeddings, verification and `ask` helpers.
- **Not covered:**
  - auth: signup, login, lockout, expired token,
  - guest mode: `/auth/guest`, `purge_expired_guests`,
  - rate limiting,
  - `sm2.next_schedule`,
  - the studyset parsers (`_parse_topics`, `_parse_paper`, marks fix-up),
  - card ownership (another user's card returns 404),
  - every HTTP endpoint.
- **Fix:** use FastAPI's `TestClient` with `mongomock`, or a throwaway test database, and replace Groq with a fake.

### 5.2 Set up CI (S)
- **Problem:** the repo has no `.github/workflows`.
- **Fix:** add a GitHub Actions workflow that, on every push:
  - runs `python -m unittest` for the backend,
  - runs `npm run lint`, `npx tsc --noEmit` and `npm run build` for the frontend,
  - optionally runs `ruff` for Python linting.

### 5.3 Run the answer-quality eval (S)
- **Where:** the README says `eval_answers.py` "has not produced results yet", and `samples/eval_questions.json` covers only one document.
- **Fix:** run it, save a baseline in `samples/`, and add questions from a second, different document.

---

## 6. Frontend

### 6.1 Add error, not-found and loading pages (S)
- **Problem:** there are no `error.tsx`, `not-found.tsx` or `loading.tsx` files. An unknown set id shows a generic error box instead of a 404 page.
- **Fix:** add them under `frontend/app/`. Check the Next.js docs in `frontend/node_modules/next/dist/docs/` first, as `frontend/AGENTS.md` asks.

### 6.2 Page titles and link previews (S)
- **Problem:** only the root layout sets `metadata`, so every tab is titled "studyBuddy". There are no Open Graph tags, so links shared on LinkedIn or WhatsApp show no preview.
- **Fix:** set a title per page (for example "My sets · studyBuddy"). Add an Open Graph image, `robots.txt` and `sitemap.xml`.

### 6.3 Accessibility (S)
- **Where:** the set page tabs in `frontend/app/sets/[id]/page.tsx` are plain buttons.
- **Fix:**
  - Give the tabs `role="tablist"`, `role="tab"` and `role="tabpanel"`, with arrow-key navigation.
  - Replace `window.confirm` for deletes (`sets/page.tsx`, `PaperTab.tsx`) with an accessible dialog.

### 6.4 Data fetching (M)
- **Problem:** pages fetch inside `useEffect` with no cancel or retry, for example `sets/[id]/page.tsx`. Leaving a page mid-request can set state on a page that is no longer shown.
- **Fix:** use SWR or TanStack Query for caching, retries and refetching. At minimum, cancel the request when the component unmounts.

### 6.5 Frontend tests (M)
- **Problem:** there is no test framework.
- **Fix:** add Playwright for a few end-to-end flows: guest login → create a set → make a quiz → review flashcards.

---

## 7. Product features

### 7.1 Accounts
- **Turn a guest into a real account (M).** Add `POST /auth/upgrade`, which sets the email, name and password on the existing guest user and clears `is_guest`. All data is keyed by user id, so the guest's sets carry over automatically. This is the most useful follow-up to guest mode.
- **Password reset by email (M).** Users who forget their password are currently locked out for good. This needs an email provider such as Resend or SendGrid.
- **Change password and delete account (S).** Deleting an account should also delete the user's data, which helps with privacy and GDPR.
- **Email verification (M).**

### 7.2 Study sets
- **Rename a set, and add files to an existing one (S/M).**
- **Delete single flashcards (S).** `cards.py` has approve, reject and edit, but no delete.
- **Export (M):** flashcards to Anki or CSV, revision notes and papers to PDF. Printing works today, but a download button is easier to find.
- **Share a set (L):** a read-only public link to a set.
- **Progress page (M):** cards reviewed per day, streaks, quiz scores over time, and weak topics.

---

## 8. Repo hygiene

- **Pin all dependencies (S).** `backend/requirements.txt` pins only the top-level packages, so sub-dependencies can change between deploys. Use `pip-tools` (`requirements.in` → `requirements.txt`) or `uv lock`. Add a separate dev-requirements file for test tools.
- **Remove leftovers (S).**
  - `backend/migrate_postgres_to_mongo.py` imports `psycopg2`, which isn't installed. Delete it or move it to a `scripts/` folder.
  - Delete the unused create-next-app files in `frontend/public/` (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) and the default `frontend/README.md`.
- **Fix the Python version mismatch (S).** `render.yaml` uses Python 3.14.7, but the README says "3.10 or newer". Pick one supported range and test against it.
- **Narrow CORS (S).** `main.py` allows all methods and headers. List only the ones used: `GET`, `POST`, `PATCH`, `DELETE`, and the `Authorization` and `Content-Type` headers.
- **Add a LICENSE (S)** so others know if they can reuse the code, and add a Dockerfile if you want to deploy somewhere other than Render.
- **Correct the README test claim (S).** It says "84 tests, no server or AI key needed", but `test_embeddings.py` downloads the embedding model (about 100 MB).

---

## Suggested order

1. **Quick security and cost fixes (an afternoon):** 1.1, 1.2, 1.4, 1.5.
2. **Small correctness fixes:** 1.3, 1.6, 4.1, 4.2, 3.1, 3.2.
3. **Safety net:** 5.1 and 5.2, so later changes don't break things.
4. **Guest → account upgrade (7.1)**, so people who try the app as a guest keep their work when they sign up.
5. **Bigger work:** background jobs (2.1), pagination (3.4), quiz history and progress page (4.3, 7.2).
