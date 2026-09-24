import { expect, test } from "@playwright/test";

// A short all-in BB (3 chips) wins when everyone folds, but only the chips it matched.
// The SB's unmatched 2 blind chips must be shown as returned, not as part of the pot.
test("a fold win to a short all-in blind shows the unmatched blind as returned", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.Worker = class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      postMessage(request: { id: number; task: { kind: string; input: { heroIdx: number; heroChoices: Array<{ action: string }>; gs: { board: unknown[] } } } }) {
        if (request.task.kind !== "hand") return;
        const input = request.task.input;
        const hero = input.heroIdx;
        const winner = (hero + 1) % 4;
        const refunded = (hero + 2) % 4;
        const folded = [true, true, true, true];
        folded[winner] = false;
        const ai = { action: "fold", equity: 0.1, dialogue: "Fold.", reasoning: "Fold.", thoughts: [], math: [] };
        const base = { board: [], pot: 8, stacks: [200, 200, 200, 200] };
        const stages = [
          { ...base, type: "info", street: "preflop", title: "Blinds posted", folded: [false, false, false, false] },
          { ...base, type: "action", street: "preflop", playerIdx: hero, heroActionId: 0, decision: input.heroChoices[0] ?? ai, aiDecision: ai, currentBet: 5, bets: [0, 0, 0, 0], folded: [false, false, false, false], legalActions: { fold: true, call: true, check: false, bet: false, raise: true } },
          {
            ...base,
            type: "showdown",
            folded,
            winner,
            foldWin: true,
            results: [],
            rankedResults: [],
            payouts: [0, 1, 2, 3].map(i => (i === winner ? 6 : i === refunded ? 2 : 0)),
            pots: [
              { amount: 6, contributors: [winner, refunded].sort(), eligible: [winner], winners: [winner], awards: [{ idx: winner, amount: 6 }] },
              { amount: 2, contributors: [refunded], eligible: [], winners: [refunded], awards: [{ idx: refunded, amount: 2 }] },
            ],
          },
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
  await prompt.getByRole("button", { name: "fold", exact: true }).click();
  const summary = page.getByText(/Takes the \d+-chip pot\./).first();
  for (let step = 0; step < 4 && !(await summary.isVisible()); step++) {
    const next = page.getByRole("button", { name: "Next →", exact: true });
    if (await next.isVisible()) await next.click();
  }
  await expect(summary).toHaveText(/^Takes the 6-chip pot\. \S+ gets 2 uncalled chips back\.$/);
  await page.screenshot({ path: testInfo.outputPath("fold-win-refund.png"), fullPage: true });
});
