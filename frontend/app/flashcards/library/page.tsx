"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorBox, Loading, card as cardClass, errorMessage, inputClass, pageLead, pageTitle, sourceQuote } from "@/components/ui";
import { api, type Card } from "@/lib/api";

export default function LibraryPage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .listCards("approved")
      .then(setCards)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  // Search runs in the browser over question, answer and source
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!cards || !q) return cards;
    return cards.filter((c) => `${c.question} ${c.answer} ${c.source}`.toLowerCase().includes(q));
  }, [cards, query]);

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

      <ErrorBox message={error} />
      {!error && cards === null && <Loading />}

      {cards && cards.length === 0 && (
        <div className="mt-8">
          <EmptyState title="No approved cards yet" text="Cards you approve in the review queue show up here." />
        </div>
      )}

      {cards && cards.length > 0 && visible && visible.length === 0 && (
        <p className="mt-8 font-mono text-sm text-stone-500">No cards match “{query}”.</p>
      )}

      {visible && visible.length > 0 && (
        <ul className="mt-8 space-y-4">
          {visible.map((card) => (
            <li key={card.id} className={cardClass}>
              <p className="font-display text-lg font-bold text-ink">{card.question}</p>
              <p className="mt-2 text-stone-800">{card.answer}</p>
              <p className={`mt-4 text-sm ${sourceQuote}`}>{card.source}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
