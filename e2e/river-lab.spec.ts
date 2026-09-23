import { expect, test } from "@playwright/test";

test.describe("River Solver Lab", () => {
  test("opens the checked-in example immediately and inspects decisions using the production worker", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/solver/river");
    await expect(page.getByRole("heading", { name: "River Solver Lab", exact: true })).toBeVisible();
    await expect(page.getByText("0.009075 chips", { exact: true })).toBeVisible();
    await expect(page.getByText(/not universal or exact GTO/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "What price are you getting?" })).toBeVisible();
    const workerReady = page.waitForEvent("worker");
    await page.getByLabel("Who is acting?").selectOption("0");
    await workerReady;
    await expect(page.getByLabel("Who is acting?")).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Compare your choices" })).toBeVisible();
    await page.getByRole("button", { name: /^Bet 50 / }).click();
    await expect(page.getByRole("heading", { name: "After choosing Bet 50" })).toBeVisible();
    await page.getByLabel("Opponent response after Bet 50").selectOption("fold");
    await expect(page.getByRole("columnheader", { name: "After Fold" })).toBeVisible();
    await page.getByLabel("Opponent response after Bet 50").selectOption("call");
    await expect(page.getByRole("columnheader", { name: "After Call" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("validates fields, solves a small custom game, and invalidates stale preflight", async ({ page }) => {
    await page.goto("/solver/river");
    await page.getByRole("button", { name: "Fill small custom game" }).click();
    await page.getByLabel("Five board cards").fill("As As 4s 2c 9d");
    await page.getByLabel("Starting pot", { exact: true }).fill("101");
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByLabel("Five board cards")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Starting pot", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Some inputs need attention");
    await expect(page.getByLabel("Five board cards")).toBeFocused();
    await expect(page.getByRole("button", { name: "Solve in browser" })).toBeDisabled();
    await page.getByRole("button", { name: "Fill small custom game" }).click();
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByText(/Within the 100,000-state/)).toBeVisible();
    await page.getByLabel("Solver iterations").fill("123");
    await expect(page.getByRole("button", { name: "Solve in browser" })).toBeDisabled();
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByRole("button", { name: "Solve in browser" })).toBeEnabled();
    await page.getByRole("button", { name: "Solve in browser" }).click();
    await expect(page.getByRole("status")).toContainText("Custom solve complete");
    await expect(page.getByText("Your custom result · v3", { exact: true })).toBeVisible();
    await page.getByLabel("Who is acting?").selectOption("1");
    await expect(page.getByLabel("Who is acting?")).toBeEnabled();
    await page.getByRole("button", { name: "View checked-in example" }).click();
    await expect(page.getByText("0.009075 chips", { exact: true })).toBeVisible();
  });

  test("refuses oversized work while showing the exact counts", async ({ page }) => {
    await page.goto("/solver/river");
    const wide = "AA KK QQ JJ TT 88 66 55 AKs AQs AJs ATs KQs KJs QJs";
    await page.getByLabel("Five board cards").fill("2c 3d 4h 7s 9c");
    await page.getByLabel("First player's range", { exact: true }).fill(wide);
    await page.getByLabel("Second player's range", { exact: true }).fill(wide);
    await page.getByLabel("First player's stack", { exact: true }).fill("100");
    await page.getByLabel("Second player's stack", { exact: true }).fill("100");
    await page.getByLabel("Opening bet sizes").fill("50 100");
    await page.getByLabel("Raise-to amounts", { exact: true }).fill("100");
    await page.getByLabel("Raises after the opening bet").selectOption("1");
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByText("106,093", { exact: true })).toBeVisible();
    await expect(page.getByText(/Too large for the browser/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Solve in browser" })).toBeDisabled();
    await expect(page.getByText("Checked-in example · v3")).toBeVisible();
  });

  test("reports completed iterations, stays interactive, cancels, and can run again", async ({ page }) => {
    await page.goto("/solver/river");
    // A bounded but deliberate run gives the test time to observe actual completed work.
    await page.getByLabel("First player's range", { exact: true }).fill("AA QQ JJ TT AQs AJs ATs KQs KJs QJs 76s");
    await page.getByLabel("Second player's range", { exact: true }).fill("AA QQ JJ TT AQs AJs ATs KQs KJs QJs 76s");
    await page.getByLabel("Opening bet sizes").fill("50 100");
    await page.getByLabel("Raise-to amounts", { exact: true }).fill("100 200");
    await page.getByLabel("Raises after the opening bet").selectOption("1");
    await page.getByLabel("Solver iterations").fill("2000");
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByRole("button", { name: "Solve in browser" })).toBeEnabled();
    await page.getByRole("button", { name: "Solve in browser" }).click();
    await expect.poll(async () => Number(await page.getByRole("progressbar", { name: "Completed iterations" }).getAttribute("value"))).toBeGreaterThan(0);
    await expect(page.getByText(/seconds elapsed/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel solve" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Cancelled after");
    await expect(page.getByText("Checked-in example · v3")).toBeVisible();
    await page.getByRole("button", { name: "Fill small custom game" }).click();
    await page.getByRole("button", { name: "Check game size" }).click();
    await expect(page.getByRole("button", { name: "Solve in browser" })).toBeEnabled();
    await page.getByRole("button", { name: "Solve in browser" }).click();
    await expect(page.getByRole("status")).toContainText("Custom solve complete");
  });

  test("native controls and skip link support keyboard-only use with visible focus", async ({ page }) => {
    await page.goto("/solver/river");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to the result" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("article", { name: "River result" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByText("Result settings and reproducibility", { exact: true })).toBeFocused();
    const outline = await page.locator(":focus").evaluate(element => getComputedStyle(element).outlineWidth);
    expect(parseFloat(outline)).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Space");
    await expect(page.getByText(/Rules SHA-256/)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Who is acting?")).toBeFocused();
    // Native select type-ahead works in Chromium on both macOS and Linux.
    await page.keyboard.press("f");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Who is acting?")).toHaveValue("0");
    await expect(page.getByLabel("Your private hand")).toBeFocused();
    await expect(page.getByLabel("Who is acting?")).toBeEnabled();
    const result = page.getByRole("article", { name: "River result" });
    await result.getByRole("button", { name: /^Bet 50 / }).focus();
    await page.keyboard.press("Space");
    await expect(result.getByRole("button", { name: /^Bet 50 / })).toHaveAttribute("aria-pressed", "true");
    await result.getByRole("button", { name: /^Check / }).focus();
    await page.keyboard.press("Space");
    await expect(result.getByRole("button", { name: /^Check / })).toHaveAttribute("aria-pressed", "true");
    const fields = page.locator("input, select");
    for (const field of await fields.all()) await expect(field).toHaveAccessibleName(/.+/);
  });

  for (const width of [320, 390, 1280]) {
    test(`responsive visual check at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/solver/river");
      await page.getByRole("link", { name: "Explore the result ↓" }).click();
      await expect(page.getByRole("heading", { name: "A strategy you can inspect" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`river-${width}.png`), fullPage: true });
      await page.screenshot({ path: testInfo.outputPath(`river-result-${width}.png`) });
      await page.getByRole("heading", { name: "Compare your choices" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`river-actions-${width}.png`) });
      await page.getByRole("heading", { name: "How their possible hands change" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`river-range-${width}.png`) });
      await page.getByRole("link", { name: "Customize a game ↓" }).click();
      await expect(page.getByLabel("Five board cards")).toBeVisible();
      if (width === 1280) {
        await page.addStyleTag({ content: "html { font-size: 200%; }" });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath("river-text-200-percent.png"), fullPage: true });
      }
    });
  }
});
