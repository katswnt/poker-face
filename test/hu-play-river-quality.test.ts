import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { buildNestedRiverSpot } from "../src/lib/hu-play/river-tree";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";

test("P2 independently verifies the played policy, retaining raw float32 scores without weakening the target", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/solver/bridge/live/river-quality.ts"), "Independent P2 quality gate required");
  const { requireRiverPlayingResult } = await import("../src/lib/solver/bridge/live/river-quality");
  const { bindings } = await loadWasm(), root = loadP1ProductionRoots()[0], aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  const spot = buildNestedRiverSpot(q, { type: "bet", to: 101 });
  const result = runWasmSpot(bindings, spot), hash = hashBridgeSpot(spot);
  const checked = requireRiverPlayingResult(result, spot, hash);
  assert.equal(checked.result, result); assert.ok(checked.quality.independentChips >= 0);
  assert.ok(checked.quality.independentChips <= result.exploitability.target);
  const altered = (chips: number): BridgeResultV1 => ({ ...result, exploitability: { ...result.exploitability,
    chips: Math.fround(chips), pctPot: Math.fround(chips) / spot.startingPot * 100 } });
  assert.throws(() => requireRiverPlayingResult(altered(-.001), spot, hash), /independent|disagree|negative/i);
  assert.throws(() => requireRiverPlayingResult(altered(result.exploitability.target + 1), spot, hash), /target|quality/i);
  assert.throws(() => requireRiverPlayingResult({ ...result, engine: { ...result.engine, threads: 2 } }, spot, hash), /precision|quality/i);
  assert.throws(() => requireRiverPlayingResult({ ...result, exploitability: { ...result.exploitability, reached: false } }, spot, hash), /target|quality/i);
});
