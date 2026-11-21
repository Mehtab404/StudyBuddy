"use client";

import { useState } from "react";
import { EmptyState, ErrorBox, card, chip, errorMessage, label, primaryButton, secondaryButton, selectClass } from "@/components/ui";
import { api, type StudySet } from "@/lib/api";

export default function QuizTab({ set, onChange }: { set: StudySet; onChange: (s: StudySet) => void }) {
  const [count, setCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // question index -> option the student picked
  const [picked, setPicked] = useState<Record<number, number>>({});

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      onChange(await api.makeQuiz(set.id, count));
      setPicked({});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const countPicker = (
    <label className="flex items-center gap-2 font-display text-sm font-bold text-ink">
      Questions
      <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={selectClass}>
        {[5, 10, 15, 20, 30].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );

  if (!set.quiz) {
    return (
      <>
        <EmptyState title="Practice quiz" text="Multiple-choice questions from your notes, with an explanation after every answer.">
          {countPicker}
          <button onClick={generate} disabled={loading} className={primaryButton}>
            {loading ? "Making quiz…" : "Make quiz"}
          </button>
        </EmptyState>
        <ErrorBox message={error} />
      </>
    );
  }

  const answered = Object.keys(picked).length;
  const correct = set.quiz.filter((q, i) => picked[i] === q.answer_index).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2">
          <span className={label}>
            Answered {answered} of {set.quiz.length}
          </span>
          {answered > 0 && (
            <span className={`${chip} bg-sun`}>
              Score {correct}/{answered}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setPicked({})} className={secondaryButton}>
            Start over
          </button>
          {countPicker}
          <button onClick={generate} disabled={loading} className={secondaryButton}>
            {loading ? "Making quiz…" : "New quiz"}
          </button>
        </div>
      </div>
      <ErrorBox message={error} />

      <ol className="space-y-6">
        {set.quiz.map((q, i) => {
          const choice = picked[i];
          const done = choice !== undefined;
          return (
            <li key={i} className={card}>
              <p className="font-display text-lg font-bold text-ink">
                <span className="mr-2 font-mono text-sm text-stone-500">{String(i + 1).padStart(2, "0")}</span>
                {q.question}
              </p>
              <div className="mt-4 space-y-2">
                {q.options.map((opt, j) => {
                  let style = "border-ink bg-white hover:bg-yellow-50";
                  if (done && j === q.answer_index) style = "border-ink bg-mint font-medium";
                  else if (done && j === choice) style = "border-ink bg-rose-200";
                  else if (done) style = "border-stone-300 bg-white text-stone-400";
                  return (
                    <button
                      key={j}
                      disabled={done}
                      onClick={() => setPicked((p) => ({ ...p, [i]: j }))}
                      className={`flex w-full items-center gap-3 border-2 px-4 py-2.5 text-left text-ink transition-colors ${style}`}
                    >
                      <span className="font-mono text-xs font-bold">{String.fromCharCode(65 + j)}</span>
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>
              {done && q.explanation && <p className="mt-4 border-l-4 border-sun pl-3 text-stone-700">{q.explanation}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
