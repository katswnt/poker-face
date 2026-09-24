import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { buildGameTreeIndex, uniformStrategy } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { solveCompactCfr } from "../src/lib/solver/river/compact/cfr";
import { createVectorKernelScratch } from "../src/lib/solver/postflop/vector/kernels";
import { FLOP_REFERENCE_REQUEST, FLOP_WIDE_REQUEST } from "../src/lib/solver/postflop/flop/fixtures";
import { createFlopReference } from "../src/lib/solver/postflop/flop/reference";
import { compileVectorFlop, FLOP_PLAYER, preflightVectorFlop } from "../src/lib/solver/postflop/flop/compiled";
import { compileFlopRanges, flopTerminalValues } from "../src/lib/solver/postflop/flop/ranges";
import { createVectorFlopSession, restoreVectorFlopSession, validateFlopPolicy } from "../src/lib/solver/postflop/flop/session";
import { gradeVectorFlop } from "../src/lib/solver/postflop/flop/scorekeeper";
import { decodeFlopPolicy, encodeFlopPolicy } from "../src/lib/solver/postflop/flop/policy";
import { flopInformationKey } from "../src/lib/solver/postflop/flop/rules";
import { verifyFlopReferenceArtifactHash, type FlopReferenceArtifact } from "../src/lib/solver/postflop/flop/artifact-node";
const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test("flop board-local kernels agree with explicit pairs on every visible board, both players and folds", () => {
  const request = { ...FLOP_REFERENCE_REQUEST, rangeText: ["AsQs:0.3 KdKh QsJs 9h9d:0.1", "QsJs 9h9d:0.2 8c8h AsQs:0.4"] as const };
  const ranges = compileFlopRanges(request);
  assert.equal(ranges.boards.length, 2402);
  for (let board = 0; board < ranges.boards.length; board++) for (const player of [0, 1] as const) {
    const own = ranges.players[player], other = ranges.players[1 - player];
    const weights = Float64Array.from(other.weights, (w, j) => w * ((board + j) % 5) / 4), masked = new Float64Array(weights.length);
    const a = new Float64Array(own.hands.length), b = a.slice(), scratch = createVectorKernelScratch(other.hands.length);
    for (const fold of ranges.boards[board].river ? [-1, 0, 1] : [-1, 1]) {
      flopTerminalValues(ranges, player, board, weights, 125, fold, a, scratch, masked);
      flopTerminalValues(ranges, player, board, weights, 125, fold, b, scratch, masked, true);
      a.forEach((v, i) => near(v, b[i], 1e-10));
    }
  }
});

test("numeric flop topology and uniform grade agree with the repeated reference", () => {
  const request = { ...FLOP_REFERENCE_REQUEST, rangeText: ["AsQs KdKh:0.4", "9h9d"] as const, stackBehind: [1, 2] as const, betSizes: [1, 1, 1] as const };
  const reference = createFlopReference(request), index = buildGameTreeIndex(reference), game = compileVectorFlop(request);
  assert.equal(game.informationSets, index.informationSets.length);
  for (const key of ["totalStates", "chanceNodes", "decisionNodes", "terminalNodes"] as const) assert.equal(game.preflight.equivalentCounts[key], index[key]);
  const uniform = uniformStrategy(index), encoded = encodeFlopPolicy(game, uniform);
  assert.deepEqual(decodeFlopPolicy(game, encoded), uniform);
  const a = gradeStrategy(reference, uniform, index), b = gradeVectorFlop(game, encoded), c = gradeVectorFlop(game, encoded, true);
  for (const p of [0, 1]) { near(a.value[p], b.value[p]); near(a.bestResponses[p].value, b.bestResponses[p].value); near(b.bestResponses[p].value, c.bestResponses[p].value); }
});

test("vector flop ordinary/CFR+ complete policies and regrets match unchanged repeated compact math", () => {
  const request = { ...FLOP_REFERENCE_REQUEST, rangeText: ["AsQs", "9h9d"] as const, stackBehind: [1, 1] as const, betSizes: [1, 1, 1] as const };
  const reference = createFlopReference(request), game = compileVectorFlop(request);
  for (const algorithm of ["vanilla", "cfr-plus"] as const) for (const iterations of [1, 2, 10, 100]) {
    const options = { iterations, algorithm, averagingDelay: algorithm === "vanilla" ? 0 : 2 };
    const session = createVectorFlopSession(game, options); session.advance(iterations);
    const result = solveCompactCfr(reference, options), decoded = decodeFlopPolicy(game, session.snapshot().policy), state = session.checkpoint();
    for (const [key, row] of result.averageStrategy) row.probabilities.forEach((v, a) => near(v, decoded.get(key)!.probabilities[a], 1e-9));
    for (let n = 0; n < game.kinds.length; n++) {
      if (game.kinds[n] !== FLOP_PLAYER) continue;
      const p = game.players[n] as 0 | 1, own = game.ranges.boards[game.boards[n]].view.players[p];
      for (let h = 0; h < own.hands.length; h++) {
        if (!own.compatibleCounts[h]) continue;
        const key = flopInformationKey(request, game.states[n], p, own.hands[h]);
        result.cumulativeRegrets.get(key)!.forEach((v, a) => near(v, state.regrets[game.actionStarts[n] + 2 * h + a], 1e-9 * iterations * 51));
      }
    }
  }
});

test("flop sessions chunk and restore bit-identically; detached snapshots and malformed state are safe", () => {
  const game = compileVectorFlop({ ...FLOP_REFERENCE_REQUEST, rangeText: ["AsQs", "9h9d"] as const, stackBehind: [1, 1], betSizes: [1, 1, 1] });
  const options = { iterations: 10, algorithm: "cfr-plus" as const, averagingDelay: 2 };
  const a = createVectorFlopSession(game, options), b = createVectorFlopSession(game, options);
  a.advance(10); b.advance(3); const saved = b.checkpoint(), restored = restoreVectorFlopSession(game, saved);
  const snapshot = b.snapshot(); snapshot.policy.fill(NaN); saved.regrets.fill(NaN);
  b.advance(2); b.advance(5); restored.advance(7);
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.deepEqual(a.snapshot(), restored.snapshot());
  assert.throws(() => restoreVectorFlopSession(game, saved), /bounds/);
  assert.throws(() => restoreVectorFlopSession(game, { ...a.checkpoint(), gameIdentity: "other" }), /identity/);
  assert.throws(() => restoreVectorFlopSession(game, { ...a.checkpoint(), iterations: 11 }), /iteration/);
  assert.throws(() => validateFlopPolicy(game, snapshot.policy), /probabilities/);
  const padding = a.snapshot().policy; let slot = -1;
  for (let n = 0; n < game.kinds.length; n++) if (game.kinds[n] === FLOP_PLAYER) {
    const p = game.players[n], own = game.ranges.boards[game.boards[n]].view.players[p];
    const h = own.hands.findIndex((_, i) => !own.compatibleCounts[i]); if (h >= 0) { slot = game.actionStarts[n] + 2 * h; break; }
  }
  assert.ok(slot >= 0); padding[slot] = 1; assert.throws(() => validateFlopPolicy(game, padding), /padding/);
  for (const n of [0, -1, NaN, 0.5]) assert.throws(() => a.advance(n), /positive/);
});

test("weighted hidden-range and unequal-stack flop updates agree across both algorithms", () => {
  const request = { ...FLOP_REFERENCE_REQUEST, board: ["As", "7d", "4h"] as const,
    rangeText: ["AcAd:0.3 8c8d", "8c7c QsJs:2"] as const, stackBehind: [2, 3] as const, betSizes: [1, 2, 3] as const };
  const reference = createFlopReference(request), game = compileVectorFlop(request);
  for (const algorithm of ["vanilla", "cfr-plus"] as const) {
    const options = { iterations: 3, algorithm, averagingDelay: algorithm === "vanilla" ? 0 : 1 };
    const session = createVectorFlopSession(game, options); session.advance(3);
    const result = solveCompactCfr(reference, options), decoded = decodeFlopPolicy(game, session.snapshot().policy);
    for (const [key, row] of result.averageStrategy) row.probabilities.forEach((v, i) => near(v, decoded.get(key)!.probabilities[i], 1e-9));
    const expected = gradeStrategy(reference, result.averageStrategy, result.index), actual = gradeVectorFlop(game, session.snapshot().policy);
    near(expected.value[0], actual.value[0]); near(expected.exploitability, actual.exploitability);
  }
});

test("accepted reference artifact regrades independently through the flop vector backend", () => {
  const artifact = JSON.parse(readFileSync("src/lib/solver/postflop/flop/artifacts/heads-up-flop-v1.json", "utf8")) as FlopReferenceArtifact;
  assert.ok(verifyFlopReferenceArtifactHash(artifact)); assert.ok(artifact.acceptance.passed);
  const reference = createFlopReference(artifact.request), index = buildGameTreeIndex(reference), game = compileVectorFlop(artifact.request);
  const policy = encodeFlopPolicy(game, deserializeBehavioralStrategy(index, artifact.strategy)), grade = gradeVectorFlop(game, policy);
  for (const p of [0, 1]) { near(grade.value[p], artifact.value[p]); near(grade.bestResponses[p].value, artifact.bestResponseValues[p]); }
});

test("wide flop preflight earns 64 hands per player without allocating a repeated tree", () => {
  const preflight = preflightVectorFlop(FLOP_WIDE_REQUEST);
  assert.deepEqual(preflight.rangeEntries, [64, 64]); assert.ok(preflight.compatibleDeals >= 2000);
  assert.ok(preflight.estimatedPeakBytes < 2 * 1024 ** 3); assert.ok(preflight.equivalentCounts.totalStates > 100000000);
  assert.throws(() => preflightVectorFlop(FLOP_WIDE_REQUEST, 1024), /estimates/);
  assert.throws(() => preflightVectorFlop({ ...FLOP_WIDE_REQUEST, rangeText: ["AA KK QQ JJ TT 99 88 77 66 55 44 33 22", "AsKs"] }), /64 hands/);
});
