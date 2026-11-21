"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabClass } from "@/components/ui";

const tabs = [
  { href: "/flashcards/review", label: "Review queue" },
  { href: "/flashcards/library", label: "Library" },
  { href: "/flashcards/due", label: "Due today" },
  { href: "/flashcards/quiz", label: "Practice" },
];

export default function FlashcardsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <ul className="mb-10 flex flex-wrap gap-3 border-b-2 border-stone-300 pb-5">
        {tabs.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} className={tabClass(pathname === href)} aria-current={pathname === href ? "page" : undefined}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
