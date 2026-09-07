import { defineConfig, devices } from "@playwright/test";

// The app's own dev server (vite, package.json's own "dev" script) rather than a production preview build: e2e here exists to prove the routed UI genuinely renders and navigates, not to catch a build-only regression -- the _build/typecheck/lint tasks already gate that separately, and reusing the dev server keeps a local `pnpm test:e2e` run fast and dependency-free (no prior build step to remember). reuseExistingServer stays off in CI so a stale server from a previous job can never mask a real startup failure, matching every other CI task's own from-scratch invariant.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  // A dev server compiles each route's module graph on demand rather than serving a pre-built bundle, so the first navigation to a route pays a real transform cost a production preview wouldn't -- the default 5s assertion timeout is tuned for the latter. Generous rather than tight, since retrying a slow-but-correct assertion is free and a too-tight timeout here reads as a flaky test rather than what it actually is: dev-server cold-start latency.
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
