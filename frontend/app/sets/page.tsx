"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { EmptyState, ErrorBox, LoadMore, Loading, chip, dangerButton, errorMessage, pageLead, pageTitle, primaryButton } from "@/components/ui";
import { api } from "@/lib/api";
import { usePaged } from "@/lib/usePaged";

export default function SetsPage() {
  const fetchPage = useCallback((cursor: string | null, signal: AbortSignal) => api.listSets(cursor, signal), []);
  const { items: sets, total, hasMore, error, setError, loadingMore, loadMore, removeItem, retry } = usePaged(fetchPage);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(id: string) {
    if (!window.confirm("Delete this study set and everything made from it?")) return;
    setDeleting(id);
    try {
      await api.deleteSet(id);
      removeItem(id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={pageTitle}>My sets</h1>
          <p className={pageLead}>Each set holds your notes and everything made from them.</p>
        </div>
        <Link href="/" className={primaryButton}>
          <span aria-hidden="true">+</span> New set
        </Link>
      </div>

      <ErrorBox message={error} onRetry={sets === null ? retry : undefined} />
      {sets === null && !error && <Loading />}
      {sets && sets.length === 0 && !hasMore && (
        <div className="mt-8">
          <EmptyState title="No study sets yet" text="Add your notes once and get revision notes, quizzes, exam papers and flashcards.">
            <Link href="/" className={primaryButton}>
              Create your first set <span aria-hidden="true">→</span>
            </Link>
          </EmptyState>
        </div>
      )}

      <ul className="mt-8 space-y-4">
        {sets?.map((s) => {
          const made = [
            s.has_revision && { text: "Notes", color: "bg-mint" },
            s.has_quiz && { text: "Quiz", color: "bg-sky-300" },
            s.paper_count > 0 && { text: `${s.paper_count} paper${s.paper_count === 1 ? "" : "s"}`, color: "bg-peach" },
            s.card_count > 0 && { text: `${s.card_count} cards`, color: "bg-sun" },
          ].filter((x): x is { text: string; color: string } => Boolean(x));
          return (
            <li key={s.id} className="flex items-center justify-between gap-4 border-2 border-ink bg-white p-5 shadow-hard-lg">
              <Link href={`/sets/${s.id}`} className="group min-w-0 flex-1">
                <p className="truncate font-display text-lg font-bold text-ink group-hover:underline">{s.title}</p>
                <p className="mt-1 font-mono text-xs uppercase tracking-wider text-stone-500">
                  {[s.level, s.files.length > 1 && `${s.files.length} files`, new Date(s.created_at).toLocaleDateString()]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {made.length > 0 ? (
                    made.map((m) => (
                      <span key={m.text} className={`${chip} ${m.color}`}>
                        {m.text}
                      </span>
                    ))
                  ) : (
                    <span className={`${chip} bg-white text-stone-500`}>Nothing generated yet</span>
                  )}
                </div>
              </Link>
              <button onClick={() => remove(s.id)} disabled={deleting === s.id} className={dangerButton}>
                Delete
              </button>
            </li>
          );
        })}
      </ul>
      {sets && <LoadMore shown={sets.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />}
    </div>
  );
}
