import Link from "next/link";
import { EmptyState, pageTitle, primaryButton } from "@/components/ui";

// A set that does not exist, or that belongs to someone else (the backend answers 404 for both)
export default function SetNotFound() {
  return (
    <div>
      <p className="font-mono text-xs font-bold uppercase tracking-widest text-stone-500">Error 404</p>
      <h1 className={`mt-2 ${pageTitle}`}>Study set not found</h1>
      <div className="mt-8">
        <EmptyState title="This set isn't available" text="It may have been deleted, or the link may be wrong. Guest sets are removed after 24 hours.">
          <Link href="/sets" className={primaryButton}>
            Back to my sets
          </Link>
          <Link href="/" className={primaryButton}>
            Make a new set
          </Link>
        </EmptyState>
      </div>
    </div>
  );
}
