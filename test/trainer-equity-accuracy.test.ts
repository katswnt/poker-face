import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCall, estimateEquity, exactEquity, monteCarloEquityEstimate, samplingUncertaintyCopy, TRAINER_EQUITY_SAMPLES } from "../src/lib/poker/equity";
import { cards } from "./helpers";
import type { CallQuote, TableStyle } from "../src/lib/poker/types";
import { generateFullDecision } from "../src/lib/poker/decide";

const hole = cards("Tc", "9c");
const board = cards("Ks", "9d", "3h", "6d", "2s");
const quote: CallQuote = { callCost: 30, contestablePot: 100, requiredEquity: 0.3, allIn: true, layers: [
  { amount: 80, contributors: [0, 3], eligibleOpponents: [3] },
  { amount: 20, contributors: [0], eligibleOpponents: [] },
] };

test("production heads-up rivers enumerate the filtered population against an independent evaluator", () => {
  for (const style of ["gto", "loose", "wild"] as TableStyle[]) {
    const exact = exactEquity(hole, board, style);
    const fast = estimateEquity(hole, board, 1, TRAINER_EQUITY_SAMPLES, style, 1);
    const otherSeed = estimateEquity(hole, board, 1, 200, style, 900);
    assert.equal(fast.method, "enumerated");
    assert.ok(Math.abs(fast.equity - exact) < 1e-12);
    assert.deepEqual(fast, otherSeed, "enumeration is independent of sample budget and seed");
    assert.equal(fast.standardError, 0);
    assert.ok(fast.samples <= 990 && fast.samples > 0);
    if (style === "wild") assert.equal(fast.samples, 990, "52 minus seven known cards leaves C(45,2) hands");
    assert.ok(Math.abs(fast.outcomes.all + fast.outcomes.some + fast.outcomes.none - 1) < 1e-12);
    assert.ok(Math.abs(fast.equity - fast.outcomes.all - fast.outcomes.some / 2) < 1e-12);
  }
});

test("exact layered returns include uncontested chips, preserving the same joint opponent", () => {
  const equity = exactEquity(hole, board, "wild");
  const result = estimateCall(hole, board, quote, 4, undefined, "wild");
  assert.equal(result.method, "enumerated");
  assert.equal(result.samples, 990);
  assert.ok(Math.abs(result.expectedReturn - (80 * equity + 20)) < 1e-10);
  assert.ok(Math.abs(result.expectedValue - (80 * equity - 10)) < 1e-10);
  assert.equal(result.layers[1].meanShare, 1);
  assert.equal(result.returnStandardError, 0);
  assert.equal(result.outcomes.none, 0, "uncontested chips are always returned");
});

test("a one-opponent layer does not incorrectly make a multi-opponent joint call exact", () => {
  const result = estimateCall(hole, board, { ...quote, layers: [
    { amount: 80, contributors: [0, 3, 4], eligibleOpponents: [3, 4] },
    { amount: 20, contributors: [0, 3], eligibleOpponents: [3] },
  ] }, 2, undefined, "wild", 88);
  assert.equal(result.method, "sampled");
  assert.equal(result.samples, 10_000);
  assert.ok(result.layers[1].meanShare >= result.layers[0].meanShare);
});

test("exact forced ties, wins and zero-price ties have zero sampling error", () => {
  const royalBoard = cards("As", "Ks", "Qs", "Js", "Ts");
  const tied = estimateEquity(cards("2c", "3d"), royalBoard, 1);
  assert.equal(tied.equity, 0.5);
  assert.equal(tied.standardError, 0);
  const tiedCall = estimateCall(cards("2c", "3d"), royalBoard, { ...quote, callCost: 50, layers: [
    { amount: 100, contributors: [0, 1], eligibleOpponents: [1] },
  ] }, 1);
  assert.equal(tiedCall.expectedValue, 0);
  assert.equal(tiedCall.isClose, true);
  const won = estimateEquity(cards("As", "Ks"), cards("Qs", "Js", "Ts", "2d", "3c"), 1);
  assert.equal(won.equity, 1);
  assert.deepEqual(won.outcomes, { all: 1, some: 0, none: 0 });
});

test("enumerated break-even with mixed outcomes tolerates roundoff without rounding the EV", () => {
  const exactPrice = exactEquity(hole, board, "wild") * 100;
  const result = estimateCall(hole, board, { callCost: exactPrice, contestablePot: 100, requiredEquity: exactPrice / 100, allIn: true, layers: [] }, 1, undefined, "wild");
  assert.equal(result.method, "enumerated");
  assert.ok(result.outcomes.all > 0 && result.outcomes.none > 0, "not a forced tie");
  assert.equal(result.returnStandardError, 0);
  assert.equal(result.expectedValue, result.expectedReturn - exactPrice, "raw EV is not rounded to zero");
  assert.equal(result.isClose, true);
  const notClose = estimateCall(hole, board, { callCost: exactPrice + 0.0001, contestablePot: 100, requiredEquity: (exactPrice + 0.0001) / 100, allIn: true, layers: [] }, 1, undefined, "wild");
  assert.equal(notClose.isClose, false, "a genuine small price difference is not swallowed by numerical tolerance");
});

test("production sampling is fixed-budget and deterministic, with ties included in its uncertainty", () => {
  const first = estimateEquity(hole, board.slice(0, 4), 2, undefined, "loose", 2718);
  const again = estimateEquity(hole, board.slice(0, 4), 2, undefined, "loose", 2718);
  assert.deepEqual(first, again);
  assert.equal(first.samples, 10_000);
  assert.equal(first.method, "sampled");
  assert.ok(first.standardError > 0 && first.standardError < 0.00501);
  assert.equal(monteCarloEquityEstimate(hole, board, 1, 1000).method, "sampled", "explicit Monte Carlo API is not silently enumerated");
});

test("larger fixed samples reduce error across independent seeds against exact river truth", () => {
  const exact = exactEquity(hole, board, "wild");
  let smallSquared = 0, largeSquared = 0;
  let largeCoverage = 0;
  for (let seed = 200; seed < 220; seed++) {
    const small = monteCarloEquityEstimate(hole, board, 1, 1000, "wild", seed);
    const large = monteCarloEquityEstimate(hole, board, 1, 10_000, "wild", seed);
    smallSquared += (small.equity - exact) ** 2;
    largeSquared += (large.equity - exact) ** 2;
    if (Math.abs(large.equity - exact) <= 1.96 * large.standardError) largeCoverage++;
  }
  assert.ok(largeSquared < smallSquared / 3, `multi-seed squared errors: ${smallSquared} vs ${largeSquared}`);
  assert.ok(largeCoverage >= 16, `observed approximate interval coverage ${largeCoverage}/20; not a universal coverage proof`);
});

test("close sampled calls stay explicitly close", () => {
  const first = estimateCall(hole, board.slice(0, 4), quote, 1, undefined, "wild", 18);
  const close = estimateCall(hole, board.slice(0, 4), { ...quote, callCost: first.expectedReturn }, 1, undefined, "wild", 18);
  assert.equal(close.expectedValue, 0);
  assert.equal(close.isClose, true);
});

test("an exactly break-even river call is not described as random error or a slight gain", () => {
  const decision = generateFullDecision(0, cards("2c", "3d"), cards("As", "Ks", "Qs", "Js", "Ts"), 50, 50, 0, "river", false, "Hero", "Dealer", 50, 2, "wild", 0, 1, 100, false, {
    callCost: 50, contestablePot: 100, requiredEquity: 0.5, allIn: true, layers: [],
  });
  assert.equal(decision.action, "call");
  assert.equal(decision.callEstimate?.isClose, true);
  assert.match(decision.reasoning, /breaks even within floating-point precision/);
  assert.match(decision.math.join(" "), /No random sampling was used/);
  assert.doesNotMatch(decision.math.join(" "), /Random sampling may move|±0|slightly clears/);
});

test("uncertainty copy distinguishes one SE, approximate coverage and model limitations", () => {
  const copy = samplingUncertaintyCopy(0.005);
  assert.match(copy, /one SE.*0\.50.*95%.*±0\.98/);
  assert.match(copy, /not a guaranteed bound/);
  assert.match(copy, /wrong opponent ranges or later betting/);
  assert.match(samplingUncertaintyCopy(0), /zero measured variation does not prove zero sampling error/);
});

test("production estimates reject impossible cards, unsupported budgets and inconsistent pots", () => {
  assert.throws(() => estimateEquity(hole, [...board.slice(0, 4), hole[0]], 1), /distinct/);
  assert.throws(() => estimateEquity(hole, board, 6), /opponents/);
  assert.throws(() => estimateEquity(hole, board, 1, Infinity), /budget/);
  assert.throws(() => estimateCall(hole, board, { ...quote, contestablePot: 99 }, 1), /add/);
  assert.throws(() => estimateCall(hole, board, { ...quote, layers: [{ amount: 100, contributors: [0, 1], eligibleOpponents: [1, 1] }] }, 1), /Invalid/);
});
