"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import Logo from "@/components/Logo";

// The three things the app makes, shown on the left panel
const features = [
  { tag: "Notes", color: "bg-mint", n: "01", title: "Revision Notes", text: "Clean summaries from PDFs & text" },
  { tag: "Quiz", color: "bg-sky-300", n: "02", title: "Practice Quiz", text: "Exam papers for any mark total" },
  { tag: "Cards", color: "bg-sun", n: "03", title: "Flashcards", text: "Fast active-recall decks" },
];

const input =
  "mt-2 w-full rounded-sm border-2 border-ink bg-background px-4 py-3 text-base text-ink outline-none placeholder:text-stone-400 focus:bg-white focus:shadow-hard";

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      {open ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a12.7 12.7 0 0 1-2.7 3.4M6.5 7.6A12.6 12.6 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.8-.4 4-.9" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      ) : (
        <>
          <path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function IntroPanel({ isSignup }: { isSignup: boolean }) {
  return (
    <section className="bg-grid flex flex-col justify-between gap-10 border-b-2 border-ink px-6 py-10 sm:px-10 md:border-r-2 md:border-b-0 md:py-12 lg:px-14 xl:px-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Logo />
        <span className="border-2 border-ink bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-widest text-ink shadow-hard">
          Home / {isSignup ? "Sign up" : "Sign in"}
        </span>
      </div>

      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-stone-700 sm:text-sm">Study workspace // your notes, amplified</p>
        <h2 className="mt-4 font-display text-5xl font-bold leading-[1.05] tracking-tight text-ink lg:text-6xl xl:text-7xl">
          Write, <span className="mark-sun">Study</span>
          <br />
          with <span className="mark-sun">Fun.</span>
        </h2>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-stone-600">
          Turn raw lecture notes and PDFs into crisp revision sheets, custom-mark exam papers, and active-recall flashcards
          in seconds.
        </p>

        <ul className="mt-10 grid max-w-3xl gap-4 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
          {features.map((f) => (
            <li key={f.tag} className="flex flex-col rounded-sm border-2 border-ink bg-white p-4 shadow-hard-lg">
              <div className="flex items-center justify-between">
                <span className={`border-2 border-ink px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-ink ${f.color}`}>
                  {f.tag}
                </span>
                <span className="font-mono text-xs text-stone-600">{f.n}</span>
              </div>
              <p className="mt-4 font-display font-bold text-ink">{f.title}</p>
              <p className="mt-1 text-sm text-stone-600">{f.text}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-stone-300 pt-6 font-mono text-sm uppercase tracking-widest">
        <span className="text-stone-600">All sets synced automatically</span>
        <span className="font-bold text-ink">studyBuddy</span>
      </div>
    </section>
  );
}

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { login, signup, guest } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (isSignup ? signup(name.trim(), email, password) : login(email, password, remember));
      // AuthProvider redirects to the home page once the user is set
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  async function handleGuest() {
    setBusy(true);
    setError(null);
    try {
      await guest();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen flex-1 md:grid-cols-2">
      <IntroPanel isSignup={isSignup} />

      <main className="flex items-center justify-center px-6 py-12 lg:px-10">
        <div className="w-full max-w-lg rounded-md border-2 border-ink bg-white p-8 shadow-[8px_8px_0_0_#111111] sm:p-11">
          <div className="flex items-center justify-between gap-4 border-b-2 border-stone-200 pb-6">
            <Logo small tagline={false} />
            <span className="font-mono text-xs uppercase tracking-widest text-stone-500">Exam prep</span>
          </div>

          <h1 className="mt-8 font-display text-4xl font-bold tracking-tight text-ink">
            {isSignup ? "Create Account" : "Welcome Back"}
          </h1>
          <p className="mt-2 text-stone-600">
            {isSignup ? "Your notes and cards stay private to you." : "Sign in to continue your learning journey."}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            {isSignup && (
              <label className="block font-display font-bold text-ink">
                Name
                <input
                  type="text"
                  required
                  maxLength={60}
                  autoComplete="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`${input} font-sans font-normal`}
                />
              </label>
            )}
            <label className="block font-display font-bold text-ink">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${input} font-sans font-normal`}
              />
            </label>
            <label className="block font-display font-bold text-ink">
              Password
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={isSignup ? 8 : undefined}
                  maxLength={128}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  placeholder={isSignup ? "At least 8 characters" : "Enter your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${input} pr-12 font-sans font-normal`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 mt-2 flex items-center px-4 text-stone-600 hover:text-ink"
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </label>

            {!isSignup && (
              <label className="flex w-fit cursor-pointer items-center gap-3 text-ink">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-5 w-5 cursor-pointer rounded-sm border-2 border-ink accent-ink"
                />
                Remember me
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-sm border-2 border-ink bg-rose-100 px-4 py-3 text-sm font-medium text-rose-900">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-sm border-2 border-ink bg-sun px-6 py-3.5 font-display text-lg font-bold text-ink shadow-hard-lg transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? "Please wait…" : isSignup ? "Sign Up" : "Sign In"}
              {!busy && <span aria-hidden="true">→</span>}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-4 font-mono text-xs uppercase tracking-widest text-stone-500">
            <span className="h-0.5 flex-1 bg-stone-200" />
            or
            <span className="h-0.5 flex-1 bg-stone-200" />
          </div>
          <button
            type="button"
            onClick={handleGuest}
            disabled={busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-sm border-2 border-ink bg-white px-6 py-3 font-display text-base font-bold text-ink shadow-hard transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70"
          >
            Continue as Guest
          </button>
          <p className="mt-2 text-center text-xs text-stone-500">No account needed. Guest sets are deleted after 24 hours.</p>

          <p className="mt-8 border-t-2 border-stone-200 pt-6 text-center text-stone-600">
            {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
            <Link
              href={isSignup ? "/login" : "/signup"}
              className="ml-1 font-display font-bold text-ink underline decoration-2 underline-offset-4 hover:bg-sun"
            >
              {isSignup ? "Sign In" : "Sign Up"}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
