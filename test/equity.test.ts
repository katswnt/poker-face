import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monteCarloEquity,
  monteCarloEquityEstimate,
  monteCarloCallEstimate,
  exactEquity,
  equityStandardError,
  clearEquityCache,
  mulberry32,
  sampleRangeTupleIndices,
  standardErrorFromMoments,
} from "../src/lib/poker/equity";
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

test("forced ties return the exact share for every table size from 2 through 6 players", () => {
  const hole = cards("2c", "3d");
  const board = cards("As", "Ks", "Qs", "Js", "Ts"); // everyone plays the royal-flush board

  for (let playerCount = 2; playerCount <= 6; playerCount++) {
    const estimate = monteCarloEquityEstimate(hole, board, playerCount - 1, 100, "wild", 100 + playerCount);
    assert.equal(estimate.equity, 1 / playerCount, `${playerCount}-way tie should return exactly 1/${playerCount}`);
    assert.equal(estimate.standardError, 0, `${playerCount}-way forced tie should have no sampling uncertainty`);
    assert.deepEqual(estimate.outcomes, { all: 0, some: 1, none: 0 });
  }
});

test("showdown outcome rates describe wins, splits, and losses and sum to one", () => {
  const estimate = monteCarloEquityEstimate(
    cards("As", "Kd"),
    cards("Ah", "7c", "2d", "Jc", "5s"),
    2,
    2000,
    "loose",
    54321,
  );
  const total = estimate.outcomes.all + estimate.outcomes.some + estimate.outcomes.none;
  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.ok(estimate.outcomes.all > 0);
  assert.ok(estimate.outcomes.none > 0);
});

test("an unbeatable hand wins all reachable chips in every sampled showdown", () => {
  const estimate = monteCarloEquityEstimate(
    cards("As", "Ks"),
    cards("Qs", "Js", "Ts", "2d", "3c"),
    5,
    250,
    "wild",
    777,
  );
  assert.equal(estimate.equity, 1);
  assert.deepEqual(estimate.outcomes, { all: 1, some: 0, none: 0 });
});

test("layered call estimates score each pot against only its eligible opponents", () => {
  const estimate = monteCarloCallEstimate(
    cards("2c", "3d"),
    cards("As", "Ks", "Qs", "Js", "Ts"),
    {
      callCost: 50,
      contestablePot: 200,
      requiredEquity: 0.25,
      allIn: false,
      layers: [
        { amount: 120, contributors: [0, 1, 2], eligibleOpponents: [1, 2] },
        { amount: 80, contributors: [0, 1], eligibleOpponents: [1] },
      ],
    },
    2,
    100,
    "wild",
    17,
  );

  assert.deepEqual(estimate.layers.map(layer => layer.meanShare), [1 / 3, 1 / 2]);
  assert.equal(estimate.expectedReturn, 80);
  assert.equal(estimate.combinedShare, 0.4);
  assert.equal(estimate.returnStandardError, 0);
  assert.equal(estimate.expectedValue, 30);
  assert.deepEqual(estimate.outcomes, { all: 0, some: 1, none: 0 });
});

test("side-pot regression: a profitable layered call is not priced as three-way for every chip", () => {
  const estimate = monteCarloCallEstimate(
    cards("Ac", "2c"),
    cards("Qs", "8s", "3c"),
    {
      callCost: 50,
      contestablePot: 250,
      requiredEquity: 0.2,
      allIn: false,
      layers: [
        { amount: 150, contributors: [0, 1, 2], eligibleOpponents: [1, 2] },
        { amount: 100, contributors: [0, 1], eligibleOpponents: [1] },
      ],
    },
    2,
    20_000,
    "loose",
    3,
  );

  assert.ok(estimate.expectedValue > 10, `layered call should be clearly profitable, got ${estimate.expectedValue}`);
  assert.ok(estimate.layers[1].meanShare > estimate.layers[0].meanShare, "the heads-up side pot should have more share than the three-way main pot");
});

test("whole opponent tuples are sampled without seat-order bias", () => {
  const pairs: Array<[number, number]> = [[0, 1], [2, 3], [4, 5]];
  const rng = mulberry32(20260827);
  const counts = new Map<string, number>();
  for (let sample = 0; sample < 60_000; sample++) {
    const tuple = sampleRangeTupleIndices(pairs, 2, rng);
    const key = tuple.map(pair => pair[0]).join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, 6, "all six compatible ordered tuples must appear");
  const frequencies = [...counts.values()];
  assert.ok(Math.max(...frequencies) / Math.min(...frequencies) < 1.06, `tuple counts are uneven: ${frequencies.join(", ")}`);
});

// ── Estimator validation: MC must track the exact enumerated equity ─────────────────────
// These independent comparisons can catch sampling bias in important pinned cases; they
// do not claim to prove correctness for every possible input.
test("Monte Carlo tracks exact equity on the river within measured error", () => {
  const hole = cards("As", "Kd"), board = cards("Ah", "7c", "2d", "Jc", "5s");
  const exact = exactEquity(hole, board, "gto");
  const estimate = monteCarloEquityEstimate(hole, board, 1, 4000, "gto", 20240101);
  assert.ok(Math.abs(estimate.equity - exact) < 4 * estimate.standardError + 0.01, `river: MC ${estimate.equity.toFixed(4)} vs exact ${exact.toFixed(4)} (4·SE=${(4 * estimate.standardError).toFixed(4)})`);
});

test("Monte Carlo tracks exact equity on the turn within measured error", () => {
  const hole = cards("As", "Kd"), board = cards("Ah", "7c", "2d", "Jc");
  const exact = exactEquity(hole, board, "gto");
  const estimate = monteCarloEquityEstimate(hole, board, 1, 5000, "gto", 20240202);
  assert.ok(Math.abs(estimate.equity - exact) < 4 * estimate.standardError + 0.015, `turn: MC ${estimate.equity.toFixed(4)} vs exact ${exact.toFixed(4)} (4·SE=${(4 * estimate.standardError).toFixed(4)})`);
});

test("standard error shrinks like 1/√n", () => {
  assert.ok(equityStandardError(0.5, 4000) < equityStandardError(0.5, 1000));
  assert.ok(Math.abs(equityStandardError(0.5, 10000) - 0.005) < 0.0005, "SE(0.5, 10000) ≈ 0.5%");
});

test("sample error uses split-pot values instead of pretending every sample is win/loss", () => {
  const sum = 0 + 0.5 + 1;
  const sumSquares = 0 + 0.25 + 1;
  assert.ok(Math.abs(standardErrorFromMoments(sum, sumSquares, 3) - Math.sqrt(0.25 / 3)) < 1e-12);
  assert.equal(standardErrorFromMoments(50, 25, 100), 0, "one hundred identical half-pot shares have no sampling error");
});
