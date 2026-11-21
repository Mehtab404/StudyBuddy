"use client";

import { useState } from "react";
import { ErrorBox, card, chip, errorMessage, inputClass, label, primaryButton, secondaryButton, selectClass } from "@/components/ui";
import { api, type AskResult, type SearchMode, type StudySet } from "@/lib/api";

type Turn = { question: string; result: AskResult; verifyWasOn: boolean };

// What the fact-check found, shown under the answer
function VerificationNote({ turn }: { turn: Turn }) {
  const v = turn.result.verification;
  if (v.status === "verified") {
    return (
      <p className="mt-4">
        <span className={`${chip} bg-mint`}>
          ✓ Checked against your notes
          {v.attempts > 1 && ` · corrected after review (answer ${v.attempts} of ${v.max_attempts})`}
        </span>
      </p>
    );
  }
  if (v.status === "unverified") {
    const issues = v.rounds[v.rounds.length - 1]?.issues ?? [];
    return (
      <div className="mt-4 border-2 border-ink bg-amber-100 px-4 py-3 text-sm text-amber-950">
        <p className="font-bold">
          ⚠ Could not fully verify this answer after {v.attempts} attempts. Check it against the sources below.
        </p>
        {issues.length > 0 && (
          <ul className="mt-1 list-disc pl-4">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (v.status === "unchecked" && turn.verifyWasOn) {
    return <p className="mt-4 font-mono text-xs text-stone-500">The fact-check could not run, so this answer is unchecked.</p>;
  }
  return null;
}

// How many earlier turns are sent along, so "explain that more" can be understood
const HISTORY_TURNS = 3;

const MODES: { value: SearchMode; label: string; hint: string }[] = [
  { value: "hybrid", label: "Hybrid", hint: "Meaning and exact words together (best overall)" },
  { value: "vector", label: "Meaning", hint: "Finds passages that mean the same, even in different words" },
  { value: "keyword", label: "Keywords", hint: "Finds passages that contain your exact words" },
];

export default function AskTab({ set }: { set: StudySet }) {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [verify, setVerify] = useState(true);
  // oldest first, so the newest answer is at the bottom, like a chat
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 3 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const history = turns.slice(-HISTORY_TURNS).map((t) => ({ question: t.question, answer: t.result.answer }));
      const result = await api.askSet(set.id, q, history, mode, verify);
      setTurns((t) => [...t, { question: q, result, verifyWasOn: verify }]);
      setQuestion("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <ul className="space-y-6">
        {turns.map((t, i) => (
          <li key={i} className={card}>
            <p className="inline-block border-2 border-ink bg-sun px-3 py-1 font-display font-bold text-ink">{t.question}</p>
            {t.result.search_query.trim() !== t.question && (
              <p className="mt-2 font-mono text-xs text-stone-500">Searched for: {t.result.search_query}</p>
            )}
            <p className={`mt-4 whitespace-pre-wrap text-lg leading-relaxed ${t.result.found ? "text-ink" : "text-amber-800"}`}>
              {t.result.answer}
            </p>
            <VerificationNote turn={t} />

            {t.result.sources.length > 0 && (
              <div className="mt-5 border-t-2 border-stone-200 pt-4">
                <p className={label}>{t.result.found ? "From your notes" : "Closest passages (probably not relevant)"}</p>
                <ul className="mt-3 space-y-2">
                  {t.result.sources.map((s) => (
                    <li key={s.number}>
                      <details className="border-2 border-ink bg-background px-3 py-2 text-sm">
                        <summary className="cursor-pointer text-ink">
                          <span className="font-mono font-bold">[{s.number}]</span>
                          {set.files.length > 1 && s.source ? ` ${s.source} ·` : ""}
                          {s.heading ? ` ${s.heading}` : ""}
                          {s.page_number ? ` · page ${s.page_number}` : ""}
                          {s.score !== null && <span className="text-stone-500"> · match {s.score.toFixed(2)}</span>}
                          <span className="text-stone-600"> — {s.snippet}</span>
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap border-l-4 border-sun pl-3 text-stone-700">{s.text}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ErrorBox message={error} />

      <form onSubmit={ask} className={`flex flex-wrap gap-3 ${turns.length > 0 ? "mt-8" : ""}`}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder={turns.length > 0 ? "Ask a follow-up…" : "Ask anything about these notes…"}
          aria-label="Your question"
          className={`${inputClass} min-w-0 flex-1 px-4 py-3 text-base`}
        />
        <button type="submit" disabled={loading || question.trim().length < 3} className={primaryButton}>
          {loading ? (verify ? "Answering and checking…" : "Searching your notes…") : "Ask"}
          {!loading && <span aria-hidden="true">→</span>}
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
        <label className="flex items-center gap-2">
          <span className="font-display font-bold text-ink">Search</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SearchMode)}
            title={MODES.find((m) => m.value === mode)?.hint}
            className={`${selectClass} text-sm`}
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="hidden text-xs sm:inline">{MODES.find((m) => m.value === mode)?.hint}</span>
        </label>
        <label
          className="flex cursor-pointer items-center gap-2 text-ink"
          title="A second AI checks the answer against your notes and asks for a rewrite if it finds a mistake. Slower."
        >
          <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} className="h-4 w-4 accent-ink" />
          Fact-check answers
        </label>
        {turns.length > 0 && (
          <button type="button" onClick={() => setTurns([])} className={secondaryButton}>
            New conversation
          </button>
        )}
      </div>
      <p className="mt-3 font-mono text-xs text-stone-500">
        Answers come only from your notes. The first question on an older set can take a little longer.
      </p>
    </div>
  );
}
