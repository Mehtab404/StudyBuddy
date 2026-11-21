import Link from "next/link";

// Yellow notes icon + "studyBuddy". `small` is the compact version used inside the sign-in card.
export default function Logo({ small = false, tagline = true }: { small?: boolean; tagline?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3">
      <span
        className={`flex items-center justify-center border-2 border-ink bg-sun shadow-hard ${
          small ? "h-10 w-10" : "h-12 w-12"
        }`}
      >
        <svg viewBox="0 0 24 24" className={small ? "h-5 w-5" : "h-6 w-6"} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <rect x="5" y="3" width="14" height="18" rx="1.5" />
          <path d="M9 8h6M9 12h6M9 16h3" strokeLinecap="round" />
        </svg>
      </span>
      <span className="leading-none">
        <span className={`block font-display font-bold tracking-tight text-ink ${small ? "text-xl" : "text-2xl"}`}>studyBuddy</span>
        {tagline && (
          <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.15em] text-stone-600">.org // exam prep</span>
        )}
      </span>
    </Link>
  );
}
