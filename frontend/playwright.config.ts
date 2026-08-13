import { defineConfig, devices } from "@playwright/test";

// Points at the actual running docker-compose stack (see docs/TODO.md's
// Playwright E2E entry) rather than spinning up a separate isolated
// environment — same VITE_GRAPHQL_URL-sibling env-var pattern used
// elsewhere in this repo (apolloClient.ts), so a real deployment can point
// this at its own domain instead of localhost. Defaults assume the stack
// is already up on this host (`docker compose up`), per CLAUDE.md.
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // This host is small (4 CPU/4GB, already running the whole docker-compose
  // stack) — several concurrent headless Chromium instances reliably crash
  // each other here. One worker at a time is slower but reliable; matches
  // this suite's own "slower/flakier than unit tests by nature" framing.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    // This host has no network access for Playwright's own ~300MB browser
    // download, but a matching apt-installed Chromium already exists (see
    // docs/TODO.md's "Convert frontend to TypeScript" verification note) —
    // point Playwright at it instead of `npx playwright install`.
    // --no-sandbox is required since this runs as root here.
    launchOptions: {
      executablePath: process.env.E2E_CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  // Every flow in this suite is required to work on a phone (see CLAUDE.md's
  // mobile-usability hard requirement) — running the whole suite under both
  // a desktop and a real mobile-device emulation profile, rather than one
  // token mobile test, is how that gets actual coverage.
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    // devices["iPhone 13"] defaults to WebKit (real iPhone Safari's engine),
    // which this host doesn't have installed — only Chromium (see the
    // launchOptions comment above). Pixel 5 is a Chromium-based mobile
    // profile (matches this deployment's own real-world usage too, per
    // docs/TODO.md's Android-PWA-focused pinch-zoom fixes) so it launches
    // with the same system Chromium binary as the desktop project.
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
});
