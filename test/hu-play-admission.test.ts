import assert from "node:assert/strict";
import test from "node:test";
import { reachCapacityBound } from "../src/lib/hu-play/admission";

test("largest-k reach is an upper bound on every k-hand subset", () => {
  const weights = [1, 3, 2, 0, 4];
  const result = reachCapacityBound(weights, 2, 0.7);
  assert.equal(result.totalHands, 4); assert.equal(result.retainedMass, 0.7);
  assert.equal(result.handsForTarget, 2); assert.equal(result.possible, true);
  for (let a = 0; a < weights.length; a++) for (let b = a + 1; b < weights.length; b++) {
    assert.ok((weights[a] + weights[b]) / 10 <= result.retainedMass);
  }
  assert.equal(reachCapacityBound(weights, 2, 0.71).possible, false);
  assert.deepEqual(weights, [1, 3, 2, 0, 4]);
});

test("99% mass and 64 hands are hard gates, not relative-weight heuristics", () => {
  const uniform = reachCapacityBound(Array(100).fill(1), 64, .99);
  assert.equal(uniform.retainedMass, .64); assert.equal(uniform.handsForTarget, 99);
  assert.equal(uniform.possible, false);
  assert.equal(reachCapacityBound(Array(64).fill(1), 64, .99).possible, true);
  const thin = reachCapacityBound([1, ...Array(100).fill(.00001)], 64, .99);
  assert.equal(thin.possible, true); assert.equal(thin.handsForTarget, 1);
});

test("the bound is scale-invariant and does not overflow or silently underflow", () => {
  const baseline = reachCapacityBound([1, 2, 3], 2, .9);
  for (const scale of [1e-200, 1e200]) {
    const scaled = reachCapacityBound([scale, 2 * scale, 3 * scale], 2, .9);
    assert.ok(Math.abs(scaled.retainedMass - baseline.retainedMass) < 1e-15);
    assert.equal(scaled.handsForTarget, baseline.handsForTarget);
  }
  assert.throws(() => reachCapacityBound([Number.MIN_VALUE, 1e308], 1, .99), /underflow/);
});

test("invalid ranges and thresholds cannot produce an admission claim", () => {
  for (const weights of [[], [0, 0], [-1, 2], [NaN], [Infinity]]) {
    assert.throws(() => reachCapacityBound(weights, 64, .99));
  }
  for (const limit of [0, -1, 1.5, Infinity]) assert.throws(() => reachCapacityBound([1], limit, .99));
  for (const target of [0, 1.01, NaN]) assert.throws(() => reachCapacityBound([1], 64, target));
});
