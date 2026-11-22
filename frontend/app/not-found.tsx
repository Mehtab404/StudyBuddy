import Link from "next/link";
import { EmptyState, pageTitle, primaryButton } from "@/components/ui";

// Shown for any address the app has no page for, and wherever a page calls notFound()
export default function NotFound() {
  return (
    <div>
      <p className="font-mono text-xs font-bold uppercase tracking-widest text-stone-500">Error 404</p>
      <h1 className={`mt-2 ${pageTitle}`}>Page not found</h1>
      <div className="mt-8">
        <EmptyState title="We couldn't find that page" text="The link may be wrong or out of date, or the page may have been removed.">
          <Link href="/" className={primaryButton}>
            Go to home
          </Link>
          <Link href="/sets" className={primaryButton}>
            My sets
          </Link>
        </EmptyState>
      </div>
    </div>
  );
}
