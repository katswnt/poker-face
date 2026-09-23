import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    let seed = 192;
    Math.random = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  });
});

test("the real trainer worker calculates a hand and retains native keyboard stepping", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "observe", exact: true }).click();
  const worker = page.waitForEvent("worker");
  await page.getByRole("button", { name: /deal/i }).focus();
  await page.keyboard.press("Space");
  expect((await worker).url()).toContain(".js");
  await expect(page.getByText("Blinds posted", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Next →", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "← Back", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("worker absence is an accessible error and never falls back to a blocking solve", async ({ page }, testInfo) => {
  await page.addInitScript(() => { Object.defineProperty(window, "Worker", { value: undefined, configurable: true }); });
  await page.goto("/");
  await page.getByRole("button", { name: /deal/i }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Background calculations" })).toContainText("Web Worker support");
  await expect(page.getByText("Blinds posted", { exact: true }).last()).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Retry calculation", exact: true });
  await retry.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Background calculations" })).toBeVisible();
  await expect(retry).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("trainer-worker-error.png") });
});

test("pending calculation keeps controls responsive, rejects stale messages and terminates on replacement", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const state = { worker: null as unknown as Worker, created: 0, terminated: 0, id: 0 };
    (window as unknown as { trainerTest: typeof state }).trainerTest = state;
    window.Worker = class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      constructor() { state.worker = this as unknown as Worker; state.created++; }
      postMessage(request: { id: number }) { state.id = request.id; }
      terminate() { state.terminated++; }
    } as unknown as typeof Worker;
  });
  await page.goto("/");
  await page.getByRole("button", { name: /deal/i }).click();
  await expect(page.getByRole("status")).toContainText("Calculating this hand in the background");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("trainer-worker-pending.png") });
  await page.getByRole("button", { name: /Help & Language/ }).click();
  await expect(page.getByRole("button", { name: "Plain language", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = (window as unknown as { trainerTest: { worker: Worker; id: number } }).trainerTest;
    state.worker.onmessage?.call(state.worker, new MessageEvent("message", { data: { id: state.id + 99, type: "error", message: "stale failure" } }));
  });
  await expect(page.getByRole("alert").filter({ hasText: "stale failure" })).toHaveCount(0);
  await page.evaluate(() => {
    const state = (window as unknown as { trainerTest: { worker: Worker; id: number } }).trainerTest;
    state.worker.onmessage?.call(state.worker, new MessageEvent("message", { data: { id: state.id, type: "error", message: "Controlled worker failure" } }));
  });
  await expect(page.getByRole("alert").filter({ hasText: "Controlled worker failure" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { trainerTest: { terminated: number } }).trainerTest.terminated)).toBe(1);
  await page.getByRole("button", { name: "Retry calculation", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Calculating this hand in the background");
  expect(await page.evaluate(() => (window as unknown as { trainerTest: { created: number } }).trainerTest.created)).toBe(2);
  await page.getByRole("link", { name: "Open the heads-up push/fold strategy explorer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Push/Fold Strategy Explorer", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { trainerTest: { terminated: number } }).trainerTest.terminated)).toBe(2);
});

test("a close worker estimate never marks the other legal choice costly", async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      postMessage(request: { id: number; task: { kind: string; input: { heroIdx: number; heroChoices: Array<{ action: string }>; gs: { board: unknown[] } } } }) {
        if (request.task.kind !== "hand") return;
        const input = request.task.input;
        const callEstimate = { method: "sampled", callCost: 20, contestablePot: 100, combinedShare: 0.19, shareStandardError: 0.01, expectedReturn: 19, returnStandardError: 1, expectedValue: -1, samples: 10_000, isClose: true, outcomes: { all: 0.19, some: 0, none: 0.81 }, layers: [] };
        const ai = { action: "fold", equity: 0.19, equityMethod: "sampled", equitySamples: 10_000, equityStandardError: 0.01, callEstimate, dialogue: "Fold.", reasoning: "Close estimate.", thoughts: [], math: [] };
        const base = { board: input.gs.board.slice(0, 3), pot: 80, folded: [false, false, false, false], stacks: [200, 200, 200, 200] };
        const stages = [
          { ...base, type: "info", street: "flop", title: "Blinds posted" },
          { ...base, type: "action", street: "flop", playerIdx: input.heroIdx, heroActionId: 0, decision: input.heroChoices[0] ?? ai, aiDecision: ai, currentBet: 20, bets: [0, 0, 0, 0], legalActions: { fold: true, call: true, check: false, bet: false, raise: false }, callQuote: { callCost: 20, contestablePot: 100, requiredEquity: 0.2, allIn: true, layers: [] } },
          { ...base, type: "showdown", winner: input.heroIdx, foldWin: true },
        ];
        setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: { id: request.id, type: "complete", result: { kind: "hand", stages }, elapsedMs: 1 } })), 0);
      }
      terminate() {}
    } as unknown as typeof Worker;
  });
  await page.goto("/");
  await page.getByRole("button", { name: /deal/i }).click();
  await page.getByRole("button", { name: "Next →", exact: true }).click();
  const prompt = page.getByText("Your decision", { exact: true }).locator("..");
  await prompt.getByRole("button", { name: "call", exact: true }).click();
  await expect(page.getByText("~ Different legal choice", { exact: true })).toBeVisible();
  await expect(page.getByText("! Costly in this model", { exact: true })).toHaveCount(0);
});

for (const width of [320, 390, 1280]) {
  test(`trainer background calculation visual check at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: /deal/i }).click();
    await expect(page.getByText("Blinds posted", { exact: true }).last()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`trainer-ready-${width}.png`) });
  });
}
