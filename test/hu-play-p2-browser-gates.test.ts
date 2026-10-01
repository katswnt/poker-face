import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

test("P2 browser gate retains every seed, exact parity, worker cleanup and the existing two-second p95", async () => {
  assert.ok(existsSync("scripts/hu-play-p2-browser-gates.ts"), "Frozen browser gate required");
  const { checkP2BrowserRows } = await import("../scripts/hu-play-p2-browser-gates");
  const rows = Array.from({ length: 200 }, (_, seed) => ({ seed, browser: "chromium", passed: true,
    exactNativeParity: true, workers: seed % 5 === 0 ? 2 : 1, terminated: seed % 5 === 0 ? 2 : 1,
    isolated: false, elapsedMs: 100, observedPeakLinearMemoryBytes: null }));
  assert.equal(checkP2BrowserRows(rows, ["chromium"], false)[0].p95Ms, 100);
  assert.throws(() => checkP2BrowserRows(rows.slice(1), ["chromium"], false));
  for (const mutation of [{ passed: false }, { exactNativeParity: false }, { terminated: 0 }, { isolated: true }]) {
    const changed = rows.map((r, i) => i === 0 ? { ...r, ...mutation } : r);
    assert.throws(() => checkP2BrowserRows(changed, ["chromium"], false));
  }
  assert.throws(() => checkP2BrowserRows(rows.map(r => ({ ...r, elapsedMs: 2001 })), ["chromium"], false));
  assert.throws(() => checkP2BrowserRows(rows, ["chromium"], true), /memory/i);
});
