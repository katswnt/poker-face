import assert from "node:assert/strict";
import test from "node:test";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { canonicalBridgeSpotJson } from "../src/lib/solver/bridge/contract-node";
import { parseLiveSpot, LIVE_LIMITS } from "../src/lib/solver/bridge/live/admission";
import { createWideResearchParser, mathProjection, timingRatio, summarizeWideEvents, wideStudyHtml } from "../scripts/hu-play-wide-measurement";
import { loadP1WideRoots, nativeMeasurementSpot, ratioMeasurementSpot } from "../scripts/hu-play-wide-corpus";

test("research Worker parser accepts only exact frozen measurements, without relaxing production admission", () => {
  const root = loadP1WideRoots().find(r => r.corpusIndex === 0)!;
  const spot = nativeMeasurementSpot(root.spot), json = canonicalBridgeSpotJson(spot);
  const parse = createWideResearchParser([json]);
  assert.deepEqual(parse(json), spot);
  assert.throws(() => parseLiveSpot(json), /64 hands/);
  assert.equal(LIVE_LIMITS.rangeHands, 64);
  assert.equal(LIVE_LIMITS.timeoutMs, 120_000);
  assert.throws(() => parse(JSON.stringify({ ...spot, effectiveStack: spot.effectiveStack + 1 })), /frozen|allow/i);
  assert.throws(() => parse("{}"), /frozen|allow/i);
  assert.throws(() => createWideResearchParser([json, json]), /duplicate/i);
  const flop = canonicalBridgeSpotJson(buildBridgeFixture("referee-flop-reference"));
  assert.throws(() => createWideResearchParser([flop]), /turn|river/);
});

test("ratio jobs keep the full game and use a matched longer iteration budget, without a quality claim", () => {
  const original = buildBridgeFixture("referee-river-v3-demo"), spot = ratioMeasurementSpot(original);
  assert.deepEqual(spot.ranges, original.ranges);
  assert.deepEqual(spot.tree, original.tree);
  assert.equal(spot.solve.maxIterations, 1000);
  assert.equal(spot.solve.targetExploitabilityPctPot, 1e-9);
  assert.equal(spot.solve.compression, "off");
  assert.equal(ratioMeasurementSpot(buildBridgeFixture("referee-turn-v2-dry-value")).solve.maxIterations, 100);
});

test("speed ratios distinguish measured duration, quantization and unknown zero-denominator ratios", () => {
  assert.deepEqual(timingRatio(50, 200), { ratio: 4, quantizationLower: 199 / 51, quantizationUpper: 201 / 49 });
  assert.deepEqual(timingRatio(0, 20), { ratio: null, quantizationLower: 19, quantizationUpper: null });
  assert.equal(timingRatio(1, 20).quantizationUpper, null);
  assert.throws(() => timingRatio(-1, 20), /timing/i);
  assert.throws(() => timingRatio(1, NaN), /timing/i);
});

test("numerical projection removes only observational timing and memory, never strategy or convergence values", () => {
  const result = { timings: { solveMs: 123 }, memory: { peakRssBytes: 1234 }, spotHash: "same", tree: [{ strategy: [[.25, .75]] }],
    convergence: [{ iteration: 10, exploitability: .2, elapsedMs: 1 }] };
  const projection = mathProjection(result as never);
  assert.deepEqual(projection, { spotHash: "same", tree: result.tree, convergence: [{ iteration: 10, exploitability: .2 }] });
});

test("failed research jobs retain peak observations and stages instead of becoming successful measurements", () => {
  const summary = summarizeWideEvents([
    { type: "progress", stage: "building", elapsedMs: 5, observedLinearMemoryBytes: 65536 },
    { type: "estimate", verdict: { ok: true, totalBytes: 200000, budgetBytes: 300000 }, observedLinearMemoryBytes: 131072 },
    { type: "progress", stage: "exporting", elapsedMs: 20, observedLinearMemoryBytes: 196608 },
    { type: "error", message: "Export failed", observedLinearMemoryBytes: 262144 },
  ] as never, 25);
  assert.equal(summary.status, "error");
  assert.equal(summary.error, "Export failed");
  assert.equal(summary.peakLinearMemoryBytes, 262144);
  assert.equal(summary.iterations, null);
  assert.deepEqual(summary.stages, [{ stage: "building", elapsedMs: 5, linearMemoryBytes: 65536 },
    { stage: "exporting", elapsedMs: 20, linearMemoryBytes: 196608 }]);
  assert.equal(summarizeWideEvents([{ type: "error", message: "Parser failure" }] as never, 0).peakLinearMemoryBytes, null);
  assert.throws(() => summarizeWideEvents([], 0), /terminal/i);
});

test("private measurement page links the exact served source and license, with an explicit research label", () => {
  const base = `/wasm/${"a".repeat(64)}/`, html = wideStudyHtml(base);
  assert.ok(html.includes(`href="${base}source/BUILD.txt"`));
  assert.ok(html.includes(`href="${base}LICENSES.txt"`));
  assert.match(html, /research only/i); assert.match(html, /lang="en"/);
  assert.throws(() => wideStudyHtml('/wasm/"onload="evil/'), /asset/i);
});
