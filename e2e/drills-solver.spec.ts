import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
// Solver-backed decisions are deterministic in (session seed, level) and the library contents, so
// the spec builds the same questions in Node from the files the page fetches and asserts on them.
import { initialState } from "../src/lib/drills/scheduler";
import { advance, resolvePending, startSession, submit, type Session } from "../src/lib/drills/session";
import { createSolverSource } from "../src/lib/drills/solver";
import type { Question } from "../src/lib/drills/types";

const fetcher = (async (url: string) => new Response(readFileSync(`public${url}`))) as unknown as typeof fetch;
const source = createSolverSource({ fetcher });

async function resolved(session: Session): Promise<Session> {
  const pending = session.pending!;
  return resolvePending(session, pending, await source.generate(pending.seed, pending.level), 0);
}

const bestIndex = (q: Question): number => {
  if (q.answer.kind !== "decision") throw new Error("decision expected");
  const best = q.answer.value;
  return q.answer.options.findIndex(o => o.id === best);
};

async function noHorizontalOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
}

test.describe("solver-backed decision drills", () => {
  test("answers from the keyboard, explains with solver numbers, and moves on", async ({ page }) => {
    const first = await resolved(startSession(initialState(), 42, { kind: "type", type: "solver" }, "auto", 0));
    const q = first.question!;
    const i = bestIndex(q);
    const second = await resolved(advance(submit(first, q.answer.value as string, 1000), 1000));

    await page.goto("/drills?drill=solver&seed=42");
    await expect(page.getByRole("button", { name: "Solver decisions" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { level: 2, name: q.prompt })).toBeVisible();
    const group = page.getByRole("group", { name: "Your answer" });
    await expect(group.getByRole("button").first()).toBeFocused();

    await page.getByLabel("Show the price (pot odds, MDF)").check();
    await expect(page.getByText(q.solver!.price[0].plugged)).toBeVisible();
    await page.getByLabel(/range composition/).check();
    await expect(page.getByText(`${q.solver!.villainName}'s range here`)).toBeVisible();

    // Shortcuts still work with focus on a context toggle (only text fields swallow digits).
    await expect(page.getByLabel(/range composition/)).toBeFocused();
    await page.keyboard.press(String(i + 1));
    await expect(page.getByText("Correct", { exact: true })).toBeVisible();
    await expect(page.getByText(/You: .*Best: /)).toBeVisible();
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(1 + q.solver!.actions.length);
    await expect(page.getByText(q.solver!.provenance)).toBeVisible();
    await expect(page.getByText(/^Your equity$/)).toBeVisible();
    const next = page.getByRole("button", { name: /Next question/ });
    await expect(next).toBeFocused();

    await page.keyboard.press("n");
    await expect(page.getByRole("heading", { level: 2, name: second.question!.prompt })).toBeVisible();
    await expect(page.getByRole("group", { name: "Your answer" }).getByRole("button").first()).toBeFocused();
  });

  for (const width of [320, 390]) {
    test(`fits a ${width}px phone without horizontal scrolling, answered`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const first = await resolved(startSession(initialState(), 7, { kind: "type", type: "solver" }, 3, 0));
      const q = first.question!;
      await page.goto("/drills?drill=solver&level=3&seed=7");
      await expect(page.getByRole("heading", { level: 2, name: q.prompt })).toBeVisible();
      await noHorizontalOverflow(page);
      await page.getByLabel("Show the price (pot odds, MDF)").check();
      await page.getByLabel(/range composition/).check();
      await noHorizontalOverflow(page);
      await page.getByRole("group", { name: "Your answer" }).getByRole("button").last().click();
      await expect(page.getByRole("table")).toBeVisible();
      await noHorizontalOverflow(page);
    });
  }

  test("a failed load shows a retry that recovers", async ({ page }) => {
    const first = await resolved(startSession(initialState(), 9, { kind: "type", type: "solver" }, "auto", 0));
    await page.route("**/solver-data/bridge-v1/**", route => route.abort("internetdisconnected"));
    await page.goto("/drills?drill=solver&seed=9");
    await expect(page.getByRole("heading", { level: 2, name: "Couldn't load the solver spot" })).toBeVisible();
    await expect(page.getByText("Could not load saved spot data. Check your connection and retry.")).toBeVisible();
    await page.unrouteAll();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { level: 2, name: first.question!.prompt })).toBeVisible();
  });
});
