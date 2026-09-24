import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import initial from "../src/lib/solver/postflop/flop-library/artifacts/initial.json";

const result = (page: Page) => page.getByRole("region", { name: "Saved decision", exact: true });
const heading = (page: Page) => page.locator("#flop-decision");
async function follow(page: Page, action: string) {
  await result(page).getByRole("button", { name: new RegExp(`^${action} `) }).click();
  await page.getByRole("button", { name: `Follow ${action}`, exact: true }).click();
  await expect(heading(page)).toBeFocused();
}
async function nextCard(page: Page) { await follow(page, "Check"); await follow(page, "Check"); }
async function riverCard(page: Page) {
  await nextCard(page); await page.getByRole("button", { name: "Reveal 2c", exact: true }).click();
  await expect(heading(page)).toHaveText("Turn · First player to act"); await nextCard(page);
}

test("flop library opens instantly, loads exact streets, and evaluates river facts in a real worker", async ({ page }) => {
  const workers: string[] = [], chunks: string[] = [], errors: string[] = [];
  page.on("worker", w => workers.push(w.url())); page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (r.url().includes("/solver-data/flop-v1/")) chunks.push(r.url()); });
  await page.goto("/solver/flop");
  await expect(page).toHaveTitle("Flop to River Explorer | Poker Face");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pokerface.katswint.com/solver/flop");
  await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  expect(chunks).toEqual([]); expect(workers).toEqual([]);
  await expect(result(page)).toContainText("Share if betting stopped");
  await page.getByText("How their possible hands change", { exact: true }).click();
  await page.getByLabel("Opponent range after a response").selectOption("0");
  await expect(page.getByRole("table", { name: /Opponent’s exact hands/ })).toContainText("After Check");
  await riverCard(page); expect(chunks).toHaveLength(1); expect(workers).toEqual([]);
  await page.getByRole("button", { name: /^Reveal / }).click();
  await expect(heading(page)).toHaveText("River · First player to act");
  await expect(result(page)).toContainText("in a worker"); expect(workers).toHaveLength(1); expect(chunks).toHaveLength(2);
  await follow(page, "Bet 25"); await follow(page, "Call 25");
  await expect(result(page).getByRole("heading", { name: "Showdown", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click(); await expect(heading(page)).toHaveText("River · Second player to act");
  await page.getByRole("button", { name: "Start over" }).click(); await expect(heading(page)).toHaveText("Flop · First player to act");
  expect(errors).toEqual([]);
});

test("all six scenarios, texture filters, range groups, exact combinations and downloadable inputs", async ({ page }) => {
  await page.goto("/solver/flop");
  const menu = page.getByRole("combobox", { name: "Saved scenario", exact: true }); await expect(menu.locator("option")).toHaveCount(6);
  const ids = await menu.locator("option").evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
  expect(ids).toHaveLength(6);
  for (const id of ids) {
    await menu.selectOption(id); await page.getByRole("button", { name: "Open scenario" }).click(); await expect(heading(page)).toBeFocused();
    await expect(page.getByRole("link", { name: "Download this game’s inputs" })).toHaveAttribute("href", new RegExp(`/${id}/`));
  }
  await expect(result(page)).toContainText("Value from now");
  await expect(page.getByLabel("Exact hand to inspect").locator("option")).toHaveCount(64);
  await page.getByText("Explore the ranges: hand groups and exact cards", { exact: true }).click();
  const table = page.getByRole("table", { name: "First player: exact cards and current range share" });
  await expect(table.getByRole("row")).toHaveCount(65);
  await table.getByRole("button", { name: /^Inspect / }).last().click();
  await expect(page.getByLabel("Exact hand to inspect")).toHaveValue("63");
  await page.getByLabel("Position to inspect").selectOption("1");
  await expect(page.getByRole("table", { name: "Second player: exact cards and current range share" }).getByRole("row")).toHaveCount(65);
  const group = page.locator('details button[aria-pressed]').first(); await group.click(); await expect(group).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Board texture").selectOption("Monotone"); await expect(menu.locator("option")).toHaveCount(1);
  await page.getByRole("button", { name: "Open scenario" }).click(); await expect(page.getByRole("heading", { name: "Currently open: Three hearts on the flop" })).toBeVisible();
});

test("native keyboard controls preserve focus and expose names", async ({ page }) => {
  await page.goto("/solver/flop"); await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the decision" })).toBeFocused(); await page.keyboard.press("Enter");
  await expect(heading(page)).toBeFocused(); await page.keyboard.press("Tab"); await expect(page.getByLabel("Exact hand to inspect")).toBeFocused();
  expect(await page.locator(":focus").evaluate(e => parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Tab"); await page.keyboard.press("Space");
  await expect(result(page).getByRole("button", { name: /^Check / })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Follow Check", exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(heading(page)).toHaveText("Flop · Second player to act"); await expect(heading(page)).toBeFocused();
  for (const control of await page.locator("button:visible, select:visible, a:visible").all()) await expect(control).toHaveAccessibleName(/.+/);
});

test("cancelled, failed and corrupted loads preserve the checked decision and allow retry", async ({ page }) => {
  await page.goto("/solver/flop"); await nextCard(page);
  let release: (() => void) | undefined;
  await page.route("**/solver-data/flop-v1/**", async route => { await new Promise<void>(r => { release = r; }); await route.continue().catch(() => {}); });
  await page.getByRole("button", { name: /^Reveal / }).click(); await expect(result(page).getByRole("status")).toContainText("Loading");
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); release?.(); await expect(heading(page)).toBeFocused();
  await expect(heading(page)).toHaveText("Flop · Next card"); await page.unroute("**/solver-data/flop-v1/**");
  await page.route("**/solver-data/flop-v1/**", r => r.fulfill({ status: 503, body: "offline" }));
  await page.getByRole("button", { name: /^Reveal / }).click(); await expect(result(page).getByRole("alert")).toContainText("Could not load");
  await expect(result(page).getByRole("alert").locator("..")).toBeFocused();
  await page.unroute("**/solver-data/flop-v1/**");
  await page.route("**/solver-data/flop-v1/**", async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()).replace('"version":1', '"version":9') }); });
  await page.getByRole("button", { name: "Retry", exact: true }).click(); await expect(result(page).getByRole("alert")).toContainText("integrity check");
  await expect(heading(page)).toHaveText("Flop · Next card");
  await page.unroute("**/solver-data/flop-v1/**"); await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(heading(page)).toHaveText("Turn · First player to act");
});

test("share links restore exact hand and public history, back works, invalid versions fail visibly", async ({ page }) => {
  await page.goto("/solver/flop"); await riverCard(page); await page.getByRole("button", { name: /^Reveal / }).click();
  await expect(heading(page)).toHaveText("River · First player to act"); await page.getByLabel("Exact hand to inspect").selectOption("1");
  const link = await page.getByRole("link", { name: "Link to this exact decision and hand" }).getAttribute("href");
  await page.goto(`/solver/flop${link}`); await expect(heading(page)).toHaveText("River · First player to act"); await expect(page.getByLabel("Exact hand to inspect")).toHaveValue("1");
  await follow(page, "Check"); await page.goBack(); await expect(heading(page)).toHaveText("River · First player to act");
  await page.goto(`/solver/flop${link!.replace("v=1", "v=99")}`); await expect(result(page).getByRole("alert")).toContainText("Invalid saved-decision link");
  await page.getByRole("button", { name: "Start over" }).click(); await expect(heading(page)).toHaveText("Flop · First player to act");
});

test("initial checked facts stay readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false }), page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/solver/flop"); await expect(heading(page)).toHaveText("Flop · First player to act");
  await expect(result(page)).toContainText("Value from now"); await context.close();
});

test("real saved rare and zero-reach hands get distinct warnings, not invented values", async ({ page }) => {
  for (const hand of [0, 1]) {
    await page.goto(`/solver/flop#v=1&game=${initial.scenario.id}&source=${initial.scenario.sourceHash}&node=1&hand=${hand}`);
    await expect(heading(page)).toHaveText("Flop · Second player to act");
    if (hand === 0) { await expect(result(page)).toContainText("Rare decision."); await expect(result(page)).not.toContainText("Value from now: Not available"); }
    else { await expect(result(page)).toContainText("Off path:"); await expect(result(page)).toContainText("Value from now: Not available"); }
  }
});

test("worker cancellation and failure never run river evaluation on the main thread", async ({ page }) => {
  await page.addInitScript(() => {
    const Original = Worker, global = window as typeof window & { failRiverWorker: boolean; riverTerminated: number };
    global.failRiverWorker = false; global.riverTerminated = 0;
    window.Worker = class extends Original {
      postMessage() { if (global.failRiverWorker) setTimeout(() => this.dispatchEvent(new ErrorEvent("error")), 0); }
      terminate() { global.riverTerminated++; super.terminate(); }
    };
  });
  await page.goto("/solver/flop"); await riverCard(page); await page.getByRole("button", { name: /^Reveal / }).click();
  await expect(result(page).getByRole("status")).toContainText("Evaluating the saved river");
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(heading(page)).toHaveText("Turn · Next card");
  expect(await page.evaluate(() => (window as typeof window & { riverTerminated: number }).riverTerminated)).toBeGreaterThan(0);
  await page.evaluate(() => { (window as typeof window & { failRiverWorker: boolean }).failRiverWorker = true; });
  await page.getByRole("button", { name: /^Reveal / }).click(); await expect(result(page).getByRole("alert")).toContainText("no main-thread calculation");
  await expect(heading(page)).toHaveText("Turn · Next card");
});

for (const width of [320, 390, 1280]) test(`flop responsive visual, names and internal clipping at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto("/solver/flop");
  for (const name of ["Both exact starting ranges", "Quality and reproducibility", "Explore the ranges: hand groups and exact cards", "How their possible hands change"]) await page.getByText(name, { exact: true }).click();
  const clipped = await page.evaluate(() => ({ document: document.documentElement.scrollWidth > innerWidth + 1,
    elements: Array.from(document.querySelectorAll("main p, main dd, main code, main button, main th, main td")).filter(e => e.getClientRects().length && (e as HTMLElement).clientWidth > 0 && e.scrollWidth > (e as HTMLElement).clientWidth + 2).map(e => e.textContent?.slice(0, 80)) }));
  expect(clipped).toEqual({ document: false, elements: [] });
  await page.screenshot({ path: testInfo.outputPath(`flop-${width}.png`), fullPage: true });
  await page.getByRole("link", { name: "Jump to the current decision" }).click(); await page.screenshot({ path: testInfo.outputPath(`flop-decision-${width}.png`) });
});

test("200% text size and CSS zoom leave the decisions usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto("/solver/flop");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await follow(page, "Bet 25"); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; document.documentElement.style.zoom = "2"; });
  await follow(page, "Call 25"); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("flop-200-percent.png"), fullPage: true });
});

for (const mobile of [false, true]) test(`bounded transfer, parse and lazy river observations on ${mobile ? "mobile" : "desktop"}`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 844 }, isMobile: mobile, deviceScaleFactor: mobile ? 3 : 1, hasTouch: mobile });
  const page = await context.newPage(), scripts: Promise<string>[] = [];
  page.on("response", r => { if (r.request().resourceType() === "script") scripts.push(r.text()); });
  await page.addInitScript(() => {
    const original = JSON.parse, measured = globalThis as typeof globalThis & { flopParses: number[] }; measured.flopParses = [];
    JSON.parse = function (text: string, reviver?: (key: string, value: unknown) => unknown) { const start = performance.now(), value = original(text, reviver);
      if (value?.scenario?.startsWith?.("flop-") && Array.isArray(value.nodes)) measured.flopParses.push(performance.now() - start); return value; };
  });
  const response = await page.goto("http://127.0.0.1:4173/solver/flop"), html = await response!.text();
  await page.getByRole("combobox", { name: "Saved scenario", exact: true }).selectOption("flop-vector-wide-64"); await page.getByRole("button", { name: "Open scenario" }).click(); await expect(heading(page)).toBeFocused();
  await nextCard(page); await page.getByRole("button", { name: /^Reveal / }).click(); await expect(heading(page)).toHaveText("Turn · First player to act");
  await nextCard(page); await page.getByRole("button", { name: /^Reveal / }).click(); await expect(heading(page)).toHaveText("River · First player to act");
  const bodies = await Promise.all(scripts);
  for (const body of [html, ...bodies]) { expect(body).not.toContain("flop-v1:p0:"); expect(body).not.toContain("regretSums"); expect(body).not.toContain("Vector relative weights must"); }
  expect(gzipSync(html).byteLength + bodies.reduce((sum, body) => sum + gzipSync(body).byteLength, 0)).toBeLessThan(5 * 1024 ** 2);
  const observations = await page.evaluate(() => ({ parsesMs: (globalThis as typeof globalThis & { flopParses: number[] }).flopParses,
    chunks: performance.getEntriesByType("resource").filter(r => r.name.includes("/solver-data/flop-v1/")).map(r => ({ decodedBytes: (r as PerformanceResourceTiming).decodedBodySize, encodedBytes: (r as PerformanceResourceTiming).encodedBodySize, durationMs: r.duration })),
    sampledJsHeap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null }));
  expect(observations.chunks).toHaveLength(4); expect(observations.parsesMs).toHaveLength(3);
  for (const chunk of observations.chunks) expect(chunk.decodedBytes).toBeLessThan(1024 ** 2);
  console.info(JSON.stringify({ kind: "saved-flop-browser", mobile, htmlBytes: Buffer.byteLength(html), scriptBytes: bodies.map(b => Buffer.byteLength(b)), ...observations }));
  await testInfo.attach("flop-load-observations", { body: JSON.stringify(observations, null, 2), contentType: "application/json" }); await context.close();
});

test("source-bound links never silently switch to a newer or nearby strategy", async ({ page }) => {
  await page.goto(`/solver/flop#v=1&game=${initial.scenario.id}&source=${"0".repeat(64)}&node=0`);
  await expect(result(page).getByRole("alert")).toContainText("unavailable"); await expect(heading(page)).toHaveText("Flop · First player to act");
});
