import type { Metadata } from "next";

export const metadata: Metadata = { title: "Due today" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
