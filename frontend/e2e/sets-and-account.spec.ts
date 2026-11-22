import { expect, test } from "@playwright/test";
import { PASSWORD, createSetViaApi, newGuestToken, openSet, pageAlert, signInWithToken, startAsGuest, uniqueEmail } from "./helpers";

test("the set list loads more sets on request and a set can be deleted", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  for (let i = 1; i <= 22; i++) await createSetViaApi(request, token, `Set ${String(i).padStart(2, "0")}`);

  await page.goto("/sets");
  await expect(page.getByText("Showing 20 of 22")).toBeVisible();
  await expect(page.getByRole("link", { name: /Set 22/ })).toBeVisible(); // newest first
  await expect(page.getByRole("link", { name: /Set 03/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Set 02/ })).toBeHidden(); // on the second page

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("link", { name: /Set 02/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Set 01/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden(); // that was the last page

  page.once("dialog", (dialog) => dialog.accept()); // "Delete this study set...?"
  await page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: /Set 22/ }) })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByRole("link", { name: /Set 22/ })).toBeHidden();
});

test("a set can be renamed", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const set = await createSetViaApi(request, token, "Old name");
  await openSet(page, set.id);

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Set title").fill("   ");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled(); // a blank title cannot be saved
  await page.getByLabel("Set title").fill("Cell biology");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cell biology" })).toBeVisible();
  await expect(page).toHaveTitle("Cell biology · studyBuddy");

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Set title").fill("Thrown away");
  await page.getByLabel("Set title").press("Escape"); // cancels
  await expect(page.getByRole("heading", { level: 1, name: "Cell biology" })).toBeVisible();

  await page.goto("/sets");
  await expect(page.getByRole("link", { name: /Cell biology/ })).toBeVisible();
});

test("the set page tabs work with the keyboard", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const set = await createSetViaApi(request, token, "Biology");
  await openSet(page, set.id);

  const tabs = page.getByRole("tab");
  await expect(page.getByRole("tab", { name: "Revision notes" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Revision notes" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Quiz" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Quiz" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toBeVisible();

  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Ask your notes" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight"); // wraps round to the first
  await expect(page.getByRole("tab", { name: "Revision notes" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft"); // and back to the last
  await expect(page.getByRole("tab", { name: "Ask your notes" })).toBeFocused();
  await expect(tabs).toHaveCount(5);
});

test("a person cannot open someone else's set", async ({ page, request }) => {
  const owner = await newGuestToken(request);
  const set = await createSetViaApi(request, owner, "Private");
  await startAsGuest(page, request); // a different user
  await page.goto(`/sets/${set.id}`);
  await expect(page.getByText("Private")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Private");
});

test("an unknown set shows the not-found page", async ({ page, request }) => {
  await startAsGuest(page, request);
  const response = await page.goto(`/sets/${"0".repeat(24)}`);
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByText(/not found|doesn.t exist|couldn.t find/i).first()).toBeVisible();
});

test("signing up, changing the password, logging in again and deleting the account", async ({ page }) => {
  const email = uniqueEmail();
  const newPassword = "an even better passphrase";

  // Sign up through the form
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Ana");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign Up" }).click();
  await expect(page.getByRole("heading", { name: "Prepare for your exam" })).toBeVisible();

  // Account page: the wrong current password is refused and does not log the user out
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("link", { name: "Account settings" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByLabel("Current password").fill("not my password");
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(pageAlert(page)).toHaveText("Incorrect password");
  await expect(page).toHaveURL(/\/account$/);

  // The right one works, and the user stays logged in (the page gets the new token)
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();

  // Log out. The old password no longer works, the new one does.
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(pageAlert(page)).toHaveText("Incorrect email or password");

  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { name: "Prepare for your exam" })).toBeVisible();

  // Delete the account
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete my account…" }).click();
  await page.getByLabel("Enter your password to confirm").fill("wrong");
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(pageAlert(page)).toHaveText("Incorrect password");
  await page.getByLabel("Enter your password to confirm").fill(newPassword);
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // It is gone
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(pageAlert(page)).toHaveText("Incorrect email or password");
});

test("a guest can turn the session into a real account and keeps their sets", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  await createSetViaApi(request, token, "Kept set");

  await page.goto("/sets");
  await expect(page.getByRole("link", { name: /Kept set/ })).toBeVisible();
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("link", { name: "Create a free account" }).click();
  await expect(page).toHaveURL(/\/upgrade$/);

  await page.getByLabel("Name").fill("Ana");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/sets$/);
  await expect(page.getByRole("link", { name: /Kept set/ })).toBeVisible();
  await page.getByRole("button", { name: "Profile" }).click();
  await expect(page.getByText("Temporary session")).toBeHidden();
});

test("pages have their own titles", async ({ page, request }) => {
  await page.goto("/signup");
  await expect(page).toHaveTitle("Sign up · studyBuddy");

  const token = await newGuestToken(request);
  await signInWithToken(page, token);
  await page.goto("/sets");
  await expect(page).toHaveTitle("My sets · studyBuddy");
  await page.goto("/flashcards/review");
  await expect(page).toHaveTitle("Review queue · studyBuddy");
  await page.goto("/flashcards/library");
  await expect(page).toHaveTitle("Flashcard library · studyBuddy");
  await page.goto("/account");
  await expect(page).toHaveTitle("Account · studyBuddy");
});
