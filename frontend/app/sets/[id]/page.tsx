"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import AskTab from "@/components/set/AskTab";
import FlashcardsTab from "@/components/set/FlashcardsTab";
import PaperTab from "@/components/set/PaperTab";
import QuizTab from "@/components/set/QuizTab";
import RevisionTab from "@/components/set/RevisionTab";
import { ErrorBox, Loading, chip, errorMessage, pageTitle, tabClass, textLink } from "@/components/ui";
import { api, type StudySet } from "@/lib/api";

const TABS = ["Revision notes", "Quiz", "Exam paper", "Flashcards", "Ask your notes"] as const;
type TabName = (typeof TABS)[number];

export default function SetPage() {
  const { id } = useParams<{ id: string }>();
  const [set, setSet] = useState<StudySet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabName>("Revision notes");

  useEffect(() => {
    api
      .getSet(id)
      .then(setSet)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  if (error) {
    return (
      <div>
        <ErrorBox message={error} />
        <Link href="/sets" className={`mt-6 inline-block ${textLink}`}>
          ← Back to my sets
        </Link>
      </div>
    );
  }
  if (!set) return <Loading />;

  return (
    <div>
      <div className="no-print">
        <Link href="/sets" className="font-mono text-xs font-bold uppercase tracking-widest text-stone-500 hover:text-ink">
          ← My sets
        </Link>
        <h1 className={`mt-3 ${pageTitle}`}>{set.title}</h1>
        {(set.subject || set.level) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {set.subject && <span className={`${chip} bg-sun`}>{set.subject}</span>}
            {set.level && <span className={`${chip} bg-white`}>{set.level}</span>}
          </div>
        )}
        {set.files.length > 1 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Files in this set">
            {set.files.map((f) => (
              <li key={f.name} className={`${chip} ${f.name.toLowerCase().endsWith(".pdf") ? "bg-peach" : "bg-mint"} normal-case`}>
                {f.name}
                {f.pages ? ` · ${f.pages} page${f.pages === 1 ? "" : "s"}` : ""}
              </li>
            ))}
          </ul>
        )}

        <ul className="mt-8 flex flex-wrap gap-3 border-b-2 border-stone-300 pb-5">
          {TABS.map((name) => (
            <li key={name}>
              <button onClick={() => setTab(name)} className={tabClass(tab === name)} aria-pressed={tab === name}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8">
        {tab === "Revision notes" && <RevisionTab set={set} onChange={setSet} />}
        {tab === "Quiz" && <QuizTab set={set} onChange={setSet} />}
        {tab === "Exam paper" && <PaperTab set={set} onChange={setSet} />}
        {tab === "Flashcards" && <FlashcardsTab set={set} onChange={setSet} />}
        {tab === "Ask your notes" && <AskTab set={set} />}
      </div>
    </div>
  );
}
