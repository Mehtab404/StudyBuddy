"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ErrorBox, card, errorMessage, inputClass, label, pageLead, pageTitle, primaryButton } from "@/components/ui";

// For guests only: turns the temporary guest account into a real one, keeping all the sets made so far
export default function UpgradePage() {
  const { user, upgrade } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Someone with a real account has nothing to upgrade. While upgrading (busy) the user turns into a non-guest
  // part-way through, and that must not send them away before we redirect them ourselves.
  useEffect(() => {
    if (user && !user.is_guest && !busy) router.replace("/");
  }, [user, busy, router]);

  if (!user?.is_guest && !busy) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await upgrade(name.trim(), email, password);
      router.replace("/sets"); // replace, so Back does not return to this form; busy stays true until the page changes
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className={pageTitle}>Keep your sets</h1>
      <p className={pageLead}>
        Create a free account and everything you have made as a guest stays with you: sets, revision notes, quizzes and
        flashcards. Guest data is deleted after 24 hours.
      </p>

      <form onSubmit={handleSubmit} className={`${card} mt-8 max-w-lg space-y-5`}>
        <label className="block">
          <span className={label}>Name</span>
          <input
            type="text"
            required
            maxLength={60}
            autoComplete="name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${inputClass} mt-2 w-full`}
          />
        </label>
        <label className="block">
          <span className={label}>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} mt-2 w-full`}
          />
        </label>
        <label className="block">
          <span className={label}>Password</span>
          <input
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} mt-2 w-full`}
          />
        </label>

        <ErrorBox message={error} />

        <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
          {busy ? "Please wait…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
