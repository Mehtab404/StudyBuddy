"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";
import { EmptyState, pageTitle, primaryButton, secondaryButton } from "@/components/ui";

// Shown when a page crashes while rendering, instead of a blank screen. The header and footer stay in place.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // On the server, errors arrive with a digest that matches the server log. Quote it so a problem can be traced.
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;

  return (
    <div>
      <p className="font-mono text-xs font-bold uppercase tracking-widest text-stone-500">Something broke</p>
      <h1 className={`mt-2 ${pageTitle}`}>This page hit a problem</h1>
      <div className="mt-8">
        <EmptyState title="Sorry, that didn't work" text="It was probably a one-off. Try again, and if it keeps happening, go back to the home page.">
          <button onClick={() => retry()} className={primaryButton}>
            Try again
          </button>
          <Link href="/" className={secondaryButton}>
            Go to home
          </Link>
        </EmptyState>
        {digest && <p className="mt-4 text-center font-mono text-xs text-stone-500">Reference: {digest}</p>}
      </div>
    </div>
  );
}
