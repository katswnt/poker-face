import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import saved from "../src/lib/solver/bridge/live/example.json";

const prepared = process.env.POKER_FACE_LIVE_REQUIRED === "1";
test("all solver navigation entries load the live page as a new document", async ({ page }) => {
  for (const route of ["/solver", "/solver/lab", "/solver/river", "/solver/postflop", "/solver/flop"]) {
    await page.goto(route);
    const link = page.getByRole("navigation").getByRole("link", { name: "Live turn & river solver", exact: true });
    await expect(link).toHaveAttribute("href", "/solver/live");
    const navigation = page.waitForRequest(request => request.isNavigationRequest() && request.resourceType() === "document" && new URL(request.url()).pathname === "/solver/live");
    await link.click(); await navigation;
    await expect(page.getByRole("heading", { name: "Live Turn & River Solver", exact: true })).toBeVisible();
  }
});

test("memory copy distinguishes solver admission from total browser memory", async ({ page }) => {
  await page.goto("/solver/live");
  await page.getByText("Browser limits and offline option", { exact: true }).click();
  await expect(page.getByText(/not a cap on total browser memory/)).toBeVisible();
});

test("real 200% browser zoom preserves reflow and keyboard controls", async ({ browserName, baseURL }, testInfo) => {
  test.skip(browserName !== "chromium", "Browser zoom API is checked in Chromium; all engines also run text-resize checks");
  // Real browser zoom, not CSS zoom, font scaling, pinch zoom or a deviceScaleFactor override.
  // The test-only extension runs in a fresh temporary profile, never a user's browser.
  const extension = resolve("e2e/fixtures/browser-zoom");
  const context = await chromium.launchPersistentContext("", { channel: "chromium", viewport: null, deviceScaleFactor: undefined,
    args: ["--window-size=1280,900", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = context.pages()[0]; await page.goto(`${baseURL}/solver/live`);
    const before = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }));
    expect(before.width).toBe(1280);
    const zoom = await worker.evaluate(async () => {
      const { tabs } = (globalThis as unknown as { chrome: { tabs: {
        query(options: { active: boolean; currentWindow: boolean }): Promise<{ id: number }[]>;
        setZoomSettings(id: number, settings: { mode: "automatic"; scope: "per-tab" }): Promise<void>;
        setZoom(id: number, factor: number): Promise<void>; getZoom(id: number): Promise<number>;
      } } }).chrome;
      const [tab] = await tabs.query({ active: true, currentWindow: true });
      await tabs.setZoomSettings(tab.id, { mode: "automatic", scope: "per-tab" });
      await tabs.setZoom(tab.id, 2); return tabs.getZoom(tab.id);
    });
    expect(zoom).toBe(2);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(before.width / 2);
    expect(await page.evaluate(() => devicePixelRatio)).toBe(before.dpr * 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await testInfo.attach("browser-zoom-measurement.json", { body: JSON.stringify({ zoom, before,
      after: await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, height: innerHeight })) }), contentType: "application/json" });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to completed result" })).toBeFocused();
    await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
    await expect(page.getByLabel("First player’s hand at the opening decision")).toBeFocused();
    // Capture the browser surface directly. Playwright's layout-CSS-pixel clipping
    // otherwise cuts off a zoomed page (or captures below it after an anchor scroll).
    const cdp = await context.newCDPSession(page);
    const capture = async (name: string) => {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(testInfo.outputPath(name), Buffer.from(data, "base64"));
    };
    await capture("live-browser-zoom-200.png");
    await page.getByRole("link", { name: "Set up a game ↓" }).click();
    await capture("live-browser-zoom-200-setup.png");
  } finally { await context.close(); }
});

test("saved example is immediate, source-labeled and has route-specific metadata", async ({ page }) => {
  let workers = 0; page.on("worker", () => workers++);
  await page.goto("/solver/live");
  await expect(page.getByRole("heading", { name: "Live Turn & River Solver", exact: true })).toBeVisible();
  await expect(page.getByText("Saved, independently checked example", { exact: true })).toBeVisible();
  await expect(page.getByText("0.009715 chips", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Frequency" })).toBeVisible();
  await page.getByLabel("First player’s hand at the opening decision").selectOption("1");
  expect(workers).toBe(0);
  await expect(page).toHaveTitle("Live Turn & River Solver | Poker Face");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pokerface.katswint.com/solver/live");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://pokerface.katswint.com/solver/live");
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", "Live Turn & River Solver | Poker Face");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\//);
  expect(await page.locator("title").count()).toBe(1);
  if (process.env.POKER_FACE_LIVE_SAVED_ONLY === "1") await expect(page.getByRole("button", { name: "Check game size" })).toBeDisabled();
  if (!prepared && await page.getByRole("button", { name: "Check game size" }).isDisabled()) {
    await expect(page.getByText(/Live solver assets are not installed/)).toBeVisible();
  }
});

test("keyboard and native semantics work without horizontal overflow", async ({ page, browserName }) => {
  // macOS WebKit's default Tab navigation skips links; Option–Tab visits every control.
  // Exercise the native full-keyboard sequence, without changing the page's tab order.
  const nextControl = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
  await page.goto("/solver/live"); await page.keyboard.press(nextControl);
  await expect(page.getByRole("link", { name: "Skip to completed result" })).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page.locator("#live-result")).toBeFocused(); await page.keyboard.press(nextControl);
  await expect(page.getByLabel("First player’s hand at the opening decision")).toBeFocused();
  expect(parseFloat(await page.locator(":focus").evaluate(e => getComputedStyle(e).outlineWidth))).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press(nextControl);
  await expect(page.getByText("Game identity, ranges and source", { exact: true })).toBeFocused(); await page.keyboard.press("Space");
  await expect(page.getByText("Spot SHA-256", { exact: true })).toBeVisible();
  for (const control of await page.locator("input, select, textarea, button").all()) await expect(control).toHaveAccessibleName(/.+/);
  expect(await page.locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').count()).toBe(0);
});

for (const width of [320, 390, 1280]) test(`live page responsive visual check ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto("/solver/live");
  await page.getByRole("link", { name: "Explore the saved result ↓" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`live-result-${width}.png`) });
  await page.getByRole("link", { name: "Set up a game ↓" }).click();
  await page.screenshot({ path: testInfo.outputPath(`live-setup-${width}.png`) });
  if (width === 1280) {
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("live-text-200.png"), fullPage: true });
  }
});

test.describe("prepared production WASM UI", () => {
  test.skip(!prepared, "Set POKER_FACE_LIVE_REQUIRED=1 after prepare:wasm:live to run real WASM UI gates");
  test("validates, preflights, invalidates edits and solves through the Next Worker", async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto("/solver/live"); await page.getByLabel("Board cards", { exact: true }).fill("As As 3c 4d");
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByLabel("Board cards", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Board cards", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Fill small river" }).click();
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByRole("button", { name: "Solve checked game" })).toBeEnabled();
    await page.getByLabel("Maximum learning iterations").fill("23");
    await expect(page.getByRole("button", { name: "Solve checked game" })).toHaveCount(0);
    await page.getByRole("button", { name: "Check game size" }).click(); await page.getByRole("button", { name: "Solve checked game" }).click();
    await expect(page.getByText("Completed browser solve · engine-reported quality", { exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/Solve complete|Iteration limit reached/);
    await page.getByText("Game identity, ranges and source", { exact: true }).click();
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Download full strategy" }).click();
    expect((await download).suggestedFilename()).toBe("poker-face-strategy.json");
    const source = page.getByRole("link", { name: "Download corresponding solver source and licenses" });
    expect((await page.request.get((await source.getAttribute("href"))!)).status()).toBe(200);
    const licenses = page.getByRole("link", { name: "Dependency licenses" });
    expect(await (await page.request.get((await licenses.getAttribute("href"))!)).text()).toContain("AGPL");
    expect(errors).toEqual([]);
  });

  test("oversized export and malformed imported games never replace the saved result", async ({ page }) => {
    await page.goto("/solver/live"); await page.getByLabel("Effective stack per player (chips)").fill("1000");
    await page.getByLabel("Opening sizes (% of pot)").fill("25 100");
    await page.getByLabel("Raises after an opening bet, per street").selectOption("1");
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByRole("status")).toContainText("Too large");
    await expect(page.getByRole("button", { name: "Solve checked game" })).toBeDisabled();
    await expect(page.getByText("Saved, independently checked example", { exact: true })).toBeVisible();
    await page.getByLabel("Input style").selectOption("json"); await page.getByLabel("Spot v1 JSON").fill("{}");
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByLabel("Spot v1 JSON")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Spot v1 JSON")).toBeFocused();
  });

  test("real progress is cancellable by keyboard and a fresh solve works afterward", async ({ page }) => {
    await page.goto("/solver/live");
    const base = saved.spot;
    const spot = { ...base, solve: { ...base.solve, maxIterations: 10000, targetExploitabilityPctPot: 1e-12 } };
    await page.getByLabel("Input style").selectOption("json"); await page.getByLabel("Spot v1 JSON").fill(JSON.stringify(spot));
    await page.getByRole("button", { name: "Check game size" }).click(); await page.getByRole("button", { name: "Solve checked game" }).click();
    await expect(page.getByRole("status")).toContainText("Solving in the background");
    await page.getByRole("button", { name: "Cancel background task" }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Cancelled.");
    await expect(page.getByRole("region", { name: "2. Check, then solve" })).toBeFocused();
    await expect(page.getByText("Saved, independently checked example", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Fill small river" }).click(); await page.getByRole("button", { name: "Check game size" }).click();
    await page.getByRole("button", { name: "Solve checked game" }).click();
    await expect(page.getByText("Completed browser solve · engine-reported quality", { exact: true })).toBeVisible();
  });

  test("missing binary gives a recoverable error, with no main-thread fallback", async ({ page, context }) => {
    await context.route("**/solver_bridge_wasm_bg.wasm", r => r.fulfill({ status: 404, body: "missing" }));
    await page.goto("/solver/live"); await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("WASM asset unavailable");
    await expect(page.getByText("Saved, independently checked example", { exact: true })).toBeVisible();
    await context.unroute("**/solver_bridge_wasm_bg.wasm"); await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByRole("button", { name: "Solve checked game" })).toBeEnabled();
  });
});
