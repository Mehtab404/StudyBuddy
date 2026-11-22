"use client";

import { usePathname } from "next/navigation";
import { PUBLIC_PATHS } from "@/components/AuthProvider";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

// Login and signup are full-screen split pages with their own header; every other page gets the nav bar.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (PUBLIC_PATHS.includes(pathname)) {
    return (
      <>
        <div className="flex flex-1 flex-col">{children}</div>
        <Footer />
      </>
    );
  }
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
      <Footer />
    </>
  );
}
