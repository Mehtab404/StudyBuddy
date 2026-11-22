"use client";

import { card, chip, label, secondaryButton } from "@/components/ui";
import type { QuizProgress } from "@/lib/api";

const MAX_TOPICS_SHOWN = 6;

// Bar colour by how well the topic went
function barColor(percent: number) {
  if (percent < 50) return "bg-rose-300";
  if (percent < 80) return "bg-amber-200";
  return "bg-mint";
}

// Past results for a set: recent scores, the topics that went worst, and a way to practise the questions still being missed
export default function QuizProgressPanel({
  progress,
  onPractiseMissed,
}: {
  progress: QuizProgress;
  onPractiseMissed: () => void;
}) {
  if (progress.attempts === 0) return null;
  const shown = progress.topics.slice(0, MAX_TOPICS_SHOWN);

  return (
    <section className={`${card} mb-6`} aria-label="Your quiz results">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-xl font-bold text-ink">Your results</p>
        {progress.missed.length > 0 && (
          <button onClick={onPractiseMissed} className={secondaryButton}>
            Practise {progress.missed.length} missed question{progress.missed.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      <div className="mt-4">
        <p className={label}>
          Last {progress.recent.length} of {progress.attempts} {progress.attempts === 1 ? "quiz" : "quizzes"}, newest first
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {progress.recent.map((a) => (
            <li key={a.id} className={`${chip} ${a.score === a.total ? "bg-mint" : "bg-white"}`} title={new Date(a.created_at).toLocaleString()}>
              {a.score}/{a.total}
            </li>
          ))}
        </ul>
      </div>

      {shown.length > 0 && (
        <div className="mt-5">
          <p className={label}>Topics, weakest first</p>
          <ul className="mt-2 space-y-2">
            {shown.map((t) => {
              const percent = Math.round((t.correct / t.answered) * 100);
              return (
                <li key={t.topic}>
                  <div className="flex items-baseline justify-between gap-3 text-sm text-ink">
                    <span className="font-medium">{t.topic}</span>
                    <span className="font-mono text-xs text-stone-600">
                      {t.correct}/{t.answered} right ({percent}%)
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 border-2 border-ink bg-white" role="img" aria-label={`${percent} percent right`}>
                    <div className={`h-full ${barColor(percent)}`} style={{ width: `${percent}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {progress.topics.length > shown.length && (
            <p className="mt-2 font-mono text-xs text-stone-500">+ {progress.topics.length - shown.length} more topics doing better</p>
          )}
        </div>
      )}
    </section>
  );
}
