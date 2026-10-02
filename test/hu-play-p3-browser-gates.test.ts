import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

test("P3 browser gates keep all 200 cases, cleanup, parity, 10-second turns and two-second rivers", async () => {
  assert.ok(existsSync("scripts/hu-play-p3-browser-gates.ts"), "Frozen P3 browser gates required");
  const { checkP3BrowserRows } = await import("../scripts/hu-play-p3-browser-gates");
  const rows = Array.from({ length: 200 }, (_, seed) => ({ seed, browser: "chromium", passed: true,
    exactNativeParity: true, workers: 2, terminated: 2, isolated: false, elapsedMs: 11000,
    responseElapsedMs: 4400, observedPeakLinearMemoryBytes: null,
    attempts: [{ street: "turn" as const, elapsedMs: 4350 }, { street: "river" as const, elapsedMs: 100 }] }));
  const [summary] = checkP3BrowserRows(rows, ["chromium"], false);
  assert.equal(summary.turn.p95Ms, 4400); assert.equal(summary.river.p95Ms, 100);
  assert.throws(() => checkP3BrowserRows(rows.slice(1), ["chromium"], false));
  for (const mutation of [{ passed: false }, { exactNativeParity: false }, { terminated: 0 }, { isolated: true },
    { responseElapsedMs: Number.NaN }, { elapsedMs: 0 }]) {
    assert.throws(() => checkP3BrowserRows(rows.map((r, i) => i ? r : { ...r, ...mutation }), ["chromium"], false));
  }
  assert.throws(() => checkP3BrowserRows(rows.map(r => ({ ...r, responseElapsedMs: 10001 })), ["chromium"], false), /turn.*budget/i);
  assert.throws(() => checkP3BrowserRows(rows.map(r => ({ ...r, attempts: [{ street: "river" as const, elapsedMs: 2001 }] })), ["chromium"], false), /river.*budget/i);
  assert.throws(() => checkP3BrowserRows(rows, ["chromium"], true), /memory/i);
  assert.throws(() => checkP3BrowserRows(rows.map(r => ({ ...r, attempts: [] })), ["chromium"], false), /river/i);
});
