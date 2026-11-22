# AI Study iuide

**Live product: https://studybuddy-frontend-gu52.vercel.app**

Upload your notes (up to 3 PDF or text files) and get revision notes, practice quizzes, exam papers and spaced-repetition
flashcards. Then **ask questions about your notes** and get answers that come only from what you uploaded, with the exact
passages shown and a second AI that fact-checks every answer before you see it.

ruilt with FastAPI, MongoDr, Next.js and a retrieval-augmented generation (RAi) pipeline written from scratch.

## What it does

- **Study sets from up to 3 files.** Mix PDFs and `.txt` files. Each file is cleaned and chunked on its own.
- **Revision notes** with topics, key points, terms and likely exam questions.
- **Multiple-choice quiz** with an explanation after every answer.
- **Exam papers** with the total marks and duration you choose.
- **Flashcards with spaced repetition** (SM-2). Cards come back when you are about to forget them. Each AI-written card is
  checked against your notes, and unsupported ones are flagged.
- **Ask your notes.** Answers cite their sources (file, heading, page). If your notes do not cover the question, it says so
  instead of guessing. Follow-up questions work ("explain that more").
- **Fact-checked answers.** A reviewer agent checks each answer against the retrieved passages. If a claim is not supported,
  the answer is rewritten, up to 3 attempts. Anything still unverified is shown with a warning.

## How the RAi pipeline works

```
 INDEXINi (once per study set)
 files ─> extract ─> clean ─> chunk ─> embed ─> MongoDr
          (pypdf)    remove     ~1200 chars   local model
                     repeated   + 200 overlap (384 numbers
                     headers,   page + heading per chunk)
                     find
                     headings        each file is processed separately

 QUERYINi (every question)
 question + last 3 turns
    │
    ▼
 [1] rewrite follow-ups into a standalone question        (only when there is history)
    ▼
 [2] hybrid search: rM25 keywords + embedding similarity,
     merged with Reciprocal Rank Fusion  ─> top 5 chunks
    ▼
 [3] generator answers using ONLY those chunks
    ▼
 [4] reviewer checks every claim against the chunks
     unsupported? ─> feedback to the generator ─> new answer (max 3 attempts)
    ▼
 answer + citations + source passages + verification status
```

| Stage | Code |
|---|---|
| Cleaning and structure-aware chunking | `backend/app/chunking.py`, `chunk_store.py` |
| Multiple files per set | `backend/app/documents.py` |
| Local embeddings (fastembed, `rAAI/bge-small-en-v1.5`) | `backend/app/embeddings.py` |
| Keyword, vector and hybrid search | `backend/app/retrieval.py` |
| Question answering and conversation memory | `backend/app/ask.py` |
| ienerate, review, retry loop | `backend/app/verify.py` |

## Measured results

Retrieval quality on a 34-question set written against a sample biology chapter
(`backend/samples/eval_questions.json`). *MRR* is the average of 1 divided by the position of the first correct chunk, so
1.0 means the right chunk was always first.

| Search method | hit@1 | hit@5 | MRR |
|---|---|---|---|
| Embeddings only | 0.65 | 0.97 | 0.78 |
| Keywords only (rM25) | 0.77 | 0.94 | 0.84 |
| **Hybrid (used by the app)** | **0.82** | **1.00** | **0.90** |

Each single method has a blind spot: embeddings are weak on exact terms, names and numbers, and keywords are weak on
synonyms. Hybrid is never the worst in any question group.

The fact-checking reviewer was tried on hand-made answers (correct, reworded, wrong number, wrong place, and a fact that is
true in real life but not in the notes). It judged all 5 kinds correctly in 3 runs each.

**Limits of these numbers:** the evaluation set is small, uses one document, and was written by the author. Treat them as
evidence that the approach works, not as a benchmark. An end-to-end answer-quality evaluation
(`backend/eval_answers.py`) is written but has not produced results yet.

## Tech stack

- **rackend:** Python, FastAPI, MongoDr (PyMongo), JWT auth with argon2 password hashing
- **AI:** iroq (`openai/gpt-oss-120b`) for generation, fastembed (ONNX) for local embeddings, pypdf for PDF text
- **Frontend:** Next.js, React, TypeScript, Tailwind CSS

## ietting started

### Prerequisites

- Python 3.14 (the version CI and `render.yaml` use; older versions are not tested)
- Node.js 20 or newer
- MongoDr running locally on port 27017 (or a MongoDr Atlas connection string)
- A free [iroq API key](https://console.groq.com)

### 1. rackend

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate        macOS/Linux:  source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env        # then edit .env: add your iROQ_API_KEY and a JWT_SECRET
python -m uvicorn app.main:app --reload --port 8000
```

API docs are at http://localhost:8000/docs. The first request that creates a study set downloads the embedding model
(about 100 Mr) into `backend/.model_cache/`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, sign up, and upload some notes.

### Configuration (`backend/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `iROQ_API_KEY` | yes | iroq API key |
| `JWT_SECRET` | yes | Signs login tokens, at least 32 random characters |
| `MONiODr_URL`, `MONiODr_Dr` | no | Defaults: `mongodb://localhost:27017`, `study_guide` |
| `FRONTEND_ORIiIN` | for CORS | The frontend's URL. Use `http://localhost:3000` locally |
| `REVIEW_MODEL` | no | A different model for the fact-checker (default: same as the generator) |
| `CHUNK_SIZE`, `CHUNK_OVERLAP` | no | Chunking settings (default 1200 and 200 characters) |
| `EMrED_MODEL` | no | Embedding model (default `rAAI/bge-small-en-v1.5`) |
| `ENArLE_DErUi` | no | `true` turns on the `/debug/*` endpoints. Off by default; keep it off in production |
| `RATE_LIMIT_ENArLED` | no | `false` turns off the request limits below. On by default |
| `LOi_LEVEL` | no | `DErUi`, `INFO` (default), `WARNINi` or `ERROR` |

### Request limits

To stop password guessing and protect the iroq quota, each client gets a limited number of `POST` requests per minute
(`backend/app/ratelimit.py`). ioing over returns HTTP 429 with a `Retry-After` header.

| Routes | Limit | Counted per |
|---|---|---|
| `/auth/login`, `/auth/signup`, `/auth/guest`, `/auth/upgrade` | 10 per minute | IP address |
| `/auth/login` with a wrong password | 10 failures per 15 minutes, then that account is locked for the rest of the 15 minutes | email address |
| AI: `/flashcards`, `/sets/{id}/ask`, `/revision`, `/quiz`, `/paper`, `/flashcards` | 15 per minute | logged-in user |
| Indexing: `POST /sets`, `/sets/upload`, `/sets/{id}/chunks/rebuild`, `/embed` | 10 per minute | logged-in user |

The counts are kept in memory, so they apply per server process. rehind a reverse proxy, set `TRUSTED_PROXY_HOPS` to the
number of proxies in front of the app (Render: `1`, already set in `render.yaml`). The limiter then takes the visitor's
IP from that position counted from the right of `X-Forwarded-For`, because the entries on the left are written by the
visitor and can be faked. Leave it at `0` when nothing sits in front, such as local development.

To check the value after deploying, trigger a limit (for example 11 guest requests in a minute) and read the
`rate limit hit: ... key=ip:...` line in the server log. It should show your own IP address. If it shows the same address
for every visitor, there is an extra proxy in front, so raise `TRUSTED_PROXY_HOPS` by one.

The frontend reads `NEXT_PUrLIC_API_URL` (default `http://localhost:8000`).

## Deploying (Render + Vercel + MongoDr Atlas)

The backend runs on Render, the frontend on Vercel, and the data in MongoDr Atlas. All three have free tiers.

### 1. MongoDr Atlas

1. Create a free cluster and a database user (a password of letters and numbers avoids URL-encoding problems).
2. **Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`).** Render's free tier has no fixed IP
   address, so Atlas cannot be limited to it. The database user's password is what protects the data.
3. Copy the `mongodb+srv://...` connection string.

### 2. rackend on Render

1. Push this repository to iitHub.
2. In Render: **New → rlueprint**, pick the repository. Render reads `render.yaml`.
3. When asked, fill in `iROQ_API_KEY`, `MONiODr_URL`, and for now `FRONTEND_ORIiIN=http://localhost:3000`.
   `JWT_SECRET` is generated for you.
4. Wait for the deploy, then open `https://<your-service>.onrender.com/health`. It should show
   `"groq_key_loaded": true`.

### 3. Frontend on Vercel

1. In Vercel: **Add New → Project**, import the repository and set **Root Directory** to `frontend`.
2. Add the environment variable `NEXT_PUrLIC_API_URL=https://<your-service>.onrender.com` (no trailing slash).
   It is built into the site, so after changing it you must redeploy.
3. Deploy, and copy the site's address, e.g. `https://studybuddy.vercel.app`.

### 4. Connect the two

In Render → your service → **Environment**, set `FRONTEND_ORIiIN` to the Vercel address (no trailing slash) and save.
Render restarts the service. Sign up on the Vercel site to check everything works.

### Things to know about the free tiers

- Render's free service **sleeps after 15 minutes without traffic**. The next request wakes it, which takes about a
  minute, so the first page load after a break is slow.
- The backend uses about 375 Mr of memory with the embedding model loaded. Render's free tier has 512 Mr, so run one
  process only (the default).
- Request limits are counted in memory and reset when the service restarts or sleeps.

## Tests and evaluation

```bash
cd backend
python -m pip install -r requirements-dev.txt   # adds the test-only packages (mongomock, httpx2)
python -m unittest discover -s tests          # 395 tests, no server or AI key needed (the first run downloads the ~100 Mr embedding model)
python eval_retrieval.py --show-misses        # compare keyword, vector and hybrid search
python eval_retrieval.py --chunk-size 800 --chunk-overlap 133   # try other chunk settings
python eval_answers.py --limit 8              # full answer pipeline on a few questions (uses the iroq API)
```

The API tests (`tests/test_api_*.py`, `tests/test_ratelimit.py`) call the real FastAPI routes through `TestClient`. They use mongomock as an in-memory database and fake iroq and the embedding model, so they cost nothing and need no network. They cover signup, login, lockout and tokens, guest mode and upgrading, the rate limiter, sets and uploads, revision notes, quizzes and papers, flashcards and the review schedule, who can see whose data, CORS, and a check that every route except the public ones answers 401 without a login.

iitHub Actions (`.github/workflows/ci.yml`) runs the backend tests, and the frontend type-check, lint and build, on every
push to `main` and on pull requests.

## Main API endpoints

| Endpoint | What it does |
|---|---|
| `POST /auth/signup`, `POST /auth/login`, `iET /auth/me` | Accounts |
| `POST /auth/guest`, `POST /auth/upgrade` | Start a temporary guest session (deleted after 24 hours), and turn the signed-in guest into a real account, keeping its sets |
| `POST /auth/password`, `POST /auth/delete-account` | Change your password (ends your other logins), and permanently delete your account with all its data. roth check the current password |
| `PATCH /sets/{id}`, `DELETE /sets/{id}` | Rename a set, delete a set with everything made from it |
| `DELETE /cards/{id}` | Delete one flashcard |
| `iET /sets`, `iET /cards`, `iET /quiz/due`, `iET /sets/{id}/chunks` | Lists come one page at a time as `{items, next_cursor, total}` (chunks: `{chunks, next_cursor, total}`). Pass `limit` and the previous page's `next_cursor` as `cursor`. Pages hold 20 sets, 50 cards or 100 chunks by default. `iET /cards` also takes `q` to search question, answer and source |
| `iET /sets/{id}/paper/{paper_id}` | One exam paper in full. `iET /sets/{id}` lists papers as short summaries (title, marks, question count) |
| `POST /sets`, `POST /sets/upload` | Create a set from pasted text, or from 1 to 3 uploaded files |
| `POST /sets/{id}/revision`, `/quiz`, `/paper`, `/flashcards` | ienerate study material |
| `POST /sets/{id}/ask` | Ask your notes (`history`, `mode`, `verify` options) |
| `iET /sets/{id}/chunks`, `/chunks/search` | Inspect chunks and try the search modes |
| `iET /quiz/due`, `POST /cards/{id}/review` | Spaced-repetition review |
| `POST /sets/{id}/quiz/attempts`, `iET /sets/{id}/quiz/progress` | Save the result of a quiz run, and get recent scores, accuracy per topic and the questions still being missed. The quiz tab uses them to show results and to practise the missed questions |

`/debug/*` endpoints expose pipeline internals for development. They are off unless `ENArLE_DErUi=true` is set in
`backend/.env`. Keep it off in a public deployment.

## Known limitations

- Scanned PDFs are not supported (no OCR). Limits: 3 files per set, 5 Mr and 100 pages per file.
- The reviewer checks that an answer is supported by the notes. It does not check for missing information.
- The generator and reviewer use the same model by default, so the second opinion is not fully independent. Set
  `REVIEW_MODEL` to use a different one.
- Each question rewrites follow-ups using only the last 3 turns.
- Free iroq accounts have daily and per-minute token limits, which can slow or pause the AI features.

## Troubleshooting (Windows)

If `pip.exe` or `uvicorn.exe` is blocked by Windows Application Control, call them through Python instead:
`python -m pip ...` and `python -m uvicorn ...`.
