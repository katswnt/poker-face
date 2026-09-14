import { expect, test } from "@playwright/test";

test.describe("explainable solver lab", () => {
  test("teaches one audited idea at a time and works from the keyboard", async ({ page }) => {
    await page.goto("/solver/lab");

    await expect(page.getByRole("heading", {
      level: 1,
      name: "Why can two poker choices both make sense?",
    })).toBeVisible();
    await expect(page.getByRole("button", { name: /Mixing/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Why not always bet the queen?" })).toBeVisible();

    const valueLesson = page.getByRole("button", { name: /Value bet/ });
    await valueLesson.focus();
    await page.keyboard.press("Enter");
    await expect(valueLesson).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", {
      name: "Why bet when you already have the best possible hand?",
    })).toBeVisible();

    const checkAction = page.getByRole("button", { name: /^Check/ });
    await checkAction.focus();
    await page.keyboard.press("Space");
    await expect(checkAction).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("After choosing Check")).toBeVisible();

    await page.getByRole("button", { name: /Bluff-catching/ }).click();
    await expect(page.getByText("2 ÷ 8 = 25.0%")).toBeVisible();
    await expect(page.getByText("24.9%", { exact: true })).toBeVisible();
    await expect(page.getByText(/boundary, not a command/)).toBeVisible();

    const pageWidth = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport);
  });

  test("keeps the complete lesson readable on a narrow phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/solver/lab");
    await page.getByRole("button", { name: /Bluff-catching/ }).click();

    await expect(page.getByRole("heading", { name: "Does the hand win often enough for this price?" }))
      .toBeVisible();
    await expect(page.getByRole("heading", { name: "Actions change the range" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How the hand ends" })).toBeVisible();

    const pageWidth = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport);
  });
});
