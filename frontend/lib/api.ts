// Base URL of the FastAPI backend. Override with NEXT_PUBLIC_API_URL in frontend/.env.local
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type CardStatus = "pending" | "approved" | "rejected";

export type Card = {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  source: string;
  status: CardStatus;
  created_at: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_date: string | null; // YYYY-MM-DD, null = never reviewed
  check_status: "supported" | "flagged" | null; // null = never checked
  check_reason: string | null;
};

// One page of a long list. Pass next_cursor back to get the following page; null means there is none.
export type Page<T> = {
  items: T[];
  next_cursor: string | null;
  total: number; // how many items there are in all, not just on this page
};

export type CheckStats = {
  checked: number;
  supported: number;
  flagged: number;
  flagged_rate: number; // 0-1
};

export type GenerateResult = {
  note_id: string;
  cards: Card[];
  dropped: number;
};

export type User = { id: string; email: string; name: string | null; created_at: string | null; is_guest?: boolean };

// A file a study set was made from. A set holds up to MAX_FILES of them.
export const MAX_FILES = 3;
export type SetFile = { name: string; type: "pdf" | "txt" | "text"; chars: number; pages: number | null };

export type StudySetSummary = {
  id: string;
  title: string;
  subject: string;
  level: string;
  created_at: string;
  chars: number;
  has_revision: boolean;
  has_quiz: boolean;
  paper_count: number;
  card_count: number;
  files: SetFile[];
};

export type Topic = {
  title: string;
  explanation: string;
  key_points: string[];
  terms: { term: string; meaning: string }[];
  likely_questions: string[];
};

// topic is a short name for what the question is about. Empty on quizzes made before topics existed.
export type QuizQuestion = { question: string; options: string[]; answer_index: number; explanation: string; topic: string };

// One answered question of a quiz run, as saved with the result
export type QuizAnswer = QuizQuestion & { chosen_index: number };
export type QuizAttempt = { id: string; created_at: string; score: number; total: number };
export type TopicStat = { topic: string; answered: number; correct: number };
export type QuizProgress = {
  attempts: number;
  recent: QuizAttempt[]; // newest first
  topics: TopicStat[]; // weakest first
  missed: QuizQuestion[]; // questions whose latest answer was wrong, ready to be asked again
};

export type PaperQuestion = {
  number: number;
  question: string;
  marks: number;
  options: string[];
  answer: string;
  marking_scheme: string;
};

export type Paper = {
  id: string;
  created_at: string;
  title: string;
  total_marks: number;
  duration_minutes: number | null;
  instructions: string[];
  sections: { name: string; instructions: string; questions: PaperQuestion[] }[];
};

// What the set page lists for each exam paper. The questions come from api.getPaper when it is opened.
export type PaperSummary = {
  id: string;
  created_at: string;
  title: string;
  total_marks: number;
  duration_minutes: number | null;
  question_count: number;
};

export type StudySet = StudySetSummary & {
  revision: Topic[] | null;
  quiz: QuizQuestion[] | null;
  papers: PaperSummary[];
};

export type AskSource = {
  number: number; // the [n] used in the answer
  chunk_index: number;
  source: string | null; // which file the passage is from
  page_number: number | null;
  heading: string | null;
  snippet: string;
  text: string;
  score: number | null; // cosine similarity, null in keyword mode
};
export type SearchMode = "hybrid" | "vector" | "keyword";
export type AskTurn = { question: string; answer: string };
export type VerificationRound = { attempt: number; supported: boolean | null; issues: string[] };
export type Verification = {
  // verified: the reviewer found every claim in the notes. unverified: still failing after the last attempt.
  // unchecked: the review was off or could not run. not_applicable: the notes do not cover the question.
  status: "verified" | "unverified" | "unchecked" | "not_applicable";
  attempts: number; // answers the generator wrote
  max_attempts: number;
  rounds: VerificationRound[];
};
export type AskResult = {
  search_query: string; // what was searched: the question, or its standalone rewrite after a follow-up
  mode: SearchMode;
  found: boolean;
  answer: string;
  sources: AskSource[];
  verification: Verification;
};

export type SetDetails ={ title: string; subject: string; level: string };

// The login token lives in localStorage so it survives a refresh and browser restarts ("Remember me").
// Without "Remember me" it goes in sessionStorage instead, which the browser clears when it closes.
// Trade-off: any script running on the page (e.g. from an XSS bug) could read it. httpOnly cookies
// avoid that but need CSRF handling.
const TOKEN_KEY = "study_guide_token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string, remember = true) {
    try {
      tokenStore.clear();
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {}
  },
  // True if the token was saved with "Remember me" (it survives closing the browser)
  persistent(): boolean {
    try {
      return localStorage.getItem(TOKEN_KEY) !== null;
    } catch {
      return false;
    }
  },
};

// Longest we wait for the backend. The slowest calls (exam papers, fact-checked answers) make several AI calls in a row,
// so this is generous; it only stops a stuck request from leaving the page spinning forever.
const REQUEST_TIMEOUT_MS = 180_000;

// An error response from the backend. The message is the text to show; status lets callers tell, for example, a
// missing set (404) from a server problem.
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Today's date in the browser's time zone, as YYYY-MM-DD
export function localDate(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// A request that only reads can safely be sent again, so it is retried when the connection fails or the server says it is
// briefly unavailable (the free host answers 502/503 while it wakes up). Anything that changes data or costs an AI call
// is never retried: sending it twice could do it twice.
const RETRY_DELAYS_MS = [700, 1500];
const RETRY_STATUSES = new Set([502, 503, 504]);

// Waits, but stops at once with the abort reason if the caller gives up meanwhile
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// True for the error a request throws when the caller cancelled it. That is not a failure to show to anyone.
export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Pass `signal` in init to cancel the request, for instance when the page that asked for it is closed
async function request<T>(path: string, init?: RequestInit, { auth = true } = {}): Promise<T> {
  const headers = new Headers(init?.headers);
  // JSON bodies are strings; FormData and URLSearchParams set their own content type
  if (typeof init?.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = auth ? tokenStore.get() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // The user's calendar day, so cards fall due by their clock and not the server's (which runs on UTC)
  headers.set("X-Client-Date", localDate());

  const canRetry = !init?.method || init.method.toUpperCase() === "GET";
  const callerSignal = init?.signal ?? undefined; // RequestInit also allows null
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    const wait = RETRY_DELAYS_MS[attempt];
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers,
        signal: callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout,
      });
    } catch (err) {
      if (callerSignal?.aborted) throw err; // the caller cancelled: pass that on as it is
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error("The server took too long to respond. Please try again.");
      }
      if (canRetry && wait !== undefined) {
        await sleep(wait, callerSignal);
        continue;
      }
      throw new Error("Can't reach the server. Is the backend running on " + API_URL + "?");
    }
    if (canRetry && wait !== undefined && RETRY_STATUSES.has(res.status)) {
      await sleep(wait, callerSignal);
      continue;
    }
    break;
  }

  if (!res.ok) {
    // Expired or invalid token: drop it and send the user to log in again
    if (res.status === 401 && token) {
      tokenStore.clear();
      // Full reload on purpose (not the router): wipes any stale per-user page state
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      // FastAPI sends {detail: "text"} for our errors and {detail: [...]} for validation errors
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join(", ");
    } catch {}
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

type Token = { access_token: string; token_type: string };

// "?a=1&b=2" from the params that have a value, or "" when none do
function queryString(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const api = {
  signup: (name: string, email: string, password: string) =>
    request<Token>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) }, { auth: false }),
  // The backend's login takes form fields (OAuth2 standard), with the email in "username"
  login: (email: string, password: string) =>
    request<Token>(
      "/auth/login",
      { method: "POST", body: new URLSearchParams({ username: email, password }) },
      { auth: false },
    ),
  me: () => request<User>("/auth/me"),
  guest: () => request<Token>("/auth/guest", { method: "POST" }, { auth: false }),
  // Turns the signed-in guest into a real account (same user, so their sets stay). Needs the guest's token.
  upgrade: (name: string, email: string, password: string) =>
    request<Token>("/auth/upgrade", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  // Returns a new token: the change ends every other login of the account, including this one
  changePassword: (currentPassword: string, newPassword: string) =>
    request<Token>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
  // Deletes the account and all its data. A guest has no password, so it sends none.
  deleteAccount: (password: string | null) =>
    request<void>("/auth/delete-account", { method: "POST", body: JSON.stringify({ password }) }),

  generate: (notes: string, maxCards: number) =>
    request<GenerateResult>("/flashcards", {
      method: "POST",
      body: JSON.stringify({ notes, max_cards: maxCards }),
    }),
  upload: (file: File, maxCards: number) => {
    const form = new FormData();
    form.append("file", file);
    form.append("max_cards", String(maxCards));
    return request<GenerateResult>("/flashcards/upload", { method: "POST", body: form });
  },
  listSets: (cursor: string | null = null, signal?: AbortSignal) =>
    request<Page<StudySetSummary>>(`/sets${queryString({ cursor })}`, { signal }),
  getSet: (id: string, signal?: AbortSignal) => request<StudySet>(`/sets/${id}`, { signal }),
  createSet: (notes: string, d: SetDetails) => request<StudySet>("/sets", { method: "POST", body: JSON.stringify({ notes, ...d }) }),
  createSetFromFiles: (files: File[], d: SetDetails) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("title", d.title);
    form.append("subject", d.subject);
    form.append("level", d.level);
    return request<StudySet>("/sets/upload", { method: "POST", body: form });
  },
  deleteSet: (id: string) => request<void>(`/sets/${id}`, { method: "DELETE" }),
  renameSet: (id: string, title: string) =>
    request<StudySet>(`/sets/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  makeRevision: (id: string) => request<StudySet>(`/sets/${id}/revision`, { method: "POST" }),
  makeQuiz: (id: string, count: number) =>
    request<StudySet>(`/sets/${id}/quiz`, { method: "POST", body: JSON.stringify({ count }) }),
  saveQuizAttempt: (id: string, answers: QuizAnswer[]) =>
    request<QuizAttempt>(`/sets/${id}/quiz/attempts`, { method: "POST", body: JSON.stringify({ answers }) }),
  quizProgress: (id: string, signal?: AbortSignal) => request<QuizProgress>(`/sets/${id}/quiz/progress`, { signal }),
  makePaper: (id: string, body: { total_marks: number; duration_minutes: number | null; details: string }) =>
    request<StudySet>(`/sets/${id}/paper`, { method: "POST", body: JSON.stringify(body) }),
  getPaper: (id: string, paperId: string, signal?: AbortSignal) => request<Paper>(`/sets/${id}/paper/${paperId}`, { signal }),
  deletePaper: (id: string, paperId: string) => request<StudySet>(`/sets/${id}/paper/${paperId}`, { method: "DELETE" }),
  makeSetFlashcards: (id: string, maxCards: number) =>
    request<GenerateResult>(`/sets/${id}/flashcards`, { method: "POST", body: JSON.stringify({ max_cards: maxCards }) }),
  askSet: (id: string, question: string, history: AskTurn[] = [], mode: SearchMode = "hybrid", verify = true) =>
    request<AskResult>(`/sets/${id}/ask`, { method: "POST", body: JSON.stringify({ question, history, mode, verify }) }),
  // q: only cards whose question, answer or source contain this text
  listCards: (
    status: CardStatus,
    { q = "", cursor = null, signal }: { q?: string; cursor?: string | null; signal?: AbortSignal } = {},
  ) => request<Page<Card>>(`/cards${queryString({ status, q: q.trim(), cursor })}`, { signal }),
  checkStats: (signal?: AbortSignal) => request<CheckStats>("/stats/checks", { signal }),
  dueCards: (cursor: string | null = null, signal?: AbortSignal) =>
    request<Page<Card>>(`/quiz/due${queryString({ cursor })}`, { signal }),
  review: (id: string, knew: boolean, easy = false) =>
    request<Card>(`/cards/${id}/review`, { method: "POST", body: JSON.stringify({ knew, easy }) }),
  approve: (id: string) => request<Card>(`/cards/${id}/approve`, { method: "POST" }),
  reject: (id: string) => request<Card>(`/cards/${id}/reject`, { method: "POST" }),
  edit: (id: string, fields: { question?: string; answer?: string }) =>
    request<Card>(`/cards/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  deleteCard: (id: string) => request<void>(`/cards/${id}`, { method: "DELETE" }),
};
