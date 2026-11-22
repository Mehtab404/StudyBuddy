"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EmptyState,
  ErrorBox,
  LoadMore,
  Loading,
  card as cardClass,
  dangerButton,
  errorMessage,
  inputClass,
  label,
  pageLead,
  pageTitle,
  secondaryButton,
  sourceQuote,
} from "@/components/ui";
import { api } from "@/lib/api";
import { usePaged } from "@/lib/usePaged";

export default function LibraryPage() {
  const [query, setQuery] = useState("");
  // The search text the list was last asked for. It trails what is typed by a moment, so a request is not made per key.
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null); // id of the card whose delete is being confirmed

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // The server searches question, answer and source, so this works across all cards and not just the ones loaded
  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) => api.listCards("approved", { q: search, cursor, signal }),
    [search],
  );
  const { items: cards, total, hasMore, error, setError, loadingMore, loadMore, removeItem, retry } = usePaged(fetchPage);

  async function remove(id: string) {
    try {
      await api.deleteCard(id);
      removeItem(id);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConfirming(null);
    }
  }

  const searching = search !== "";

  return (
    <div>
      <h1 className={pageTitle}>Library</h1>
      <p className={pageLead}>Your approved cards.</p>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search questions, answers and sources…"
        aria-label="Search cards"
        className={`mt-8 w-full px-4 py-3 text-base ${inputClass}`}
      />

      <ErrorBox message={error} onRetry={cards === null ? retry : undefined} />
      {!error && cards === null && <Loading />}

      {cards && cards.length === 0 && !hasMore && !searching && (
        <div className="mt-8">
          <EmptyState title="No approved cards yet" text="Cards you approve in the review queue show up here." />
        </div>
      )}

      {cards && cards.length === 0 && !hasMore && searching && (
        <p className="mt-8 font-mono text-sm text-stone-500">No cards match “{search}”.</p>
      )}

      {cards && cards.length > 0 && (
        <>
          <p className={`mt-8 ${label}`}>
            {searching ? `${total} match${total === 1 ? "" : "es"}` : `${total} card${total === 1 ? "" : "s"}`}
          </p>
          <ul className="mt-4 space-y-4">
            {cards.map((card) => (
              <li key={card.id} className={cardClass}>
                <p className="font-display text-lg font-bold text-ink">{card.question}</p>
                <p className="mt-2 text-stone-800">{card.answer}</p>
                <p className={`mt-4 text-sm ${sourceQuote}`}>{card.source}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {confirming === card.id ? (
                    <>
                      <span className="text-sm font-medium text-stone-700">Delete this card for good?</span>
                      <button onClick={() => remove(card.id)} className={dangerButton}>
                        Yes, delete
                      </button>
                      <button onClick={() => setConfirming(null)} className={secondaryButton}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setConfirming(card.id)} className={dangerButton}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <LoadMore shown={cards.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
        </>
      )}
    </div>
  );
}
