import { expect, test, type Page } from "@playwright/test";

const result = (page: Page) => page.getByRole("article", { name: "Saved turn and river result" });
async function follow(page: Page, action: string) {
  await result(page).getByRole("button", { name: new RegExp(`^${action} `) }).click();
  await page.getByRole("button", { name: `Follow ${action}`, exact: true }).click();
}
async function riverChoice(page: Page) { await follow(page, "Check"); await follow(page, "Check"); await expect(page.getByRole("heading", { name: "Choose a river card", exact: true })).toBeVisible(); }

test("saved turn opens instantly, teaches conditional values, and reveals a real checked river chunk", async ({ page }) => {
  const workers: string[] = [], chunks: string[] = [], errors: string[] = [];
  page.on("worker", worker => workers.push(worker.url())); page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/solver-data/")) chunks.push(request.url()); });
  await page.goto("/solver/postflop");
  await expect(page).toHaveTitle("Turn & River Explorer | Poker Face");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pokerface.katswint.com/solver/postflop");
  await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("One card left. What changes?");
  await expect(result(page)).toContainText("Share if betting stopped"); await expect(result(page)).toContainText("Share among later showdowns");
  expect(chunks).toEqual([]); expect(workers).toEqual([]);
  const hands = page.getByLabel("Inspect the acting player’s hand");
  for (const value of await hands.locator("option").evaluateAll(options => options.map(o => (o as HTMLOptionElement).value))) {
    await hands.selectOption(value); await expect(result(page).getByRole("button", { name: /^Bet 25 / })).toBeVisible();
  }
  await riverChoice(page);
  await page.getByText("Compare all possible river cards", { exact: true }).click();
  await expect(page.getByRole("table", { name: "Public river preview, both private hands unknown" }).getByRole("row")).toHaveCount(49);
  await page.getByRole("button", { name: /^Reveal / }).click();
  await expect(page.getByRole("heading", { name: "First player to act", exact: true })).toBeFocused();
  await expect(result(page)).toContainText("River starts"); expect(chunks).toHaveLength(1); expect(workers).toEqual([]);
  await follow(page, "Bet 10"); await expect(page.getByRole("heading", { name: "Second player to act", exact: true })).toBeFocused();
  await expect(result(page).getByRole("button", { name: /^Raise to 50 / })).toBeVisible();
  await follow(page, "Call"); await expect(page.getByRole("heading", { name: "Showdown", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back one step" }).click(); await expect(page.getByRole("heading", { name: "Second player to act", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Return to turn start" }).click(); await expect(page.getByRole("heading", { name: "First player to act", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test("unequal-stack example follows an all-in, refunds excess, and ends only after revealing the river", async ({ page }) => {
  await page.goto("/solver/postflop"); await page.getByLabel("Saved example").selectOption("turn-v2-paired-short");
  await page.getByRole("button", { name: "Open saved example" }).click();
  await expect(page.getByRole("heading", { name: "Loaded: Paired board, shorter stacks" })).toBeVisible();
  await follow(page, "Bet 90"); await expect(result(page).getByRole("button", { name: /^Raise to / })).toHaveCount(0);
  await follow(page, "Call"); await expect(result(page)).toContainText("Uncalled chips returned so far, first / second: 30 / 0");
  await expect(page.getByRole("heading", { name: "Choose a river card", exact: true })).toBeFocused();
  await page.getByRole("button", { name: /^Reveal / }).click();
  await expect(page.getByRole("heading", { name: "Showdown", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Follow / })).toHaveCount(0);
});

test("all controls have names and native keyboard navigation preserves visible focus", async ({ page }) => {
  await page.goto("/solver/postflop");
  await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Skip to the decision" })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.getByRole("heading", { name: "First player to act", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByLabel("Inspect the acting player’s hand")).toBeFocused();
  const outline = await page.locator(":focus").evaluate(e => getComputedStyle(e).outlineWidth); expect(parseFloat(outline)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Tab"); await expect(result(page).getByRole("button", { name: /^Check / })).toBeFocused();
  await page.keyboard.press("Space"); await expect(result(page).getByRole("button", { name: /^Check / })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Follow Check", exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.getByRole("heading", { name: "Second player to act", exact: true })).toBeFocused();
  await page.getByText("Source hashes and reproducibility", { exact: true }).click();
  for (const control of await page.locator("button:visible, select:visible, a:visible").all()) await expect(control).toHaveAccessibleName(/.+/);
  await page.getByLabel("Choose a turn history").selectOption("0");
  await page.getByRole("button", { name: "Open turn history", exact: true }).click();
  await expect(page.getByRole("heading", { name: "First player to act", exact: true })).toBeFocused();
});

test("delayed, cancelled and failed lazy loads keep the valid view and recover through retry", async ({ page }) => {
  await page.goto("/solver/postflop"); await riverChoice(page);
  let release: (() => void) | undefined;
  await page.route("**/solver-data/**", async route => { await new Promise<void>(resolve => { release = resolve; }); await route.continue().catch(() => {}); });
  await page.getByRole("button", { name: /^Reveal / }).click();
  await expect(page.getByRole("status", { name: "Saved result status" })).toContainText("Loading");
  await page.getByRole("button", { name: "Cancel load" }).click(); release?.();
  await expect(page.getByRole("heading", { name: "Choose a river card", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Choose a river card", exact: true })).toBeVisible();
  await page.unroute("**/solver-data/**");
  await page.route("**/solver-data/**", route => route.fulfill({ status: 503, body: "offline" }));
  await page.getByRole("button", { name: /^Reveal / }).click();
  await expect(result(page).getByRole("alert")).toContainText("Could not load");
  await expect(page.locator("#load-status")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Choose a river card", exact: true })).toBeVisible();
  await page.unroute("**/solver-data/**"); await page.getByRole("button", { name: "Retry load" }).click();
  await expect(page.getByRole("heading", { name: "First player to act", exact: true })).toBeFocused();
  await expect(result(page).getByRole("alert")).toHaveCount(0);
});

test("corrupt chunks cannot replace a valid result", async ({ page }) => {
  await page.goto("/solver/postflop"); await riverChoice(page);
  await page.route("**/solver-data/**", async route => {
    const response = await route.fetch(), body = await response.text();
    await route.fulfill({ response, body: body.replace('"version":1', '"version":9') });
  });
  await page.getByRole("button", { name: /^Reveal / }).click();
  await expect(result(page).getByRole("alert")).toContainText("integrity check");
  await expect(page.getByRole("heading", { name: "Choose a river card", exact: true })).toBeVisible();
});

test("real saved rare and off-path decisions carry different warnings and never invent conditional values", async ({ page }) => {
  for (const size of [25, 50]) {
    await page.goto("/solver/postflop"); await follow(page, "Check"); await follow(page, `Bet ${size}`); await follow(page, "Call");
    await page.getByRole("button", { name: "Reveal 2d", exact: true }).click();
    await expect(page.getByRole("heading", { name: "First player to act", exact: true })).toBeFocused();
    await page.getByLabel("Inspect the acting player’s hand").selectOption("0");
    if (size === 25) { await expect(result(page)).toContainText("Rare decision."); await expect(result(page)).not.toContainText("Value from now: Not available"); }
    else { await expect(result(page)).toContainText("This history is off path"); await expect(result(page)).toContainText("Value from now: Not available"); }
  }
});

test("initial saved facts remain readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false }), page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/solver/postflop");
  await expect(page.getByRole("heading", { name: "First player to act", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toContainText("Value from now"); await context.close();
});

for (const width of [320, 390, 1280]) test(`saved turn responsive visual and internal clipping checks at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto("/solver/postflop");
  await page.getByText("Source hashes and reproducibility", { exact: true }).click();
  await page.getByText("Bet sizes, assumptions and quality", { exact: true }).click();
  const overflow = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("main p, main dd, main code, main button, main th, main td"));
    return { document: document.documentElement.scrollWidth > innerWidth + 1,
      clipped: elements.filter(e => e.getClientRects().length && (e as HTMLElement).clientWidth > 0 && e.scrollWidth > (e as HTMLElement).clientWidth + 2).map(e => e.textContent?.slice(0, 80)) };
  });
  expect(overflow).toEqual({ document: false, clipped: [] });
  await page.screenshot({ path: testInfo.outputPath(`turn-${width}.png`), fullPage: true });
  await page.getByRole("link", { name: "Explore the saved decision ↓" }).click();
  await page.screenshot({ path: testInfo.outputPath(`turn-decision-${width}.png`) });
});

test("200% CSS zoom keeps the narrow result usable without clipping", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto("/solver/postflop");
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await page.getByRole("link", { name: "Skip to the decision" }).focus(); await page.keyboard.press("Enter");
  await follow(page, "Bet 50"); await expect(page.getByRole("heading", { name: "Second player to act", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("turn-200-percent.png"), fullPage: true });
});

test("initial page and scripts contain no source policy or numerical engine, and lazy chunks stay bounded", async ({ page }, testInfo) => {
  const scriptBodies: Promise<string>[] = [];
  page.on("response", response => { if (response.request().resourceType() === "script") scriptBodies.push(response.text()); });
  await page.addInitScript(() => {
    const original = JSON.parse;
    const measured = globalThis as typeof globalThis & { explorerParses: number[] };
    measured.explorerParses = [];
    JSON.parse = function (text: string, reviver?: (key: string, value: unknown) => unknown) {
      const start = performance.now(), value = original(text, reviver);
      // React's initial RSC JSON also CONTAINS the embedded slice. Count only a
      // parsed top-level chunk, not the surrounding hydration payload.
      if (value && typeof value.scenario === "string" && value.scenario.startsWith("turn-v2-") && Array.isArray(value.nodes)) measured.explorerParses.push(performance.now() - start);
      return value;
    };
  });
  const response = await page.goto("/solver/postflop");
  const html = await response!.text();
  expect(html).not.toContain("turn-v2:p0:"); expect(html).not.toContain("regretSums");
  await riverChoice(page); await page.getByRole("button", { name: /^Reveal / }).click();
  await expect(page.getByRole("heading", { name: "First player to act", exact: true })).toBeFocused();
  const bodies = await Promise.all(scriptBodies);
  for (const body of bodies) { expect(body).not.toContain("Turn v2 topology exceeded"); expect(body).not.toContain("turn-v2:p0:"); expect(body).not.toContain("Vector relative weights must"); }
  const measurement = await page.evaluate(() => ({
    parsesMs: (globalThis as typeof globalThis & { explorerParses: number[] }).explorerParses,
    chunks: performance.getEntriesByType("resource").filter(r => r.name.includes("/solver-data/")).map(r => ({ decodedBytes: (r as PerformanceResourceTiming).decodedBodySize, durationMs: r.duration })),
  }));
  expect(measurement.chunks).toHaveLength(1); expect(measurement.chunks[0].decodedBytes).toBeLessThan(1024 * 1024);
  expect(measurement.parsesMs).toHaveLength(1);
  const observations = { htmlBytes: Buffer.byteLength(html), scriptBytes: bodies.map(b => Buffer.byteLength(b)), ...measurement };
  console.info(JSON.stringify({ kind: "saved-turn-browser-observations", ...observations }));
  await testInfo.attach("browser-data-observations", { body: JSON.stringify(observations, null, 2), contentType: "application/json" });
});
