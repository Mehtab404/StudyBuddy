import type { Metadata } from "next";

export const metadata: Metadata = { title: "My sets" };

export default function SetsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
