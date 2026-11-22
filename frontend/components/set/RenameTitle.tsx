"use client";

import { useRef, useState } from "react";
import { ErrorBox, errorMessage, inputClass, pageTitle, primaryButton, secondaryButton } from "@/components/ui";
import { api, type StudySet } from "@/lib/api";

// The set's title as a heading, with a Rename button that swaps it for a text box
export default function RenameTitle({ set, onChange }: { set: StudySet; onChange: (s: StudySet) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(set.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renameButton = useRef<HTMLButtonElement>(null);

  function stop() {
    setEditing(false);
    setError(null);
    // The button the user came from is about to come back. Put the keyboard focus on it again.
    requestAnimationFrame(() => renameButton.current?.focus());
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (trimmed === set.title) return stop();
    setBusy(true);
    setError(null);
    try {
      onChange(await api.renameSet(set.id, trimmed));
      stop();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <h1 className={pageTitle}>{set.title}</h1>
        <button
          ref={renameButton}
          onClick={() => {
            setTitle(set.title);
            setEditing(true);
          }}
          className={secondaryButton}
        >
          Rename
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          autoFocus
          required
          maxLength={100}
          aria-label="Set title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && stop()}
          className={`${inputClass} min-w-0 flex-1 px-4 py-2 font-display text-2xl font-bold`}
        />
        <button type="submit" disabled={busy || !title.trim()} className={primaryButton}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={stop} disabled={busy} className={secondaryButton}>
          Cancel
        </button>
      </div>
      <ErrorBox message={error} />
    </form>
  );
}
