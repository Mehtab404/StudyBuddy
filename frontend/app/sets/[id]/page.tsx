"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useCallback, useState } from "react";
import AskTab from "@/components/set/AskTab";
import FlashcardsTab from "@/components/set/FlashcardsTab";
import PaperTab from "@/components/set/PaperTab";
import QuizTab from "@/components/set/QuizTab";
import RenameTitle from "@/components/set/RenameTitle";
import RevisionTab from "@/components/set/RevisionTab";
import { ErrorBox, Loading, chip, errorMessage, tabClass, textLink } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

const TABS = ["Revision notes", "Quiz", "Exam paper", "Flashcards", "Ask your notes"] as const;
type TabName = (typeof TABS)[number];

export default function SetPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<TabName>("Revision notes");

  // Cancelled when the page is left or the id changes, and a slow answer for an earlier set is never shown
  const fetchSet = useCallback((signal: AbortSignal) => api.getSet(id, signal), [id]);
  const { data: set, error: loadError, reload, update: setSet } = useLoad(fetchSet);
  const missing = loadError instanceof ApiError && loadError.status === 404; // no such set, or not yours

  // Shows app/sets/[id]/not-found.tsx. It has to be called while rendering.
  if (missing) notFound();
  if (loadError) {
    return (
      <div>
        <ErrorBox message={errorMessage(loadError)} onRetry={reload} />
        <Link href="/sets" className={`mt-6 inline-block ${textLink}`}>
          ← Back to my sets
        </Link>
      </div>
    );
  }
  if (!set) return <Loading />;

  // Left/Right/Home/End select and focus another tab (the keyboard pattern for tabs)
  function onTabKeyDown(e: React.KeyboardEvent, index: number) {
    const last = TABS.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setTab(TABS[next]);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return (
    <div>
      <title>{`${set.title} · studyBuddy`}</title>
      <div className="no-print">
        <Link href="/sets" className="font-mono text-xs font-bold uppercase tracking-widest text-stone-500 hover:text-ink">
          ← My sets
        </Link>
        <RenameTitle set={set} onChange={setSet} />
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

        <ul role="tablist" aria-label="Study tools" className="mt-8 flex flex-wrap gap-3 border-b-2 border-stone-300 pb-5">
          {TABS.map((name, i) => (
            <li key={name} role="presentation">
              <button
                role="tab"
                id={`tab-${i}`}
                aria-selected={tab === name}
                aria-controls="tabpanel"
                // Only the selected tab is in the tab order. Arrow keys move between tabs.
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setTab(name)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={tabClass(tab === name)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8" role="tabpanel" id="tabpanel" aria-labelledby={`tab-${TABS.indexOf(tab)}`} tabIndex={0}>
        {tab === "Revision notes" && <RevisionTab set={set} onChange={setSet} />}
        {tab === "Quiz" && <QuizTab set={set} onChange={setSet} />}
        {tab === "Exam paper" && <PaperTab set={set} onChange={setSet} />}
        {tab === "Flashcards" && <FlashcardsTab set={set} onChange={setSet} />}
        {tab === "Ask your notes" && <AskTab set={set} />}
      </div>
    </div>
  );
}
