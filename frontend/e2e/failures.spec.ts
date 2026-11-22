import { expect, test } from "@playwright/test";
import { API, NOTES, createSetViaApi, pageAlert, startAsGuest } from "./helpers";

// What the pages do when the server misbehaves. The responses are made up here, so no real cards are needed.

const card = (id: string) => ({
  id,
  note_id: "a".repeat(24),
  question: `Question ${id}?`,
  answer: "An answer.",
  source: "A source sentence.",
  status: "pending",
  created_at: "2026-01-01T00:00:00Z",
  ease_factor: 2.5,
  interval_days: 0,
  repetitions: 0,
  due_date: null,
  check_status: "supported",
  check_reason: "ok",
});

test("the review queue does not hammer the server when the next page fails to load", async ({ page, request }) => {
  await startAsGuest(page, request);

  let nextPageRequests = 0;
  let serverIsDown = true;
  await page.route(`${API}/cards?**`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      nextPageRequests++;
      if (!serverIsDown) return route.fulfill({ json: { items: [card("c2")], next_cursor: null, total: 1 } });
      return route.fulfill({ status: 500, json: { detail: "The server fell over." } });
    }
    // The first page: one card on screen, and more waiting behind it
    return route.fulfill({ json: { items: [card("c1")], next_cursor: "more", total: 2 } });
  });
  await page.route(`${API}/cards/c1/approve`, (route) => route.fulfill({ json: { ...card("c1"), status: "approved" } }));

  await page.goto("/flashcards/review");
  await expect(page.getByText("2 waiting")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();

  // Everything on screen is dealt with, so the page asks for the next cards. That fails, and it shows why.
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText("The server fell over.");

  // One failed attempt is expected. Give a loop time to show itself, then check there was not one.
  await page.waitForTimeout(1500);
  expect(nextPageRequests).toBe(1);

  // Pressing "Try again" asks exactly once more, and once the server is back the cards appear
  serverIsDown = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Question c2?")).toBeVisible();
  expect(nextPageRequests).toBe(2);
});

test("the review queue brings in the next cards when the visible ones are all dealt with", async ({ page, request }) => {
  await startAsGuest(page, request);

  await page.route(`${API}/cards?**`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const next = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({
      json: next
        ? { items: [card("c2")], next_cursor: null, total: 1 }
        : { items: [card("c1")], next_cursor: "more", total: 2 },
    });
  });
  for (const id of ["c1", "c2"]) {
    await page.route(`${API}/cards/${id}/approve`, (route) => route.fulfill({ json: { ...card(id), status: "approved" } }));
  }

  await page.goto("/flashcards/review");
  await page.getByRole("article").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Question c2?")).toBeVisible(); // arrived without the user asking
  await page.getByRole("article").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Nothing to review")).toBeVisible();
});

// ---- slow, flaky and failing connections ----

const emptySets = { items: [], next_cursor: null, total: 0 };

test("a read that fails because the server is waking up is tried again by itself", async ({ page, request }) => {
  await startAsGuest(page, request);
  let requests = 0;
  await page.route(`${API}/sets**`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    requests++;
    // The free host answers 503 while it starts. The third try gets through.
    return requests < 3 ? route.fulfill({ status: 503, json: { detail: "Starting" } }) : route.fulfill({ json: emptySets });
  });

  await page.goto("/sets");
  await expect(page.getByText("No study sets yet")).toBeVisible();
  expect(requests).toBe(3);
  await expect(pageAlert(page)).toHaveCount(0); // the user never saw an error
});

test("a dropped connection is tried again, and a server that stays down shows an error with Try again", async ({ page, request }) => {
  await startAsGuest(page, request);
  let requests = 0;
  let down = true;
  await page.route(`${API}/sets**`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    requests++;
    return down ? route.abort("connectionrefused") : route.fulfill({ json: emptySets });
  });

  await page.goto("/sets");
  await expect(pageAlert(page)).toContainText("Can't reach the server");
  expect(requests).toBe(3); // the first try and two more, then it gave up

  down = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No study sets yet")).toBeVisible();
  await expect(pageAlert(page)).toHaveCount(0);
});

test("an error that is not worth repeating is shown straight away, once", async ({ page, request }) => {
  await startAsGuest(page, request);
  let requests = 0;
  await page.route(`${API}/sets**`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    requests++;
    return route.fulfill({ status: 500, json: { detail: "Something is broken." } });
  });
  await page.goto("/sets");
  await expect(pageAlert(page)).toHaveText("Something is broken.");
  await page.waitForTimeout(2500); // longer than the pause a retry would have had
  expect(requests).toBe(1);
});

test("a request that changes data is never sent twice", async ({ page, request }) => {
  await startAsGuest(page, request);
  let posts = 0;
  await page.route(`${API}/sets`, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts++;
    return route.fulfill({ status: 503, json: { detail: "Try later." } });
  });

  await page.goto("/");
  await page.getByPlaceholder("Paste your notes here…").fill(NOTES);
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(pageAlert(page)).toHaveText("Try later.");
  await page.waitForTimeout(2500);
  expect(posts).toBe(1);
});

test("a slow answer for a set the user already left does not show up in the next one", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const slow = await createSetViaApi(request, token, "Slow set");
  const quick = await createSetViaApi(request, token, "Quick set");

  // The first set's page is held back for a while
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`${API}/sets/${slow.id}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await held;
    await route.fallback();
  });

  await page.goto("/sets");
  await page.getByRole("link", { name: /Slow set/ }).click(); // asks for the slow set, which does not come yet
  await expect(page.getByText("Loading…")).toBeVisible();
  await page.getByRole("link", { name: "My sets" }).first().click();
  await page.getByRole("link", { name: /Quick set/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Quick set" })).toBeVisible();

  release(); // now the slow answer arrives, late
  await page.waitForTimeout(800);
  await expect(page.getByRole("heading", { level: 1, name: "Quick set" })).toBeVisible();
  await expect(page).toHaveTitle("Quick set · studyBuddy");
  expect(quick.id).toBeTruthy();
});

test("leaving a page cancels the request it was waiting for", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const set = await createSetViaApi(request, token, "Held set");

  await page.route(`${API}/sets/${set.id}`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    // never answered
  });
  let cancelled = false;
  page.on("requestfailed", (r) => {
    if (r.url() === `${API}/sets/${set.id}` && /ABORTED/i.test(r.failure()?.errorText ?? "")) cancelled = true;
  });

  await page.goto("/sets");
  await page.getByRole("link", { name: /Held set/ }).click();
  await expect(page.getByText("Loading…")).toBeVisible();
  await page.getByRole("link", { name: "My sets" }).first().click(); // leave while it is still waiting
  await expect(page.getByRole("link", { name: /Held set/ })).toBeVisible();
  await expect.poll(() => cancelled).toBe(true);
});

test("a set page that failed to load can be asked for again", async ({ page, request }) => {
  const token = await startAsGuest(page, request);
  const set = await createSetViaApi(request, token, "Flaky set");
  let broken = true;
  await page.route(`${API}/sets/${set.id}`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return broken ? route.fulfill({ status: 500, json: { detail: "Broke." } }) : route.fallback();
  });

  await page.goto(`/sets/${set.id}`);
  await expect(pageAlert(page)).toHaveText("Broke.");
  await expect(page.getByRole("link", { name: "← Back to my sets" })).toBeVisible();

  broken = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Flaky set" })).toBeVisible();
});

test("a slow search answer never replaces the results of a newer search", async ({ page, request }) => {
  await startAsGuest(page, request);
  const item = (id: string) => ({ ...card(id), status: "approved", question: `Result for ${id}?` });

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`${API}/cards?**`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q === "old") {
      await held; // the answer to the first search comes late
      return route.fulfill({ json: { items: [item("old")], next_cursor: null, total: 1 } }).catch(() => {}); // it may have been cancelled
    }
    return route.fulfill({ json: { items: [item(q === "new" ? "new" : "none")], next_cursor: null, total: 1 } });
  });

  await page.goto("/flashcards/library");
  await expect(page.getByText("Result for none?")).toBeVisible();

  await page.getByLabel("Search cards").fill("old");
  await page.waitForTimeout(500); // longer than the pause before a search is sent
  await page.getByLabel("Search cards").fill("new");
  await expect(page.getByText("Result for new?")).toBeVisible();

  release();
  await page.waitForTimeout(800);
  await expect(page.getByText("Result for new?")).toBeVisible(); // the late answer was not used
  await expect(page.getByText("Result for old?")).toBeHidden();
});