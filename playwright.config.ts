import { defineConfig } from "@playwright/test";

// One shared browser/profile at a time, no retries: a flaky test must be visible, not hidden.
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
});
