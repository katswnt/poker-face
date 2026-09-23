import { expect, test, type Page } from "@playwright/test";

const comparison = (page: Page) => page.getByRole("region", { name: "Change one thing", exact: true });
async function pin(page: Page) {
  await page.goto("/solver/river");
  await page.getByRole("link", { name: "Change one thing ↓" }).click();
  await page.getByRole("button", { name: "Pin this decision", exact: true }).click();
}
async function solveChange(page: Page, value = "AA AQs 76s:25%") {
  await page.getByLabel("Changed opponent range", { exact: true }).fill(value);
  await page.getByRole("button", { name: "Check comparison size", exact: true }).click();
  await expect(page.getByRole("button", { name: "Solve changed game", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Solve changed game", exact: true }).click();
  await expect(page.getByRole("status", { name: "Comparison status" })).toContainText("Comparison complete");
}

test("pins a decision, runs the production comparison worker, and keeps saved results separate from drafts", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await pin(page);
  await page.getByLabel("Starting pot", { exact: true }).fill("120");
  await expect(comparison(page)).toContainText("pot 100 chips");
  const worker = page.waitForEvent("worker");
  await solveChange(page); await worker;
  const result = page.getByRole("region", { name: "Saved comparison", exact: true });
  await expect(result).toContainText("AA AQs 76s:25%");
  await expect(result).toContainText("Exploitability:");
  await expect(result).toContainText("percentage points");
  await expect(result.getByText(/not a guaranteed equilibrium gain/)).toBeVisible();
  await expect(comparison(page).locator('[tabindex="-1"]').last()).toBeFocused();
  await page.getByLabel("Changed opponent range", { exact: true }).fill("AA AQs");
  await expect(page.getByRole("button", { name: "Solve changed game", exact: true })).toBeDisabled();
  await expect(result).toContainText("AA AQs 76s:25%");
  await page.getByLabel("Who is acting?").selectOption("0");
  await expect(page.getByLabel("Who is acting?")).toBeEnabled();
  await expect(comparison(page)).toContainText("Second player · Jh Jd");
  await result.getByText("What can we conclude about the whole game?", { exact: true }).click();
  await expect(result.getByText(/not statistical confidence intervals/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("validation is associated with the changed field, focuses it, and recovers without changing the pin", async ({ page }) => {
  await pin(page);
  await page.getByRole("button", { name: "Check comparison size", exact: true }).click();
  const field = page.getByLabel("Changed opponent range", { exact: true });
  await expect(comparison(page).getByRole("alert")).toContainText("Change the selected assumption");
  await expect(field).toBeFocused(); await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/Change the selected assumption/);
  await field.fill("AA+");
  await page.getByRole("button", { name: "Check comparison size", exact: true }).click();
  await expect(comparison(page).getByRole("alert")).toContainText("Unsupported range");
  await solveChange(page);
  await expect(comparison(page).getByRole("alert")).toHaveCount(0);
});

test("a deleted decision stays unavailable rather than silently falling back to another history", async ({ page }) => {
  await pin(page);
  await page.getByLabel("What changes?", { exact: true }).selectOption("bets");
  await page.getByLabel("Changed opening bet sizes", { exact: true }).fill("100 200");
  await page.getByRole("button", { name: "Check comparison size", exact: true }).click();
  await expect(comparison(page).getByText(/pinned decision does not exist/)).toBeVisible();
  await page.getByRole("button", { name: "Solve changed game", exact: true }).click();
  await expect(page.getByRole("status", { name: "Comparison status" })).toContainText("Comparison complete");
  await expect(comparison(page).getByText(/No matching decision:/)).toBeVisible();
  await expect(comparison(page).getByRole("region", { name: /^Comparison:/ })).toHaveCount(0);
  await expect(comparison(page).getByText("What can we conclude about the whole game?", { exact: true })).toBeVisible();
});

test("real progress can be cancelled with the keyboard; the previous completed comparison survives", async ({ page }) => {
  await pin(page); await solveChange(page);
  await page.getByLabel("Changed opponent range", { exact: true }).fill("AA QQ JJ TT AQs AJs ATs KQs KJs QJs 76s");
  await page.getByRole("button", { name: "Check comparison size", exact: true }).click();
  await expect(page.getByRole("button", { name: "Solve changed game", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Solve changed game", exact: true }).click();
  await expect.poll(async () => Number(await page.getByRole("progressbar", { name: "Comparison completed iterations" }).getAttribute("value"))).toBeGreaterThan(0);
  await expect(page.getByLabel("Five board cards")).toBeDisabled();
  await expect(page.getByLabel("Who is acting?")).toBeDisabled();
  await page.getByRole("button", { name: "Cancel comparison", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status", { name: "Comparison status" })).toContainText("Comparison cancelled after");
  await expect(page.getByRole("region", { name: "Saved comparison", exact: true })).toContainText("AA AQs 76s:25%");
  await expect(page.getByLabel("Five board cards")).toBeEnabled();
  await solveChange(page, "AA AQs 76s:50%");
});

test("comparison controls support native keyboard navigation and stack changes", async ({ page }) => {
  await page.goto("/solver/river");
  await page.getByRole("link", { name: "Change one thing ↓" }).focus();
  await page.keyboard.press("Enter"); await expect(comparison(page)).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Pin this decision", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab"); await expect(page.getByText("Pinned game settings", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByLabel("What changes?", { exact: true })).toBeFocused();
  // Native select type-ahead works on macOS and Linux; End/arrow handling differs.
  await page.keyboard.type("Opponent stack"); await page.keyboard.press("Tab");
  const field = page.getByLabel("Changed opponent stack", { exact: true });
  await expect(field).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("50");
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Check comparison size", exact: true })).toBeFocused();
  const outline = await page.locator(":focus").evaluate(element => getComputedStyle(element).outlineWidth);
  expect(parseFloat(outline)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Solve changed game", exact: true })).toBeEnabled();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Solve changed game", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status", { name: "Comparison status" })).toContainText("Comparison complete");
  await expect(page.getByRole("region", { name: "Saved comparison", exact: true })).toContainText("Opponent stack: 200");
  await expect(page.getByRole("region", { name: "Saved comparison", exact: true })).toContainText("Not legal here");
  for (const control of await comparison(page).locator("input, select, button").all()) await expect(control).toHaveAccessibleName(/.+/);
});

test("oversized pairs are refused even when the pinned game fits by itself", async ({ page }) => {
  await page.goto("/solver/river");
  const wide = "AA QQ JJ TT AQs AJs ATs KQs KJs QJs 76s";
  await page.getByLabel("First player's range", { exact: true }).fill(wide);
  await page.getByLabel("Second player's range", { exact: true }).fill(wide);
  await page.getByLabel("Opening bet sizes", { exact: true }).fill("50 100");
  await page.getByLabel("Raise-to amounts", { exact: true }).fill("100 200");
  await page.getByLabel("Raises after the opening bet").selectOption("1");
  await page.getByLabel("Solver iterations").fill("21");
  await page.getByRole("button", { name: "Check game size", exact: true }).click();
  await expect(page.getByRole("button", { name: "Solve in browser", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Solve in browser", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Custom solve complete");
  await page.getByRole("button", { name: "Pin this decision", exact: true }).click();
  await page.getByLabel("Changed opponent range", { exact: true }).fill(wide.replace("76s", "76s:50%"));
  await page.getByRole("button", { name: "Check comparison size", exact: true }).click();
  await expect(comparison(page).getByText("135,698", { exact: true })).toBeVisible();
  await expect(comparison(page).getByText(/Too large for a browser comparison/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Solve changed game", exact: true })).toBeDisabled();
});

test("stale worker events are ignored and worker failure preserves completed data and allows recovery", async ({ page }) => {
  await page.addInitScript(() => {
    const ActualWorker = window.Worker;
    window.Worker = class extends ActualWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as unknown as { comparisonTestWorker: Worker }).comparisonTestWorker = this;
      }
    };
  });
  await pin(page); await solveChange(page);
  await page.getByLabel("Changed opponent range", { exact: true }).fill("AA AQs 76s:50%");
  await page.getByRole("button", { name: "Check comparison size", exact: true }).click();
  await expect(page.getByRole("button", { name: "Solve changed game", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const worker = (window as unknown as { comparisonTestWorker: Worker }).comparisonTestWorker;
    worker.dispatchEvent(new MessageEvent("message", { data: { type: "error", id: 1, message: "Stale error" } }));
  });
  await expect(comparison(page).getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { comparisonTestWorker: Worker }).comparisonTestWorker.dispatchEvent(new Event("error")));
  await expect(comparison(page).getByRole("alert")).toContainText("worker stopped");
  await expect(page.getByRole("region", { name: "Saved comparison", exact: true })).toContainText("AA AQs 76s:25%");
  await expect(page.getByLabel("Changed opponent range", { exact: true })).toBeFocused();
  await solveChange(page, "AA AQs 76s:50%");
});

test("off-path comparisons withhold differences, and rare decisions carry a separate warning", async ({ page }) => {
  await page.goto("/solver/river");
  await page.getByLabel("Your private hand").selectOption("Ac Tc");
  await page.getByLabel("Actions before this decision").selectOption({ label: "First: check → Second: bet 50 → First: raise to 100 (off path)" });
  await expect(page.getByRole("button", { name: "Pin this decision", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Pin this decision", exact: true }).click();
  await solveChange(page);
  const saved = page.getByRole("region", { name: "Saved comparison", exact: true });
  await expect(saved.getByText(/Off path in at least one strategy/)).toBeVisible();
  await expect(saved).toContainText("Not comparable");
  await expect(saved.getByText(/Rare decision:/)).toBeVisible();
  await expect(saved).not.toContainText("Change in value: +");
});

for (const width of [320, 390, 1280]) {
  test(`comparison visual and overflow checks at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await pin(page); await solveChange(page);
    await page.locator("#comparison-heading").evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath(`comparison-setup-${width}.png`) });
    const results = page.getByRole("region", { name: "Saved comparison", exact: true });
    await page.locator("#comparison-result-heading").evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath(`comparison-result-${width}.png`) });
    await results.getByRole("region", { name: "Comparison: Fold", exact: true }).evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath(`comparison-actions-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width === 1280) {
      await page.addStyleTag({ content: "html { font-size: 200%; }" });
      await results.getByRole("region", { name: "Comparison: Fold", exact: true }).evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("comparison-text-200-percent.png") });
    }
  });
}
