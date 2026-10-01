import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import frozen from "../tasks/artifacts/hu-play-p1-admission.json";
import { loadP1WideRoots, nativeMeasurementSpot, selectRatioCases, summarizeNativeRun } from "../scripts/hu-play-wide-corpus";
import { estimateWideSpot } from "../scripts/measure-hu-play-wide-native";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";

test("wide feasibility reconstructs all frozen full-range P1 roots, rivers first, without private cards", () => {
  const roots = loadP1WideRoots();
  assert.equal(roots.length, 64);
  assert.deepEqual(roots.map(r => r.corpusIndex), [...Array.from({ length: 32 }, (_, i) => i + 32), ...Array.from({ length: 32 }, (_, i) => i)]);
  for (const r of roots) {
    const original = frozen.corpus[r.corpusIndex];
    assert.equal(r.sourceSpotHash, original.spotHash);
    assert.equal(hashBridgeSpot(r.spot), original.spotHash);
    assert.deepEqual(r.spot.ranges.map(range => range.combos.length), original.capacity.map(p => p.totalHands));
    assert.equal(r.spot.startingPot, original.pot);
    assert.equal(r.spot.effectiveStack, original.stack);
    assert.doesNotMatch(JSON.stringify(r), /"(?:aiHand|humanHand|runout|deal|reveal)"/);
  }
  assert.equal(roots.find(r => r.corpusIndex === 0)!.spot.effectiveStack / roots.find(r => r.corpusIndex === 0)!.spot.startingPot, 9750 / 550);
});

test("offline measurement raises only research budgets, never edits ranges, target, menu or precision", () => {
  const original = buildBridgeFixture("referee-river-v3-demo"), copy = structuredClone(original);
  const measured = nativeMeasurementSpot(original);
  const { solve: oldSolve, ...oldGame } = original, { solve, ...game } = measured;
  assert.deepEqual(game, oldGame);
  assert.equal(solve.targetExploitabilityPctPot, oldSolve.targetExploitabilityPctPot);
  assert.equal(solve.compression, "off");
  assert.equal(solve.exportScope, "first-street");
  assert.equal(solve.maxIterations, 10_000);
  assert.equal(solve.timeoutMs, 30 * 60_000);
  assert.equal(solve.memoryCapBytes, 4 * 1024 ** 3);
  assert.deepEqual(original, copy);
});

test("ratio selection is fixed by estimated storage, not measured speed or convergence", () => {
  const rows = [100, 20, 40, 30, 40, 10].map((estimatedBytes, corpusIndex) => ({ corpusIndex, street: "river" as const, estimatedBytes }));
  const selected = selectRatioCases(rows);
  assert.deepEqual(selected.map(r => r.corpusIndex), [5, 2, 0]);
  assert.deepEqual(selectRatioCases([...rows].reverse()), selected);
  assert.throws(() => selectRatioCases([...rows, rows[0]]), /duplicate/i);
  assert.throws(() => selectRatioCases([{ ...rows[0], estimatedBytes: NaN }]), /estimate/i);
});

test("native measurement summary independently checks percent, target, precision and thread count", () => {
  const spot = nativeMeasurementSpot(buildBridgeFixture("referee-river-v3-demo"));
  // A summary cannot certify an unchecked partial result or a multithread timing run.
  assert.throws(() => summarizeNativeRun(spot, { result: { engine: { threads: 4 } } } as never), /thread|invalid|result/i);
});

test("native measurements expose correct arithmetic and absent RSS samples, with an independent river grade", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  const spot = nativeMeasurementSpot(buildBridgeFixture("referee-river-v3-demo"));
  const run = await runBridgeSpot(spot, { threads: 1 });
  const summary = summarizeNativeRun(spot, { ...run, sampledPeakRssBytes: 0 });
  assert.equal(summary.sampledPeakRssBytes, null, "an unsampled short job has unknown sampled RSS, not zero peak memory");
  assert.equal(summary.exploitabilityPctPot, Math.fround(run.result.exploitability.chips) / spot.startingPot * 100);
  assert.equal(summary.resultJsonBytes, Buffer.byteLength(JSON.stringify(run.result)));
  const badPercent = { ...run, result: { ...run.result, exploitability: { ...run.result.exploitability,
    pctPot: run.result.exploitability.pctPot + 1 } } };
  assert.throws(() => summarizeNativeRun(spot, badPercent), /percent|pct|exploitability|result/i);
  const grade = gradeRiverSubgame({ startingPot: spot.startingPot, hands: run.result.hands,
    subtree: { path: [], nodes: run.result.tree, reach: [spot.ranges[0].combos.map(c => c.weight), spot.ranges[1].combos.map(c => c.weight)],
      ev: run.result.root.engineEv } });
  assert.ok(Math.abs(grade.ours.exploitability - run.result.exploitability.chips) < .0002);
  assert.ok(Math.abs(grade.ours.value[0] - grade.theirs.value[0]) < .0002);
});

test("native estimate measures a whole-range input without launching a solve", { skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required" }, async () => {
  const spot = buildBridgeFixture("referee-river-v3-demo");
  const row = await estimateWideSpot(spot);
  assert.equal(row.estimate.spotHash, hashBridgeSpot(spot));
  assert.deepEqual(row.estimate.hands, spot.ranges.map(r => r.combos.length));
  assert.ok(row.estimate.estimatedBytes > 0);
  assert.equal(row.strategyStorageAllocated, false);
  assert.equal(row.iterations, 0);
  assert.deepEqual(row.command, ["estimate"]);
  assert.ok(row.wallMs >= 0);
});

test("native percent arithmetic recovers the engine f32 from its shortest JSON decimal", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  const spot = nativeMeasurementSpot(loadP1WideRoots()[0].spot);
  const run = await runBridgeSpot(spot, { threads: 1 });
  assert.notEqual(run.result.exploitability.chips, Math.fround(run.result.exploitability.chips), "fixture exercises shortest-f32 serialization");
  const summary = summarizeNativeRun(spot, run);
  assert.equal(summary.exploitabilityChips, Math.fround(run.result.exploitability.chips));
  assert.equal(summary.exploitabilityPctPot, Math.fround(run.result.exploitability.chips) / spot.startingPot * 100);
  assert.equal(summary.exploitabilityPctPot, run.result.exploitability.pctPot);
});
