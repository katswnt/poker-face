import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// P5's production page gate, without tripling the unrelated app suite.
export default defineConfig({ ...base, testMatch: "play.spec.ts", timeout: 180_000, projects: [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
] });
