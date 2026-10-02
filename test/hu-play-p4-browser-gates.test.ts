import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
async function api() {
  assert.ok(existsSync("scripts/hu-play-p4-browser-gates.ts"), "P4 browser gate must require the whole frozen corpus");
  return import("../scripts/hu-play-p4-browser-gates");
}
function rows() {
  return Array.from({ length: 200 }, (_, seed) => ({ seed, browser: "chromium", passed: true, exactNativeParity: true,
    workers: seed < 40 ? 0 : 2, terminated: seed < 40 ? 0 : 2, isolated: false, elapsedMs: 2000,
    responseElapsedMs: 20, observedPeakLinearMemoryBytes: seed < 40 ? null : 30000000,
    attempts: seed < 40 ? [] : [{ street: "turn" as const, elapsedMs: 1800 }, { street: "river" as const, elapsedMs: 100 }] }));
}
test("P4 browser gates retain 200 cases and 10s/2s limits while distinguishing real no-solve all-ins", async () => {
  const { checkP4BrowserRows } = await api(), input = rows();
  const [summary] = checkP4BrowserRows(input, ["chromium"], true);
  assert.equal(summary.turn.p95Ms, 1800); assert.equal(summary.river.p95Ms, 100);
  assert.equal(summary.flop.p95Ms, 20); assert.equal(summary.noSolveCases, 40);
  assert.throws(() => checkP4BrowserRows(input.slice(1), ["chromium"], false));
  assert.throws(() => checkP4BrowserRows(input.map((r, i) => i === 0 ? { ...r, exactNativeParity: false } : r), ["chromium"], false));
  assert.throws(() => checkP4BrowserRows(input.map(r => ({ ...r, attempts: r.attempts.map(a => ({ ...a,
    elapsedMs: a.street === "turn" ? 10001 : a.elapsedMs })) })), ["chromium"], false), /turn/i);
  assert.throws(() => checkP4BrowserRows(input.map(r => ({ ...r, attempts: r.attempts.map(a => ({ ...a,
    elapsedMs: a.street === "river" ? 2001 : a.elapsedMs })) })), ["chromium"], false), /river/i);
  assert.throws(() => checkP4BrowserRows(input.map((r, i) => i === 50 ? { ...r, workers: 0, terminated: 0 } : r), ["chromium"], false), /worker|lifecycle/i);
  assert.throws(() => checkP4BrowserRows(input.map((r, i) => i === 50 ? { ...r, terminated: 1 } : r), ["chromium"], false), /worker|lifecycle/i);
  assert.throws(() => checkP4BrowserRows(input.map((r, i) => i === 50 ? { ...r, observedPeakLinearMemoryBytes: null } : r), ["chromium"], true), /memory/i);
  assert.throws(() => checkP4BrowserRows(input.map(r => ({ ...r, attempts: r.attempts.filter(a => a.street === "turn") })), ["chromium"], false), /river/i);
});
