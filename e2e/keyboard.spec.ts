import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("Space activates the focused deal button", async ({ page }) => {
  await page.goto("/");

  const deal = page.getByRole("button", { name: /deal/i });
  await deal.focus();
  await page.keyboard.press("Space");

  await expect(page.getByText("The Board")).toBeVisible();
  await expect(page.getByRole("button", { name: /deal again/i })).toBeHidden();
});

test("Space activates a focused training choice exactly once", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "train", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /deal/i }).click();

  const promptLabel = page.getByText("Your decision", { exact: true });
  for (let step = 0; step < 24 && !(await promptLabel.isVisible()); step++) {
    await page.getByRole("button", { name: "Next →", exact: true }).click();
  }
  await expect(promptLabel).toBeVisible();
  await expect(page.getByRole("button", { name: "decide first", exact: true })).toBeDisabled();

  const prompt = promptLabel.locator("..");
  const choice = prompt.getByRole("button").first();
  const chosenAction = (await choice.textContent())?.trim().toLowerCase();
  await choice.focus();
  await page.keyboard.press("Space");

  await expect(promptLabel).toBeHidden();
  await expect(page.getByText(`You: ${chosenAction}`, { exact: false })).toBeVisible();
  await expect(page.getByText("Session").locator("..")).toContainText(
    /(?:1 match · 0 other · 0 costly|0 match · 1 other · 0 costly|0 match · 0 other · 1 costly)/,
  );
});

test("language choice is saved and poker terms explain themselves", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Help & Language" }).click();

  const plain = page.getByRole("button", { name: "Plain language", exact: true });
  const poker = page.getByRole("button", { name: "Poker terms", exact: true });
  await expect(plain).toHaveAttribute("aria-pressed", "true");
  await poker.click();
  await page.reload();
  await page.getByRole("button", { name: "Help & Language" }).click();
  await expect(poker).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "observe", exact: true }).click();
  await page.getByRole("button", { name: /deal/i }).click();
  await page.getByRole("button", { name: "Next →", exact: true }).click();
  const term = page.locator(".explained-term-button").first();
  await expect(term).toBeVisible();
  const before = await term.textContent();
  await term.hover();
  await expect(term.locator("xpath=following-sibling::*[@role='tooltip']")).toBeVisible();
  await term.click();
  await expect(term).not.toHaveText(before ?? "");
});

test("push-fold explorer uses accessible saved charts and states its limits", async ({ page }) => {
  await page.goto("/solver");
  await expect(page.getByRole("heading", { name: "Push/Fold Strategy Explorer" })).toBeVisible();
  await expect(page.getByText("Stable for this model.")).toBeVisible();
  await expect(page.getByText(/Each non-self hand matchup in that table came from/i)).toBeVisible();
  await expect(page.getByText(/Self-matchups are exactly 50%/i)).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(169);

  const bigBlind = page.getByRole("button", { name: "BB call", exact: true });
  await bigBlind.click();
  await expect(bigBlind).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("slider", { name: "Effective stack in big blinds" }).fill("20");
  await expect(page.getByText("20.0 bb", { exact: true })).toBeVisible();
});

test("a dealt hand fits a phone-sized viewport without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /deal/i }).click();
  await expect(page.getByText("Blinds posted")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("changing table style does not move the mode controls or masthead divider", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /deal/i }).click();

  const masthead = page.locator("header");
  const modeControls = page.getByRole("group", { name: "Training mode" });
  const tableStyle = page.getByRole("group", { name: "Table style" });
  const beforeHeader = await masthead.boundingBox();
  const beforeMode = await modeControls.boundingBox();
  expect(beforeHeader).not.toBeNull();
  expect(beforeMode).not.toBeNull();

  await tableStyle.getByRole("button", { name: "Wild", exact: true }).click();
  await expect(page.getByText("Next hand: Wild. Current: Loose.", { exact: true })).toBeVisible();
  const afterHeader = await masthead.boundingBox();
  const afterMode = await modeControls.boundingBox();
  expect(afterHeader).not.toBeNull();
  expect(afterMode).not.toBeNull();

  expect(Math.abs(afterHeader!.height - beforeHeader!.height)).toBeLessThan(1);
  expect(Math.abs(afterMode!.x - beforeMode!.x)).toBeLessThan(1);
  expect(Math.abs(afterMode!.y - beforeMode!.y)).toBeLessThan(1);
});

test("each route has one accurate title, description, and canonical URL", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Hold'em Trainer");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Practice Texas Hold'em decisions/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pokerface.katswint.com");
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);

  await page.goto("/solver");
  await expect(page).toHaveTitle("Push/Fold Strategy Explorer | Hold'em Trainer");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pokerface.katswint.com/solver");
});
