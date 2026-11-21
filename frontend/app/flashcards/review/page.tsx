"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReviewCard from "@/components/ReviewCard";
import { EmptyState, ErrorBox, Loading, chip, errorMessage, label, pageLead, pageTitle, primaryButton } from "@/components/ui";
import { api, type Card, type CheckStats } from "@/lib/api";

export default function ReviewPage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [stats, setStats] = useState<CheckStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Stats are a nice-to-have; ignore failures
    api.checkStats().then(setStats).catch(() => {});
    api
      .listCards("pending")
      .then(setCards)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const remove = (id: string) => setCards((prev) => prev?.filter((c) => c.id !== id) ?? null);
  const flaggedInQueue = cards?.filter((c) => c.check_status === "flagged").length ?? 0;

  return (
    <div>
      <h1 className={pageTitle}>Review queue</h1>
      <p className={pageLead}>Check each card against the sentence it came from, then approve, edit or reject it.</p>

      {stats && stats.checked > 0 && (
        <p className="mt-4 font-mono text-xs uppercase tracking-wider text-stone-500">
          Accuracy check, all time: {stats.flagged} of {stats.checked} generated cards flagged (
          {Math.round(stats.flagged_rate * 100)}%)
        </p>
      )}

      <ErrorBox message={error} />
      {!error && cards === null && <Loading />}

      {cards && cards.length === 0 && (
        <div className="mt-8">
          <EmptyState title="Nothing to review" text="New flashcards wait here until you approve them.">
            <Link href="/sets" className={primaryButton}>
              Generate some cards <span aria-hidden="true">→</span>
            </Link>
          </EmptyState>
        </div>
      )}

      {cards && cards.length > 0 && (
        <>
          <p className="mt-8 flex flex-wrap items-center gap-2">
            <span className={label}>{cards.length} waiting</span>
            {flaggedInQueue > 0 && <span className={`${chip} bg-amber-200`}>{flaggedInQueue} flagged for a closer look</span>}
          </p>
          <div className="mt-4 space-y-6">
            {cards.map((card) => (
              <ReviewCard key={card.id} card={card} onResolved={remove} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
