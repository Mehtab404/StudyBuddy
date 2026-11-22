"use client";

import Link from "next/link";
import { useCallback } from "react";
import { EmptyState, ErrorBox, LoadMore, Loading, chip, label, pageLead, pageTitle, primaryButton } from "@/components/ui";
import { api, localDate, type Card } from "@/lib/api";
import { usePaged } from "@/lib/usePaged";

function dueLabel(card: Card) {
  if (!card.due_date) return { text: "New", color: "bg-mint" };
  const today = localDate();
  return card.due_date < today
    ? { text: `Overdue (was ${card.due_date})`, color: "bg-peach" }
    : { text: "Due today", color: "bg-sun" };
}

export default function DuePage() {
  const fetchPage = useCallback((cursor: string | null, signal: AbortSignal) => api.dueCards(cursor, signal), []);
  const { items: cards, total, hasMore, error, loadingMore, loadMore, retry } = usePaged(fetchPage);

  return (
    <div>
      <h1 className={pageTitle}>Cards due today</h1>
      <p className={pageLead}>New cards, plus any whose review date has arrived.</p>

      <ErrorBox message={error} onRetry={cards === null ? retry : undefined} />
      {!error && cards === null && <Loading />}

      {cards && cards.length === 0 && (
        <div className="mt-8">
          <EmptyState title="You’re all caught up" text="Nothing is due today. Come back tomorrow." />
        </div>
      )}

      {cards && cards.length > 0 && (
        <>
          <div className="mt-8 flex items-center justify-between gap-4">
            <p className={label}>{total} due</p>
            <Link href="/flashcards/quiz" className={primaryButton}>
              Start quiz <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ul className="mt-5 space-y-4">
            {cards.map((card) => {
              const due = dueLabel(card);
              return (
                <li key={card.id} className="flex items-start justify-between gap-4 border-2 border-ink bg-white p-5 shadow-hard-lg">
                  <p className="font-display font-bold text-ink">{card.question}</p>
                  <span className={`${chip} shrink-0 ${due.color}`}>{due.text}</span>
                </li>
              );
            })}
          </ul>
          <LoadMore shown={cards.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
        </>
      )}
    </div>
  );
}
