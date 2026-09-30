import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Separate gate: don't triple the whole existing app suite just to check the live Worker.
export default defineConfig({ ...base, testMatch: "live-solver.spec.ts", projects: [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
] });
