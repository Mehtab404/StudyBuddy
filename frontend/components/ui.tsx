import type { ReactNode } from "react";

// Shared styles for the bold "exam prep" look: black 2px borders, hard offset shadows, flat bright fills.
// Colours and shadows (ink, sun, mint, peach, shadow-hard) are defined in app/globals.css.

const lift = "transition-transform hover:-translate-y-0.5 disabled:translate-y-0";

// Main action: yellow block
export const primaryButton = `inline-flex items-center justify-center gap-2 border-2 border-ink bg-sun px-6 py-2.5 font-display font-bold text-ink shadow-hard ${lift} disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none`;

// Secondary action: white block
export const secondaryButton = `inline-flex items-center justify-center gap-2 border-2 border-ink bg-white px-4 py-1.5 font-display text-sm font-bold text-ink shadow-hard ${lift} disabled:cursor-not-allowed disabled:opacity-50`;

// Destructive action: white block with red text
export const dangerButton = `inline-flex items-center justify-center gap-2 border-2 border-ink bg-white px-4 py-1.5 font-display text-sm font-bold text-rose-700 shadow-hard ${lift} hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50`;

export const inputClass =
  "border-2 border-ink bg-white px-3 py-2 text-ink outline-none placeholder:text-stone-400 focus:shadow-hard";

export const selectClass = "border-2 border-ink bg-white px-2 py-1.5 font-sans text-ink outline-none focus:shadow-hard";

export const card = "border-2 border-ink bg-white p-5 shadow-hard-lg";

export const pageTitle = "font-display text-4xl font-bold tracking-tight text-ink";
export const pageLead = "mt-3 max-w-3xl text-lg leading-relaxed text-stone-600";

// Small uppercase heading inside a card ("QUESTION", "KEY POINTS", ...)
export const label = "font-mono text-[11px] font-bold uppercase tracking-widest text-stone-500";

// Small black-bordered tag, give it a bg-* colour
export const chip = "inline-block border-2 border-ink px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide text-ink";

export const textLink = "font-display font-bold text-ink underline decoration-2 underline-offset-4 hover:bg-sun";

// Quoted line from the user's notes
export const sourceQuote = "border-l-4 border-sun pl-3 text-stone-600 italic";

// Tab / segmented control: selected is solid black
export const tabClass = (active: boolean) =>
  `inline-block border-2 border-ink px-4 py-2 font-display text-sm font-bold shadow-hard ${lift} ${
    active ? "bg-ink text-white" : "bg-white text-ink"
  }`;

// onRetry adds a "Try again" button, for an error from loading a page that the user can usefully ask for again
export function ErrorBox({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-rose-100 px-4 py-3 shadow-hard">
      <p role="alert" className="font-medium text-rose-900">
        {message}
      </p>
      {onRetry && (
        <button onClick={onRetry} className={secondaryButton}>
          Try again
        </button>
      )}
    </div>
  );
}

export function SuccessBox({ children }: { children: ReactNode }) {
  return <p className="mt-4 border-2 border-ink bg-mint/40 px-4 py-3 font-medium text-ink shadow-hard">{children}</p>;
}

export function Loading() {
  return <p className="mt-8 font-mono text-sm uppercase tracking-widest text-stone-500">Loading…</p>;
}

export function EmptyState({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="border-2 border-dashed border-ink bg-white px-6 py-10 text-center shadow-hard-lg">
      <p className="font-display text-xl font-bold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-stone-600">{text}</p>
      {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </div>
  );
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong";
}

// Under a list that comes in pages: how much is shown, and a button for the next page when there is one
export function LoadMore({
  shown,
  total,
  hasMore,
  loading,
  onClick,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
      <p className="font-mono text-xs uppercase tracking-wider text-stone-500" aria-live="polite">
        Showing {shown} of {total}
      </p>
      <button onClick={onClick} disabled={loading} className={secondaryButton}>
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
