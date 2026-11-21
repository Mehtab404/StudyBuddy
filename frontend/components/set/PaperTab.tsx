"use client";

import { useState } from "react";
import { ErrorBox, card, dangerButton, errorMessage, inputClass, label, primaryButton, secondaryButton, tabClass } from "@/components/ui";
import { api, type Paper, type StudySet } from "@/lib/api";

const fieldLabel = "block font-display font-bold text-ink";
const optional = "font-sans font-normal text-stone-500";

export default function PaperTab({ set, onChange }: { set: StudySet; onChange: (s: StudySet) => void }) {
  const [marks, setMarks] = useState("50");
  const [minutes, setMinutes] = useState("");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  // Which paper is open; null = the newest one
  const [openId, setOpenId] = useState<string | null>(null);

  const totalMarks = Number(marks);
  const marksOk = Number.isInteger(totalMarks) && totalMarks >= 5 && totalMarks <= 200;
  const papers = [...set.papers].reverse(); // newest first
  const paper: Paper | undefined = papers.find((p) => p.id === openId) ?? papers[0];

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const updated = await api.makePaper(set.id, {
        total_marks: totalMarks,
        duration_minutes: minutes ? Number(minutes) : null,
        details,
      });
      onChange(updated);
      setOpenId(updated.papers[updated.papers.length - 1].id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function remove(p: Paper) {
    if (!window.confirm("Delete this paper?")) return;
    try {
      onChange(await api.deletePaper(set.id, p.id));
      setOpenId(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <form onSubmit={generate} className={`no-print ${card}`}>
        <p className="font-display text-xl font-bold text-ink">Make an exam paper</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={fieldLabel}>
            Total marks
            <input
              type="number"
              min={5}
              max={200}
              value={marks}
              onChange={(e) => setMarks(e.target.value)}
              className={`mt-2 w-full font-sans font-normal ${inputClass}`}
            />
          </label>
          <label className={fieldLabel}>
            Time in minutes <span className={optional}>(optional)</span>
            <input
              type="number"
              min={5}
              max={600}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="e.g. 90"
              className={`mt-2 w-full font-sans font-normal ${inputClass}`}
            />
          </label>
        </div>
        <label className={`mt-4 ${fieldLabel}`}>
          Extra details <span className={optional}>(optional)</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="e.g. hard questions, include 5 MCQs, focus on the first two topics"
            className={`mt-2 w-full font-sans font-normal ${inputClass}`}
          />
        </label>
        <div className="mt-5 flex items-center justify-between gap-3 border-t-2 border-stone-200 pt-4">
          <p className="font-mono text-xs text-rose-700">{marksOk ? "" : "Enter marks between 5 and 200."}</p>
          <button type="submit" disabled={loading || !marksOk} className={primaryButton}>
            {loading ? "Making paper…" : "Make paper"}
            {!loading && <span aria-hidden="true">→</span>}
          </button>
        </div>
        {loading && <p className="mt-2 text-right font-mono text-xs text-stone-500">This can take up to a minute.</p>}
      </form>
      <div className="no-print">
        <ErrorBox message={error} />
      </div>

      {papers.length > 1 && (
        <div className="no-print mt-6 flex flex-wrap items-center gap-3">
          <span className={label}>Your papers</span>
          {papers.map((p, i) => (
            <button key={p.id} onClick={() => setOpenId(p.id)} className={tabClass(p.id === paper?.id)}>
              {p.total_marks} marks #{papers.length - i}
            </button>
          ))}
        </div>
      )}

      {paper && (
        <div className="mt-8">
          <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={showAnswers}
                onChange={(e) => setShowAnswers(e.target.checked)}
                className="h-4 w-4 accent-ink"
              />
              Show answers and marking scheme
            </label>
            <div className="flex gap-3">
              <button onClick={() => window.print()} className={secondaryButton}>
                Print / save as PDF
              </button>
              <button onClick={() => remove(paper)} className={dangerButton}>
                Delete
              </button>
            </div>
          </div>
          <PaperView paper={paper} showAnswers={showAnswers} subject={set.subject} />
        </div>
      )}
    </div>
  );
}

// Looks like a printed exam paper: black rules, no colour except the answers
function PaperView({ paper, showAnswers, subject }: { paper: Paper; showAnswers: boolean; subject: string }) {
  return (
    <article className="print-area border-2 border-ink bg-white p-8 shadow-hard-lg print:border-0 print:p-0 print:shadow-none">
      <header className="border-b-2 border-ink pb-4 text-center">
        <h2 className="font-display text-2xl font-bold text-ink">{paper.title}</h2>
        {subject && <p className="mt-1 text-stone-600">{subject}</p>}
        <p className="mt-3 flex justify-between font-mono text-sm text-ink">
          <span>{paper.duration_minutes ? `Time: ${paper.duration_minutes} minutes` : ""}</span>
          <span>Total marks: {paper.total_marks}</span>
        </p>
      </header>

      {paper.instructions.length > 0 && (
        <div className="mt-5 text-sm text-stone-800">
          <p className="font-display font-bold text-ink">Instructions</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {paper.instructions.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      {paper.sections.map((s, i) => (
        <section key={i} className="mt-7">
          <h3 className="font-display text-lg font-bold text-ink">{s.name}</h3>
          {s.instructions && <p className="text-sm italic text-stone-600">{s.instructions}</p>}
          <ol className="mt-3 space-y-4">
            {s.questions.map((q) => (
              <li key={q.number} className="break-inside-avoid text-stone-900">
                <p className="flex justify-between gap-4">
                  <span>
                    <span className="font-bold">{q.number}.</span> {q.question}
                  </span>
                  <span className="shrink-0 font-mono text-sm text-stone-600">[{q.marks}]</span>
                </p>
                {q.options.length > 0 && (
                  <ul className="mt-1 grid gap-x-6 pl-5 text-sm sm:grid-cols-2">
                    {q.options.map((o, j) => (
                      <li key={j}>
                        ({String.fromCharCode(97 + j)}) {o}
                      </li>
                    ))}
                  </ul>
                )}
                {showAnswers && (
                  <div className="mt-2 border-2 border-ink bg-mint/30 px-3 py-2 text-sm text-ink">
                    <p>
                      <span className="font-bold">Answer: </span>
                      {q.answer}
                    </p>
                    {q.marking_scheme && (
                      <p className="mt-1 text-stone-700">
                        <span className="font-bold">Marking: </span>
                        {q.marking_scheme}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </article>
  );
}
