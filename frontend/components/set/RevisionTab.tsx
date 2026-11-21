"use client";

import { useState } from "react";
import { EmptyState, ErrorBox, card, errorMessage, label, primaryButton, secondaryButton } from "@/components/ui";
import { api, type StudySet } from "@/lib/api";

export default function RevisionTab({ set, onChange }: { set: StudySet; onChange: (s: StudySet) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      onChange(await api.makeRevision(set.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!set.revision) {
    return (
      <>
        <EmptyState
          title="Revision notes"
          text="Your notes are turned into short, topic-by-topic revision notes with simple explanations, key points, important terms and likely exam questions."
        >
          <button onClick={generate} disabled={loading} className={primaryButton}>
            {loading ? "Making notes…" : "Make revision notes"}
          </button>
        </EmptyState>
        {loading && <p className="mt-4 text-center font-mono text-xs text-stone-500">Long notes can take a minute or two.</p>}
        <ErrorBox message={error} />
      </>
    );
  }

  return (
    <div className="print-area">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className={label}>{set.revision.length} topics</p>
        <div className="flex gap-3">
          <button onClick={() => window.print()} className={secondaryButton}>
            Print / save as PDF
          </button>
          <button onClick={generate} disabled={loading} className={secondaryButton}>
            {loading ? "Making notes…" : "Make again"}
          </button>
        </div>
      </div>
      <ErrorBox message={error} />

      <div className="space-y-6">
        {set.revision.map((t, i) => (
          <section key={i} className={`break-inside-avoid ${card} print:shadow-none`}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-display text-xl font-bold text-ink">{t.title}</h2>
              <span className="font-mono text-xs text-stone-500">{String(i + 1).padStart(2, "0")}</span>
            </div>

            {t.explanation && (
              <p className="mt-4 border-2 border-ink bg-mint/30 px-4 py-3 text-ink">
                <span className="font-display font-bold">In simple words: </span>
                {t.explanation}
              </p>
            )}

            {t.key_points.length > 0 && (
              <>
                <h3 className={`mt-5 ${label}`}>Key points</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-800 marker:text-ink">
                  {t.key_points.map((p, j) => (
                    <li key={j}>{p}</li>
                  ))}
                </ul>
              </>
            )}

            {t.terms.length > 0 && (
              <>
                <h3 className={`mt-5 ${label}`}>Important terms</h3>
                <dl className="mt-2 space-y-1 text-stone-800">
                  {t.terms.map((x, j) => (
                    <div key={j}>
                      <dt className="mark-sun inline font-display font-bold text-ink">{x.term}</dt>
                      <dd className="inline"> — {x.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            {t.likely_questions.length > 0 && (
              <>
                <h3 className={`mt-5 ${label}`}>Questions that may come</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-800 marker:text-ink">
                  {t.likely_questions.map((q, j) => (
                    <li key={j}>{q}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
