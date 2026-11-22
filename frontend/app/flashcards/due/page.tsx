"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorBox, Loading, chip, errorMessage, label, pageLead, pageTitle, primaryButton } from "@/components/ui";
import { api, localDate, type Card } from "@/lib/api";

function dueLabel(card: Card) {
  if (!card.due_date) return { text: "New", color: "bg-mint" };
  const today = localDate();
  return card.due_date < today
    ? { text: `Overdue (was ${card.due_date})`, color: "bg-peach" }
    : { text: "Due today", color: "bg-sun" };
}

export default function DuePage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dueCards()
      .then(setCards)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div>
      <h1 className={pageTitle}>Cards due today</h1>
      <p className={pageLead}>New cards, plus any whose review date has arrived.</p>

      <ErrorBox message={error} />
      {!error && cards === null && <Loading />}

      {cards && cards.length === 0 && (
        <div className="mt-8">
          <EmptyState title="You’re all caught up" text="Nothing is due today. Come back tomorrow." />
        </div>
      )}

      {cards && cards.length > 0 && (
        <>
          <div className="mt-8 flex items-center justify-between gap-4">
            <p className={label}>{cards.length} due</p>
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
        </>
      )}
    </div>
  );
}
