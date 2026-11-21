"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, MAX_FILES } from "@/lib/api";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // matches the backend limit

const field =
  "mt-2 w-full border-2 border-ink bg-white px-4 py-3.5 text-base text-ink outline-none placeholder:text-stone-400 focus:shadow-hard";

// Small uppercase label chips under the upload box
const chip = "border-2 border-ink px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide text-ink";

export default function NewSetPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const details = { title: "", subject, level };
    try {
      const set = mode === "paste" ? await api.createSet(notes, details) : await api.createSetFromFiles(files, details);
      router.push(`/sets/${set.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // so the same file can be picked again after removing it
    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is larger than 5 MB.`);
      return;
    }
    const fresh = picked.filter((f) => !files.some((x) => x.name === f.name && x.size === f.size));
    if (files.length + fresh.length > MAX_FILES) {
      setError(`You can add at most ${MAX_FILES} files at a time.`);
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...fresh]);
  }

  const notReady = mode === "paste" ? notes.trim().length < 20 : files.length === 0;
  const status = !notReady
    ? mode === "paste"
      ? "Notes ready"
      : `${files.length} file${files.length === 1 ? "" : "s"} ready`
    : mode === "paste" && notes.trim().length > 0
      ? "Paste at least 20 characters to continue"
      : "Add at least 1 file or paste notes to continue";

  // Selected tab is solid black; the other is white. Both have a hard shadow.
  const tab = (active: boolean) =>
    `border-2 border-ink px-5 py-3 font-display text-base font-bold shadow-hard transition-transform hover:-translate-y-0.5 ${
      active ? "bg-ink text-white" : "bg-white text-ink"
    }`;

  return (
    <div>
      <h1 className="font-display text-4xl font-bold tracking-tight text-ink">Prepare for your exam</h1>
      <p className="mt-3 max-w-3xl text-lg leading-relaxed text-stone-600">
        Add your notes once. Then get easy revision notes, a practice quiz, an exam paper for any number of marks, and
        flashcards.
      </p>

      <div className="mt-8 flex gap-3">
        <button type="button" onClick={() => setMode("paste")} className={tab(mode === "paste")} aria-pressed={mode === "paste"}>
          Paste text
        </button>
        <button type="button" onClick={() => setMode("upload")} className={tab(mode === "upload")} aria-pressed={mode === "upload"}>
          Upload files
        </button>
      </div>

      <form onSubmit={handleCreate} className="mt-6 space-y-6">
        {mode === "paste" ? (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Paste your notes here…"
            rows={12}
            className="w-full border-2 border-ink bg-white p-5 text-base text-ink shadow-hard-lg outline-none placeholder:text-stone-400"
          />
        ) : (
          <div className="space-y-4">
            {files.length > 0 && (
              <ul className="space-y-3">
                {files.map((f) => (
                  <li
                    key={`${f.name}-${f.size}`}
                    className="flex items-center justify-between gap-3 border-2 border-ink bg-white px-4 py-3 shadow-hard"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={`${chip} shrink-0 ${f.name.toLowerCase().endsWith(".pdf") ? "bg-peach" : "bg-mint"}`}>
                        {f.name.toLowerCase().endsWith(".pdf") ? "PDF" : "TXT"}
                      </span>
                      <span className="truncate font-medium text-ink">{f.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-xs text-stone-500">{(f.size / 1024).toFixed(0)} KB</span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                        className="border-2 border-ink bg-white px-3 py-1 font-display text-sm font-bold text-ink hover:bg-rose-100"
                        aria-label={`Remove ${f.name}`}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {files.length < MAX_FILES && (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed border-ink bg-white px-6 py-12 text-center shadow-hard-lg transition-colors hover:bg-yellow-50">
                <span className="flex h-14 w-14 items-center justify-center border-2 border-ink bg-sun shadow-hard">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path d="M12 15V4M7 9l5-5 5 5M5 15v4h14v-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="mt-2 font-display text-xl font-bold text-ink">
                  {files.length === 0 ? "Choose up to 3 .pdf or .txt files" : "Add another file"}
                </span>
                <span className="max-w-xl text-stone-600">
                  Up to 5 MB each ({files.length} of {MAX_FILES} added). PDFs need selectable text; scanned images aren’t
                  supported.
                </span>
                <span className="mt-1 flex flex-wrap justify-center gap-2.5">
                  <span className={`${chip} bg-peach`}>.pdf supported</span>
                  <span className={`${chip} bg-mint`}>.txt supported</span>
                  <span className={`${chip} bg-white`}>Max 5 MB / file</span>
                </span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.txt,application/pdf,text/plain"
                  onChange={handleFiles}
                  className="sr-only"
                />
              </label>
            )}
          </div>
        )}

        <div className="grid gap-6 pt-2 sm:grid-cols-2">
          <label className="block font-display font-bold text-ink">
            Subject <span className="font-normal text-stone-500">(optional)</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Biology" className={`${field} font-sans font-normal`} />
          </label>
          <label className="block font-display font-bold text-ink">
            Your level <span className="font-normal text-stone-500">(optional)</span>
            <input
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="e.g. Class 10, first-year college"
              className={`${field} font-sans font-normal`}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-stone-300 pt-4">
          <p className="flex items-center gap-2 font-mono text-sm text-stone-600">
            <span className={`h-3 w-3 border border-ink ${notReady ? "bg-stone-400" : "bg-mint"}`} aria-hidden="true" />
            {status}
          </p>
          <button
            type="submit"
            disabled={loading || notReady}
            className="inline-flex items-center gap-2 border-2 border-ink bg-sun px-8 py-3 font-display text-base font-bold text-ink shadow-hard transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none"
          >
            {loading ? "Saving…" : "Continue"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-6 border-2 border-ink bg-rose-100 px-4 py-3 font-medium text-rose-900 shadow-hard">
          {error}
        </p>
      )}
    </div>
  );
}
