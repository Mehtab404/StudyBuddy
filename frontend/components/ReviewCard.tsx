"use client";

import { useState } from "react";
import { chip, dangerButton, inputClass, label, primaryButton, secondaryButton, sourceQuote } from "@/components/ui";
import { api, type Card } from "@/lib/api";

type Props = {
  card: Card;
  // Called after the card leaves the queue (approved or rejected)
  onResolved: (id: string) => void;
};

export default function ReviewCard({ card, onResolved }: Props) {
  const [current, setCurrent] = useState(card);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const approve = () => run(async () => { await api.approve(current.id); onResolved(current.id); });
  const reject = () => run(async () => { await api.reject(current.id); onResolved(current.id); });
  const save = () =>
    run(async () => {
      setCurrent(await api.edit(current.id, { question, answer }));
      setEditing(false);
    });

  function cancelEdit() {
    setQuestion(current.question);
    setAnswer(current.answer);
    setEditing(false);
  }

  const flagged = current.check_status === "flagged";

  return (
    <article className={`border-2 border-ink p-5 shadow-hard-lg ${flagged ? "bg-amber-50" : "bg-white"}`}>
      {flagged && (
        <div role="note" className="mb-5 border-2 border-ink bg-amber-200 px-4 py-3 text-sm text-amber-950">
          <p className="font-display font-bold">⚠ Check this answer</p>
          <p className="mt-0.5">
            {current.check_reason || "The answer may include information that isn’t in the source sentence."}
          </p>
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h3 className={label}>Question</h3>
            {editing ? (
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} className={`mt-2 w-full ${inputClass}`} />
            ) : (
              <p className="mt-2 font-display text-lg font-bold text-ink">{current.question}</p>
            )}
          </div>
          <div>
            <h3 className={label}>Answer</h3>
            {editing ? (
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} className={`mt-2 w-full ${inputClass}`} />
            ) : (
              <p className="mt-2 text-ink">{current.answer}</p>
            )}
          </div>
        </div>

        <div className="border-2 border-ink bg-background p-4">
          <h3 className={label}>From your notes</h3>
          <blockquote className={`mt-2 ${sourceQuote}`}>{current.source}</blockquote>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 border-2 border-ink bg-rose-100 px-3 py-2 text-sm font-medium text-rose-900">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t-2 border-stone-200 pt-4">
        {current.check_status === "supported" && (
          <span className={`mr-auto ${chip} bg-mint`}>✓ Answer matches the source</span>
        )}
        {editing ? (
          <>
            <button onClick={cancelEdit} disabled={busy} className={secondaryButton}>
              Cancel
            </button>
            <button onClick={save} disabled={busy || !question.trim() || !answer.trim()} className={`${primaryButton} py-1.5 text-sm`}>
              Save
            </button>
          </>
        ) : (
          <>
            <button onClick={reject} disabled={busy} className={dangerButton}>
              Reject
            </button>
            <button onClick={() => setEditing(true)} disabled={busy} className={secondaryButton}>
              Edit
            </button>
            <button onClick={approve} disabled={busy} className={`${primaryButton} py-1.5 text-sm`}>
              Approve
            </button>
          </>
        )}
      </div>
    </article>
  );
}
