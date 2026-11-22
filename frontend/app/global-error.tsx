"use client"; // Error boundaries must be Client Components

import "./globals.css";

// Last resort: used only when the root layout itself fails, so it has to bring its own <html> and <body>
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-lg border-2 border-ink bg-white p-8 text-center shadow-hard-lg">
          <h1 className="font-display text-3xl font-bold text-ink">studyBuddy hit a problem</h1>
          <p className="mt-3 text-stone-600">Something went wrong while loading the app. Please try again.</p>
          <button
            onClick={() => retry()}
            className="mt-6 border-2 border-ink bg-sun px-6 py-2.5 font-bold text-ink shadow-hard transition-transform hover:-translate-y-0.5"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
