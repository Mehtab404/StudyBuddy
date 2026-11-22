import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import AuthProvider from "@/components/AuthProvider";
import "./globals.css";

// Body text, headings/buttons, and small uppercase labels
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

const description = "Turn your notes into revision notes, quizzes, exam papers and flashcards";

// Pages and layouts below set `title`; the template adds the site name to it
export const metadata: Metadata = {
  title: { default: "studyBuddy", template: "%s · studyBuddy" },
  description,
  openGraph: { type: "website", siteName: "studyBuddy", title: "studyBuddy", description },
  twitter: { card: "summary", title: "studyBuddy", description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* AuthProvider and AppShell read the current URL, which isn't known while prerendering */}
        <Suspense fallback={null}>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
