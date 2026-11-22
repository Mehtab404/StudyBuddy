import FlashcardTabs from "@/components/FlashcardTabs";

// No title here on purpose. Each tab page sets its own, and a plain title in this layout would cut the root layout's
// "… · studyBuddy" template off from them.
export default function FlashcardsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <FlashcardTabs />
      {children}
    </div>
  );
}
