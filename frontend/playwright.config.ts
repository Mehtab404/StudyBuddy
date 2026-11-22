import { defineConfig, devices } from "@playwright/test";

// Browser tests. They start two servers of their own, on ports the normal dev setup does not use:
//   - the backend with a fake database and fake AI (backend/e2e_server.py), on 8100
//   - the production build of the frontend pointed at it, on 3100
// Nothing in them touches MongoDB or Groq.
//
// Run:  npm run test:e2e      (the first run builds the frontend, so it takes a minute longer)
//
// Locally the tests can use the Chrome that is already installed: set E2E_BROWSER_CHANNEL=chrome (or msedge).
// Without it, Playwright's own Chromium is used, which `npx playwright install chromium` downloads. CI does that.

const API = "http://127.0.0.1:8100";
const SITE = "http://localhost:3100";
const CI = Boolean(process.env.CI);

// The Python that has the backend's packages. The backend's own venv on Windows, whatever `python` is elsewhere.
const python = process.env.E2E_PYTHON ?? (process.platform === "win32" ? ".venv\\Scripts\\python.exe" : "python");

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The fake backend answers one request at a time, and every test makes its own users, so tests could run side by side.
  // One at a time keeps failures easy to read.
  workers: 1,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: SITE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL || undefined },
    },
  ],
  webServer: [
    {
      command: `${python} e2e_server.py 8100`,
      cwd: "../backend",
      url: `${API}/health`,
      timeout: 60_000,
      reuseExistingServer: !CI,
    },
    {
      // NEXT_PUBLIC_API_URL is read when the site is built, so it is set for the build and not just the server
      command: "npm run build && npm run start -- --port 3100",
      env: { NEXT_PUBLIC_API_URL: API },
      url: SITE,
      timeout: 300_000,
      reuseExistingServer: !CI,
    },
  ],
});
