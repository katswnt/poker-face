import { test } from "node:test";
import assert from "node:assert/strict";
import { monteCarloEquity, exactEquity, equityStandardError, clearEquityCache } from "../src/lib/poker/equity";
import { cards } from "./helpers";

test("equity is pure: same inputs → identical result", () => {
  clearEquityCache();
  const a = monteCarloEquity(cards("As", "Ah"), [], 1, 1000, "gto", 12345);
  clearEquityCache();
  const b = monteCarloEquity(cards("As", "Ah"), [], 1, 1000, "gto", 12345);
  assert.equal(a, b, "identical inputs must give identical equity (referential transparency)");
});

test("memoization returns the same value as a cold compute", () => {
  clearEquityCache();
  const cold = monteCarloEquity(cards("As", "Ah"), [], 1, 1000, "gto", 999);
  const warm = monteCarloEquity(cards("As", "Ah"), [], 1, 1000, "gto", 999); // served from cache
  assert.equal(cold, warm);
});

test("different deal seeds → results within Monte Carlo noise", () => {
  const a = monteCarloEquity(cards("As", "Ah"), [], 1, 1000, "gto", 1);
  const b = monteCarloEquity(cards("As", "Ah"), [], 1, 1000, "gto", 2);
  assert.ok(Math.abs(a - b) < 0.05, `AA equity should be stable across seeds, got ${a} vs ${b}`);
});

test("AA heads-up is a strong favorite (~80–90%)", () => {
  const eq = monteCarloEquity(cards("As", "Ah"), [], 1, 2000, "gto", 777);
  assert.ok(eq > 0.78 && eq < 0.92, `AA vs 1 range-filtered opp should be ~85%, got ${eq}`);
});

test("stronger hands have more equity (monotonicity)", () => {
  const aa = monteCarloEquity(cards("As", "Ah"), [], 1, 1500, "gto", 42);
  const junk = monteCarloEquity(cards("7s", "2d"), [], 1, 1500, "gto", 42);
  assert.ok(aa > junk, `AA (${aa}) should beat 72o (${junk})`);
});

test("equity drops as opponents are added", () => {
  const vs1 = monteCarloEquity(cards("As", "Ah"), [], 1, 1500, "gto", 99);
  const vs3 = monteCarloEquity(cards("As", "Ah"), [], 3, 1500, "gto", 99);
  assert.ok(vs1 > vs3, `AA equity should fall with more opponents: ${vs1} vs ${vs3}`);
});

// ── Estimator validation: MC must converge to the exact enumerated equity ──────────────
// This is the load-bearing test for the whole equity engine: it proves the sampler is
// unbiased by pinning it to ground truth computed by full enumeration.
test("Monte Carlo converges to EXACT equity on the river (unbiased sampler)", () => {
  const hole = cards("As", "Kd"), board = cards("Ah", "7c", "2d", "Jc", "5s");
  const exact = exactEquity(hole, board, "gto");
  const mc = monteCarloEquity(hole, board, 1, 4000, "gto", 20240101);
  const se = equityStandardError(mc, 4000);
  assert.ok(Math.abs(mc - exact) < 4 * se + 0.01, `river: MC ${mc.toFixed(4)} vs exact ${exact.toFixed(4)} (4·SE=${(4 * se).toFixed(4)})`);
});

test("Monte Carlo converges to EXACT equity on the turn (one card to come)", () => {
  const hole = cards("As", "Kd"), board = cards("Ah", "7c", "2d", "Jc");
  const exact = exactEquity(hole, board, "gto");
  const mc = monteCarloEquity(hole, board, 1, 5000, "gto", 20240202);
  const se = equityStandardError(mc, 5000);
  assert.ok(Math.abs(mc - exact) < 4 * se + 0.015, `turn: MC ${mc.toFixed(4)} vs exact ${exact.toFixed(4)} (4·SE=${(4 * se).toFixed(4)})`);
});

test("standard error shrinks like 1/√n", () => {
  assert.ok(equityStandardError(0.5, 4000) < equityStandardError(0.5, 1000));
  assert.ok(Math.abs(equityStandardError(0.5, 10000) - 0.005) < 0.0005, "SE(0.5, 10000) ≈ 0.5%");
});
