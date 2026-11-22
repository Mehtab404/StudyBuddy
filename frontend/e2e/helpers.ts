import { expect, type APIRequestContext, type Page } from "@playwright/test";

// Where the fake backend (backend/e2e_server.py) listens. Must match playwright.config.ts.
export const API = "http://127.0.0.1:8100";

// The key the app keeps its login token under (see tokenStore in lib/api.ts)
const TOKEN_KEY = "study_guide_token";

export const NOTES =
  "The mitochondria is the organelle that produces most of the cell's ATP. " +
  "Photosynthesis takes place in the chloroplasts of plant cells. " +
  "The nucleus stores the cell's DNA and controls its activity.";

export const PASSWORD = "correct horse battery";

// The error or notice a page shows for the user. Next also keeps its own role="alert" element, to announce page
// changes to screen readers, so a plain getByRole("alert") finds two.
export function pageAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// A new guest account made straight through the API. Much faster than going through the login page.
export async function newGuestToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/guest`);
  expect(res.status()).toBe(201);
  return (await res.json()).access_token;
}

// Makes the browser start out logged in as that user
export async function signInWithToken(page: Page, token: string) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [TOKEN_KEY, token]);
}

// A guest who is already logged in in the browser
export async function startAsGuest(page: Page, request: APIRequestContext): Promise<string> {
  const token = await newGuestToken(request);
  await signInWithToken(page, token);
  return token;
}

export async function createSetViaApi(request: APIRequestContext, token: string, subject: string, notes = NOTES) {
  const res = await request.post(`${API}/sets`, { headers: auth(token), data: { notes, subject } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; title: string };
}

// Opens a set's page on one of its tabs
export async function openSet(page: Page, id: string, tab?: string) {
  await page.goto(`/sets/${id}`);
  if (tab) await page.getByRole("tab", { name: tab }).click();
}
