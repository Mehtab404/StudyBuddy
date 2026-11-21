"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorBox, Loading, chip, dangerButton, errorMessage, pageLead, pageTitle, primaryButton } from "@/components/ui";
import { api, type StudySetSummary } from "@/lib/api";

export default function SetsPage() {
  const [sets, setSets] = useState<StudySetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSets()
      .then(setSets)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function remove(id: string) {
    if (!window.confirm("Delete this study set and everything made from it?")) return;
    try {
      await api.deleteSet(id);
      setSets((prev) => prev?.filter((s) => s.id !== id) ?? null);
    } catch (err) {
      setError(errorMessage(err));
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

      <ErrorBox message={error} />
      {sets === null && !error && <Loading />}
      {sets && sets.length === 0 && (
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
              <button onClick={() => remove(s.id)} className={dangerButton}>
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
