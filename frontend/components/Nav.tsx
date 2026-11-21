"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import Logo from "@/components/Logo";
import type { User } from "@/lib/api";

const links = [
  { href: "/", label: "New set", match: (p: string) => p === "/" },
  { href: "/sets", label: "My sets", match: (p: string) => p.startsWith("/sets") },
  { href: "/flashcards/review", label: "Flashcards", match: (p: string) => p.startsWith("/flashcards") },
];

function ProfileMenu({ user, logout }: { user: User; logout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Accounts made before names were asked for have none, so fall back to the start of the email
  const name = user.name || user.email.split("@")[0];
  const initial = name.charAt(0).toUpperCase();
  const since = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center border-2 border-ink bg-mint font-display text-lg font-bold text-ink shadow-hard transition-transform hover:-translate-y-0.5"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-3 w-64 border-2 border-ink bg-white p-4 shadow-hard-lg">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-ink bg-mint font-display text-lg font-bold text-ink">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="truncate font-display font-bold text-ink">{name}</p>
              <p className="truncate text-xs text-stone-600">{user.email}</p>
            </div>
          </div>
          {since && <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-stone-500">Member since {since}</p>}
          <button
            onClick={logout}
            className="mt-4 w-full border-2 border-ink bg-white px-4 py-2 font-display text-sm font-bold text-ink shadow-hard transition-transform hover:-translate-y-0.5"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

// Active page: yellow block with a hard shadow. Other pages: plain bold text.
const navLink = (active: boolean) =>
  `inline-flex items-center gap-1.5 px-5 py-2.5 font-display text-[15px] font-bold text-ink transition-transform ${
    active ? "border-2 border-ink bg-sun shadow-hard" : "border-2 border-transparent hover:-translate-y-0.5 hover:underline"
  }`;

export default function Nav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <header className="no-print border-b-2 border-ink bg-white">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <Logo />
        {user ? (
          <div className="flex flex-wrap items-center gap-3">
            <ul className="flex flex-wrap gap-2">
              {links.map(({ href, label, match }) => (
                <li key={href}>
                  <Link href={href} className={navLink(match(pathname))}>
                    {href === "/" && <span aria-hidden="true">+</span>}
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
            <ProfileMenu user={user} logout={logout} />
          </div>
        ) : (
          <div className="flex gap-2">
            {[
              { href: "/login", label: "Log in" },
              { href: "/signup", label: "Sign up" },
            ].map(({ href, label }) => (
              <Link key={href} href={href} className={navLink(pathname === href)}>
                {label}
              </Link>
            ))}
          </div>
        )}
      </nav>
    </header>
  );
}
