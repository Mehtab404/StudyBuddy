"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  ErrorBox,
  SuccessBox,
  card,
  dangerButton,
  errorMessage,
  inputClass,
  label,
  pageLead,
  pageTitle,
  primaryButton,
  secondaryButton,
  textLink,
} from "@/components/ui";

function ChangePassword() {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${card} max-w-lg space-y-5`}>
      <h2 className="font-display text-xl font-bold text-ink">Change password</h2>
      <label className="block">
        <span className={label}>Current password</span>
        <input
          type="password"
          required
          maxLength={128}
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={`${inputClass} mt-2 w-full`}
        />
      </label>
      <label className="block">
        <span className={label}>New password</span>
        <input
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={`${inputClass} mt-2 w-full`}
        />
      </label>
      <p className="text-sm text-stone-600">Changing your password signs you out on every other device.</p>
      <ErrorBox message={error} />
      {done && <SuccessBox>Password changed.</SuccessBox>}
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy ? "Please wait…" : "Change password"}
      </button>
    </form>
  );
}

function DeleteAccount({ isGuest }: { isGuest: boolean }) {
  const { deleteAccount } = useAuth();
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(isGuest ? null : password); // signs out, which sends the user to the login page
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className={`${card} max-w-lg`}>
      <h2 className="font-display text-xl font-bold text-ink">Delete account</h2>
      <p className="mt-2 text-stone-700">
        This permanently deletes your account and everything in it: all study sets, revision notes, quizzes, exam papers
        and flashcards. It cannot be undone.
      </p>
      {!asking ? (
        <button onClick={() => setAsking(true)} className={`${dangerButton} mt-5`}>
          Delete my account…
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {!isGuest && (
            <label className="block">
              <span className={label}>Enter your password to confirm</span>
              <input
                type="password"
                required
                maxLength={128}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} mt-2 w-full`}
              />
            </label>
          )}
          <ErrorBox message={error} />
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={dangerButton}>
              {busy ? "Deleting…" : "Yes, delete everything"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAsking(false);
                setPassword("");
                setError(null);
              }}
              className={secondaryButton}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div>
      <h1 className={pageTitle}>Account</h1>
      <p className={pageLead}>
        {user.is_guest ? "You're using a temporary guest session." : `Signed in as ${user.name ?? user.email} (${user.email}).`}
      </p>

      <div className="mt-8 space-y-8">
        {user.is_guest ? (
          <p className="max-w-lg text-stone-700">
            Guests have no password.{" "}
            <Link href="/upgrade" className={textLink}>
              Create a free account
            </Link>{" "}
            to keep your sets and sign in later.
          </p>
        ) : (
          <ChangePassword />
        )}
        <DeleteAccount isGuest={Boolean(user.is_guest)} />
      </div>
    </div>
  );
}
