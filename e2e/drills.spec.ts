import { expect, test, type Page } from "@playwright/test";
// The drills are deterministic in (session seed, mode, level), so the spec replays the same
// pure session the page runs and asserts against its exact questions.
import { initialState } from "../src/lib/drills/scheduler";
import { advance, startSession, submit } from "../src/lib/drills/session";
import type { Question } from "../src/lib/drills/types";

const exact = (q: Question): string => {
  if (q.answer.kind === "choice") return q.answer.value;
  return q.answer.kind === "percent" ? q.answer.value.toFixed(1) : String(q.answer.value);
};

async function noHorizontalOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
}

test.describe("poker math drills", () => {
  test("answers, explains and moves on from the keyboard", async ({ page }) => {
    const first = startSession(initialState(), 42, { kind: "type", type: "pot-odds" }, "auto", 0);
    const second = advance(submit(first, exact(first.question!), 1000), 1000);

    await page.goto("/drills?drill=pot-odds&seed=42");
    await expect(page.getByRole("heading", { level: 1, name: "Poker math drills" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pot odds" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { level: 2, name: first.question!.prompt })).toBeVisible();
    await expect(page.getByRole("timer")).toContainText("target 6.0 s");

    const input = page.getByLabel("Your answer (percent)");
    await expect(input).toBeFocused();
    await input.fill(exact(first.question!));
    await page.keyboard.press("Enter");

    await expect(page.getByText("Correct", { exact: true })).toBeVisible();
    await expect(page.getByText("Formula", { exact: true })).toBeVisible();
    await expect(page.getByText(first.question!.explanation.plugged)).toBeVisible();
    const next = page.getByRole("button", { name: /Next question/ });
    await expect(next).toBeFocused();

    await page.keyboard.press("n");
    await expect(page.getByRole("heading", { level: 2, name: second.question!.prompt })).toBeVisible();
    await expect(page.getByLabel("Your answer (percent)")).toBeFocused();
    await expect(page.getByLabel("Your answer (percent)")).toHaveValue("");
  });

  test("N does not skip an unanswered question, and invalid input is not graded", async ({ page }) => {
    const first = startSession(initialState(), 7, { kind: "type", type: "mdf" }, 1, 0);
    await page.goto("/drills?drill=mdf&level=1&seed=7");
    const prompt = page.getByRole("heading", { level: 2, name: first.question!.prompt });
    await expect(prompt).toBeVisible();

    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("n");
    await expect(prompt).toBeVisible();

    const input = page.getByLabel("Your answer (percent)");
    await input.fill("abc");
    await input.press("Enter");
    await expect(page.getByText(/isn't a number this drill can read/)).toBeVisible();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Correct", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Not quite", { exact: true })).toHaveCount(0);
  });

  test("a miss is saved for review and survives a reload", async ({ page }) => {
    const first = startSession(initialState(), 11, { kind: "type", type: "combos" }, 1, 0);
    const q = first.question!;
    await page.goto("/drills?drill=combos&level=1&seed=11");
    await expect(page.getByRole("heading", { level: 2, name: q.prompt })).toBeVisible();
    const input = page.getByLabel("Your answer");
    await input.fill(String(Number(exact(q)) + 1));
    await input.press("Enter");

    await expect(page.getByText("Not quite", { exact: true })).toBeVisible();
    await expect(page.getByText(`Exact: ${exact(q)}`, { exact: false })).toBeVisible();
    await expect(page.getByText(/Saved for review/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Review (1)" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Review (1)" })).toBeVisible();
    await page.getByRole("button", { name: "Review (1)" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Nothing due right now" })).toBeVisible();
  });

  test("call-or-fold uses buttons", async ({ page }) => {
    const first = startSession(initialState(), 5, { kind: "type", type: "call-or-fold" }, 2, 0);
    const q = first.question!;
    await page.goto("/drills?drill=call-or-fold&level=2&seed=5");
    const group = page.getByRole("group", { name: "Your answer" });
    await expect(group.getByRole("button", { name: "Call" })).toBeFocused();
    await group.getByRole("button", { name: q.answer.kind === "choice" && q.answer.value === "call" ? "Call" : "Fold" }).click();
    await expect(page.getByText("Correct", { exact: true })).toBeVisible();
    await expect(group.getByRole("button", { name: "Call" })).toBeDisabled();
  });

  test("works when storage is blocked", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
    });
    await page.goto("/drills?drill=outs-equity&level=1&seed=3");
    const q = startSession(initialState(), 3, { kind: "type", type: "outs-equity" }, 1, 0).question!;
    const input = page.getByLabel("Your answer (percent)");
    await input.fill(exact(q));
    await input.press("Enter");
    await expect(page.getByText("Correct", { exact: true })).toBeVisible();
    await expect(page.getByText("Shortcut (approximate)")).toBeVisible();
    await expect(page.getByText(/can't be saved in this browser/)).toBeVisible();
  });

  for (const width of [320, 390]) {
    test(`fits a ${width}px phone without horizontal scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto("/drills?drill=outs-count&level=3&seed=9");
      await expect(page.getByLabel("Your answer")).toBeVisible();
      await noHorizontalOverflow(page);
      await page.getByLabel("Your answer").fill("0");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Formula", { exact: true })).toBeVisible();
      await noHorizontalOverflow(page);
    });
  }
});
