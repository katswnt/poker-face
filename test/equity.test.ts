import { test } from "node:test";
import assert from "node:assert/strict";
import { monteCarloEquity, mulberry32, setSimRng } from "../src/lib/poker/equity";
import { cards } from "./helpers";

test("same seed → identical equity (determinism seam)", () => {
  setSimRng(mulberry32(12345));
  const a = monteCarloEquity(cards("As", "Ah"), [], 1, 1000);
  setSimRng(mulberry32(12345));
  const b = monteCarloEquity(cards("As", "Ah"), [], 1, 1000);
  assert.equal(a, b, "seeded runs must be bit-for-bit reproducible");
});

test("different seeds → results within Monte Carlo noise", () => {
  setSimRng(mulberry32(1));
  const a = monteCarloEquity(cards("As", "Ah"), [], 1, 1000);
  setSimRng(mulberry32(2));
  const b = monteCarloEquity(cards("As", "Ah"), [], 1, 1000);
  assert.ok(Math.abs(a - b) < 0.05, `AA equity should be stable across seeds, got ${a} vs ${b}`);
});

test("AA heads-up is a strong favorite (~80–90%)", () => {
  setSimRng(mulberry32(777));
  const eq = monteCarloEquity(cards("As", "Ah"), [], 1, 2000);
  assert.ok(eq > 0.78 && eq < 0.92, `AA vs 1 range-filtered opp should be ~85%, got ${eq}`);
});

test("stronger hands have more equity (monotonicity)", () => {
  setSimRng(mulberry32(42));
  const aa = monteCarloEquity(cards("As", "Ah"), [], 1, 1500);
  setSimRng(mulberry32(42));
  const junk = monteCarloEquity(cards("7s", "2d"), [], 1, 1500);
  assert.ok(aa > junk, `AA (${aa}) should beat 72o (${junk})`);
});

test("equity drops as opponents are added", () => {
  setSimRng(mulberry32(99));
  const vs1 = monteCarloEquity(cards("As", "Ah"), [], 1, 1500);
  setSimRng(mulberry32(99));
  const vs3 = monteCarloEquity(cards("As", "Ah"), [], 3, 1500);
  assert.ok(vs1 > vs3, `AA equity should fall with more opponents: ${vs1} vs ${vs3}`);
});
