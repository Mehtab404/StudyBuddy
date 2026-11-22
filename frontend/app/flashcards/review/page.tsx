"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ReviewCard from "@/components/ReviewCard";
import { EmptyState, ErrorBox, LoadMore, Loading, chip, label, pageLead, pageTitle, primaryButton } from "@/components/ui";
import { api, type CheckStats } from "@/lib/api";
import { usePaged } from "@/lib/usePaged";

export default function ReviewPage() {
  const fetchPage = useCallback((cursor: string | null, signal: AbortSignal) => api.listCards("pending", { cursor, signal }), []);
  const { items: cards, total, hasMore, error, loadingMore, loadMore, removeItem: remove, retry } = usePaged(fetchPage);
  const [stats, setStats] = useState<CheckStats | null>(null);

  // Stats are a nice-to-have; ignore failures
  useEffect(() => {
    const controller = new AbortController();
    api.checkStats(controller.signal).then(setStats).catch(() => {});
    return () => controller.abort();
  }, []);

  // Every card on screen was approved or rejected, but more are waiting: bring in the next ones.
  // Not while there is an error: a failed load changes state, which would run this again straight away and so
  // hammer a server that is already struggling. The "Try again" button below is how the user asks once more.
  const stuck = cards !== null && cards.length === 0 && hasMore;
  useEffect(() => {
    if (stuck && !error) loadMore();
  }, [stuck, error, loadMore]);

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

      <ErrorBox message={error} onRetry={cards === null ? retry : undefined} />
      {!error && cards === null && <Loading />}

      {stuck && error && (
        <button onClick={loadMore} disabled={loadingMore} className={`${primaryButton} mt-6`}>
          {loadingMore ? "Loading…" : "Try again"}
        </button>
      )}

      {cards && cards.length === 0 && !hasMore && (
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
            <span className={label}>{total} waiting</span>
            {flaggedInQueue > 0 && (
              <span className={`${chip} bg-amber-200`}>
                {flaggedInQueue} flagged for a closer look{hasMore ? " (in these)" : ""}
              </span>
            )}
          </p>
          <div className="mt-4 space-y-6">
            {cards.map((card) => (
              <ReviewCard key={card.id} card={card} onResolved={remove} />
            ))}
          </div>
          <LoadMore shown={cards.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
        </>
      )}
    </div>
  );
}
