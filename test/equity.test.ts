import { test } from "node:test";
import assert from "node:assert/strict";
import { monteCarloEquity, clearEquityCache } from "../src/lib/poker/equity";
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
