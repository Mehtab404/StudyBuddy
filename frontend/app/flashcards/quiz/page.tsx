"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorBox, Loading, errorMessage, label, pageTitle, primaryButton, secondaryButton, sourceQuote, textLink } from "@/components/ui";
import { api, type Card } from "@/lib/api";

export default function QuizPage() {
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [knewCount, setKnewCount] = useState(0);
  const [lastInterval, setLastInterval] = useState<number | null>(null);

  useEffect(() => {
    api
      .dueCards()
      .then(setQueue)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function answer(knew: boolean, easy = false) {
    if (!queue) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.review(queue[index].id, knew, easy);
      if (knew) setKnewCount((n) => n + 1);
      setLastInterval(updated.interval_days);
      setIndex((i) => i + 1);
      setRevealed(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const done = queue !== null && index >= queue.length;
  const card = queue && !done ? queue[index] : null;

  return (
    <div>
      <h1 className={pageTitle}>Quiz</h1>

      <ErrorBox message={error} />
      {!error && queue === null && <Loading />}

      {queue && queue.length === 0 && (
        <div className="mt-8">
          <EmptyState title="Nothing is due right now" text="Approve more cards, or come back later.">
            <Link href="/flashcards/review" className={primaryButton}>
              Approve more cards <span aria-hidden="true">→</span>
            </Link>
          </EmptyState>
        </div>
      )}

      {card && queue && (
        <div className="mx-auto mt-8 max-w-3xl">
          <div className="mb-3 flex items-center justify-between gap-4">
            <span className={label}>
              Card {index + 1} of {queue.length}
            </span>
            {lastInterval !== null && index > 0 && (
              <span className="font-mono text-xs text-stone-500">
                Last card: back in {lastInterval} day{lastInterval === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="h-3 border-2 border-ink bg-white" role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={index}>
            <div className="h-full bg-sun transition-all" style={{ width: `${(index / queue.length) * 100}%` }} />
          </div>

          <article className="mt-8 border-2 border-ink bg-white p-8 shadow-[8px_8px_0_0_#111111] sm:p-10">
            <h2 className={label}>Question</h2>
            <p className="mt-3 font-display text-2xl font-bold leading-snug text-ink">{card.question}</p>

            {revealed && (
              <div className="mt-8 border-t-2 border-stone-200 pt-6">
                <h2 className={label}>Answer</h2>
                <p className="mt-3 text-xl text-ink">{card.answer}</p>
                <p className={`mt-5 text-sm ${sourceQuote}`}>{card.source}</p>
              </div>
            )}
          </article>

          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {!revealed ? (
              <button onClick={() => setRevealed(true)} className={`${primaryButton} px-10 py-3 text-lg`}>
                Show answer
              </button>
            ) : (
              <>
                <button onClick={() => answer(false)} disabled={busy} className={`${secondaryButton} px-6 py-3 text-base`}>
                  I didn’t know it
                </button>
                <button onClick={() => answer(true)} disabled={busy} className={`${primaryButton} px-6 py-3`}>
                  I knew it ✓
                </button>
                <button onClick={() => answer(true, true)} disabled={busy} className={`${secondaryButton} bg-mint px-6 py-3 text-base`}>
                  Too easy ⚡
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {done && queue && queue.length > 0 && (
        <div className="mx-auto mt-8 max-w-3xl border-2 border-ink bg-mint p-10 text-center shadow-[8px_8px_0_0_#111111]">
          <p className="font-display text-3xl font-bold text-ink">Session complete</p>
          <p className="mt-2 text-lg text-ink">
            You knew {knewCount} of {queue.length}. Each card has been rescheduled.
          </p>
          <Link href="/flashcards/due" className={`mt-6 inline-block ${textLink}`}>
            Back to due cards
          </Link>
        </div>
      )}
    </div>
  );
}
