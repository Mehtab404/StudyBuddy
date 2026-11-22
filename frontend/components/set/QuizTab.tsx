"use client";

import { useEffect, useState } from "react";
import QuizProgressPanel from "@/components/set/QuizProgressPanel";
import { EmptyState, ErrorBox, card, chip, errorMessage, label, primaryButton, secondaryButton, selectClass } from "@/components/ui";
import { api, type QuizProgress, type QuizQuestion, type StudySet } from "@/lib/api";

export default function QuizTab({ set, onChange }: { set: StudySet; onChange: (s: StudySet) => void }) {
  const [count, setCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // question index -> option the student picked
  const [picked, setPicked] = useState<Record<number, number>>({});
  // Questions being practised again instead of the set's quiz (the ones missed). null = the set's own quiz.
  const [practice, setPractice] = useState<QuizQuestion[] | null>(null);
  const [progress, setProgress] = useState<QuizProgress | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");

  const questions = practice ?? set.quiz;

  useEffect(() => {
    // Results are a nice-to-have: the quiz still works if they cannot be loaded
    api.quizProgress(set.id).then(setProgress).catch(() => {});
  }, [set.id]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      onChange(await api.makeQuiz(set.id, count));
      setPicked({});
      setPractice(null);
      setSaveState("idle");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function begin(next: QuizQuestion[] | null) {
    setPractice(next);
    setPicked({});
    setSaveState("idle");
  }

  async function save(asked: QuizQuestion[], choices: Record<number, number>) {
    try {
      await api.saveQuizAttempt(
        set.id,
        asked.map((q, i) => ({ ...q, chosen_index: choices[i] })),
      );
      setSaveState("saved");
      api.quizProgress(set.id).then(setProgress).catch(() => {});
    } catch {
      setSaveState("failed");
    }
  }

  function pick(asked: QuizQuestion[], index: number, option: number) {
    const next = { ...picked, [index]: option };
    setPicked(next);
    // The result is saved once every question has an answer
    if (Object.keys(next).length === asked.length) save(asked, next);
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

  const progressPanel = progress && <QuizProgressPanel progress={progress} onPractiseMissed={() => begin(progress.missed)} />;

  if (!questions) {
    return (
      <>
        {progressPanel}
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
  const wrong = questions.filter((q, i) => picked[i] !== undefined && picked[i] !== q.answer_index);
  const correct = answered - wrong.length;
  const finished = answered === questions.length;

  return (
    <div>
      {progressPanel}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2">
          {practice && <span className={`${chip} bg-peach`}>Practising missed questions</span>}
          <span className={label}>
            Answered {answered} of {questions.length}
          </span>
          {answered > 0 && (
            <span className={`${chip} bg-sun`}>
              Score {correct}/{answered}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => begin(practice)} className={secondaryButton}>
            Start over
          </button>
          {practice && (
            <button onClick={() => begin(null)} className={secondaryButton}>
              Back to the quiz
            </button>
          )}
          {countPicker}
          <button onClick={generate} disabled={loading} className={secondaryButton}>
            {loading ? "Making quiz…" : "New quiz"}
          </button>
        </div>
      </div>
      <ErrorBox message={error} />

      <ol className="space-y-6">
        {questions.map((q, i) => {
          const choice = picked[i];
          const done = choice !== undefined;
          return (
            <li key={i} className={card}>
              <p className="font-display text-lg font-bold text-ink">
                <span className="mr-2 font-mono text-sm text-stone-500">{String(i + 1).padStart(2, "0")}</span>
                {q.question}
              </p>
              {q.topic && <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-stone-500">{q.topic}</p>}
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
                      onClick={() => pick(questions, i, j)}
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

      {finished && (
        <div className={`${card} mt-6 bg-mint/40`} role="status">
          <p className="font-display text-2xl font-bold text-ink">
            You got {correct} of {questions.length} right
          </p>
          <p className="mt-1 text-sm text-stone-700">
            {saveState === "saved" && "Result saved."}
            {saveState === "failed" && "This result could not be saved, so it won't show in your results."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {wrong.length > 0 && (
              <button onClick={() => begin(wrong)} className={primaryButton}>
                Retry the {wrong.length} I missed
              </button>
            )}
            <button onClick={() => begin(practice)} className={secondaryButton}>
              Start over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
