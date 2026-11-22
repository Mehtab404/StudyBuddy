import { expect, test, type Page } from "@playwright/test";
import { NOTES, createSetViaApi, openSet, startAsGuest } from "./helpers";

// The main journey, clicked through like a student would: guest -> notes -> set -> quiz -> flashcards -> review -> practice.

test("a guest can start, make a set from pasted notes and reach it", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/); // not logged in: sent to the login page
  await expect(page).toHaveTitle("Log in · studyBuddy");

  await page.getByRole("button", { name: "Continue as Guest" }).click();
  await expect(page.getByRole("heading", { name: "Prepare for your exam" })).toBeVisible();

  const next = page.getByRole("button", { name: /^Continue/ });
  await expect(next).toBeDisabled(); // nothing pasted yet
  await page.getByPlaceholder("Paste your notes here…").fill("too short");
  await expect(next).toBeDisabled();
  await page.getByPlaceholder("Paste your notes here…").fill(NOTES);
  await page.getByPlaceholder("e.g. Biology").fill("Biology");
  await expect(next).toBeEnabled();
  await next.click();

  await expect(page).toHaveURL(/\/sets\/[0-9a-f]{24}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Biology" })).toBeVisible();
  await expect(page).toHaveTitle("Biology · studyBuddy");
  for (const tab of ["Revision notes", "Quiz", "Exam paper", "Flashcards", "Ask your notes"]) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible();
  }

  // The new set is in the list
  await page.getByRole("link", { name: "My sets" }).first().click();
  await expect(page.getByRole("link", { name: /Biology/ })).toBeVisible();
});

test("revision notes are made from a set", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const set = await createSetViaApi(request, token, "Biology");
  await openSet(page, set.id);

  await page.getByRole("button", { name: "Make revision notes" }).click();
  await expect(page.getByText("1 topics")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cell energy" })).toBeVisible();
  await expect(page.getByText("The mitochondria makes ATP.")).toBeVisible();
});

// Answers question n of the quiz. The right answer is always "Mitochondria" in the test backend.
async function answer(page: Page, n: number, right: boolean) {
  const question = page.getByRole("listitem").filter({ hasText: `Question ${n}:` });
  await question.getByRole("button", { name: right ? "Mitochondria" : "Nucleus" }).click();
}

test("a quiz: answer it, see the result saved, retry the questions that were missed", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const set = await createSetViaApi(request, token, "Biology");
  await openSet(page, set.id, "Quiz");

  await page.getByLabel("Questions").selectOption("5");
  await page.getByRole("button", { name: "Make quiz" }).click();
  await expect(page.getByText("Answered 0 of 5")).toBeVisible();

  // 3 right, 2 wrong
  for (const n of [1, 2, 3]) await answer(page, n, true);
  await expect(page.getByText("Score 3/3")).toBeVisible();
  await expect(page.getByText("You got")).toBeHidden(); // not finished yet, so nothing is saved
  await answer(page, 4, false);
  await answer(page, 5, false);

  await expect(page.getByText("You got 3 of 5 right")).toBeVisible();
  await expect(page.getByText("Result saved.")).toBeVisible();

  // The results panel now knows about it
  const panel = page.getByRole("region", { name: "Your quiz results" });
  await expect(panel.getByText("3/5")).toBeVisible();
  await expect(panel.getByText("Cell energy")).toBeVisible();
  await expect(panel.getByText("Cell parts")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Practise 2 missed questions" })).toBeVisible();

  // Retry only the ones that were wrong
  await page.getByRole("button", { name: "Retry the 2 I missed" }).click();
  await expect(page.getByText("Practising missed questions")).toBeVisible();
  await expect(page.getByText("Answered 0 of 2")).toBeVisible();
  await answer(page, 4, true); // the questions keep their wording, so these are still "Question 4" and "Question 5"
  await answer(page, 5, true);
  await expect(page.getByText("You got 2 of 2 right")).toBeVisible();
  await expect(page.getByText("Result saved.")).toBeVisible();

  // Both are learned now, so nothing is left to practise, and two results are listed
  await expect(panel.getByRole("button", { name: /Practise \d+ missed/ })).toBeHidden();
  await expect(panel.getByText("2/2")).toBeVisible();
  await expect(panel.getByText("2 quizzes")).toBeVisible();
});

test("the results survive a reload and a new quiz", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const set = await createSetViaApi(request, token, "Biology");
  await openSet(page, set.id, "Quiz");
  await page.getByLabel("Questions").selectOption("5");
  await page.getByRole("button", { name: "Make quiz" }).click();
  for (const n of [1, 2, 3, 4, 5]) await answer(page, n, false);
  await expect(page.getByText("Result saved.")).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Quiz" }).click();
  const panel = page.getByRole("region", { name: "Your quiz results" });
  await expect(panel.getByText("0/5")).toBeVisible();

  await page.getByLabel("Questions").selectOption("5"); // the choice is not kept over a reload
  await page.getByRole("button", { name: "New quiz" }).click();
  await expect(page.getByText("Answered 0 of 5")).toBeVisible(); // a fresh quiz...
  await expect(panel.getByText("0/5")).toBeVisible(); // ...and the history is still there
  await expect(panel.getByRole("button", { name: "Practise 5 missed questions" })).toBeVisible();
});

test("flashcards: make them, review them, find them in the library, study them", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const set = await createSetViaApi(request, token, "Biology");
  await openSet(page, set.id, "Flashcards");

  await page.getByRole("button", { name: "Make flashcards" }).click();
  await expect(page.getByText("Made 3 cards.")).toBeVisible();
  await page.getByRole("link", { name: "Go to the review queue" }).click();

  // Review queue: approve one, edit and approve one, reject one
  await expect(page.getByText("3 waiting")).toBeVisible();
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(3);
  await expect(page.getByText("✓ Answer matches the source").first()).toBeVisible();

  await cards.filter({ hasText: "What makes ATP?" }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("2 waiting")).toBeVisible();

  // Cards stay in the order they were made, so the DNA card is now first. (It cannot be found by its text while it is
  // being edited, because the text is then inside a text box.)
  const dna = cards.first();
  await expect(dna).toContainText("Where is DNA stored?");
  await dna.getByRole("button", { name: "Edit" }).click();
  await dna.getByRole("textbox").first().fill("Where is the genetic code kept?");
  await dna.getByRole("button", { name: "Save" }).click();
  await expect(dna.getByText("Where is the genetic code kept?")).toBeVisible();
  await dna.getByRole("button", { name: "Approve" }).click();

  await expect(cards).toHaveCount(1);
  await cards.first().getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Nothing to review")).toBeVisible();

  // Library: the two approved cards, searchable, one can be deleted
  await page.getByRole("link", { name: "Library" }).click();
  await expect(page.getByText("2 cards")).toBeVisible();
  await page.getByLabel("Search cards").fill("genetic");
  await expect(page.getByText("1 match")).toBeVisible();
  await expect(page.getByText("Where is the genetic code kept?")).toBeVisible();
  await expect(page.getByText("What makes ATP?")).toBeHidden();
  await page.getByLabel("Search cards").fill("zzz-nothing");
  await expect(page.getByText("No cards match “zzz-nothing”.")).toBeVisible();
  await page.getByLabel("Search cards").fill("");
  await expect(page.getByText("2 cards")).toBeVisible();

  await page.getByRole("listitem").filter({ hasText: "What makes ATP?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Delete this card for good?")).toBeVisible();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("1 card", { exact: true })).toBeVisible();
  await expect(page.getByText("What makes ATP?")).toBeHidden();

  // Study the one left
  await page.getByRole("link", { name: "Due today" }).click();
  await expect(page.getByText("1 due")).toBeVisible();
  await page.getByRole("link", { name: /Start quiz/ }).click();
  await expect(page.getByText("Card 1 of 1")).toBeVisible();
  await page.getByRole("button", { name: "Show answer" }).click();
  // (scoped to the card: the library page we came from can still be in the page, out of sight)
  await expect(page.getByRole("article").getByText("In the nucleus.")).toBeVisible();
  await page.getByRole("button", { name: "I knew it ✓" }).click();
  await expect(page.getByText("Session complete")).toBeVisible();
  await expect(page.getByText("You knew 1 of 1.")).toBeVisible();

  // It is not due again today
  await page.getByRole("link", { name: "Back to due cards" }).click();
  await expect(page.getByText("You’re all caught up")).toBeVisible();
});

test("an exam paper loads when opened and is still there after a reload", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const set = await createSetViaApi(request, token, "Biology");
  await openSet(page, set.id, "Exam paper");

  await page.getByLabel("Total marks").fill("10");
  await page.getByRole("button", { name: /Make paper/ }).click();
  await expect(page.getByRole("heading", { name: "Biology mock paper" })).toBeVisible();
  await expect(page.getByText("What makes ATP?")).toBeVisible();
  await expect(page.getByText("Total marks: 10")).toBeVisible();

  // The set lists only a summary, so after a reload the questions are fetched again
  await page.reload();
  await page.getByRole("tab", { name: "Exam paper" }).click();
  await expect(page.getByText("Where is DNA stored?")).toBeVisible();

  await expect(page.getByText("The mitochondria.")).toBeHidden();
  await page.getByLabel("Show answers and marking scheme").check();
  await expect(page.getByText("The mitochondria.")).toBeVisible();
});
