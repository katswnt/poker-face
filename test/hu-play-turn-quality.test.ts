import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { smallTurnRequest } from "./helpers/hu-play-turn";
import { applyPublicEvent } from "../src/lib/hu-play/public-state";
import { buildNestedTurnSpot, buildTurnResponseSpot } from "../src/lib/hu-play/turn-tree";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";

test("P3 all-in response quality independently checks complete policies and preserves negative raw float32 residuals", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/solver/bridge/live/turn-quality.ts"), "Independent complete-turn quality gate required");
  const { requireTurnPlayingResult } = await import("../src/lib/solver/bridge/live/turn-quality");
  const { bindings } = await loadWasm(), root = smallTurnRequest();
  const after = { ...root, publicState: applyPublicEvent(root.publicState,
    { kind: "action", player: 0, action: { type: "bet", to: 1800 } }) };
  const spot = buildTurnResponseSpot(after), hash = hashBridgeSpot(spot), result = runWasmSpot(bindings, spot);
  const residual = (chips: number): BridgeResultV1 => ({ ...result, exploitability: { ...result.exploitability,
    chips: Math.fround(chips), pctPot: Math.fround(chips) / spot.startingPot * 100 } });
  const raw = residual(-.00003), checked = requireTurnPlayingResult(raw, spot, hash);
  assert.equal(checked.result, raw, "Never clamp or relabel raw engine results");
  assert.ok(checked.quality && checked.quality.independentChips >= 0);
  assert.equal(checked.quality.comparisonToleranceChips, .0002);
  assert.ok(checked.exploitabilityPctPot >= 0 && checked.exploitabilityPctPot <= .3);
  assert.throws(() => requireTurnPlayingResult(residual(-.001), spot, hash), /independent|tolerance|disagree/i);
  assert.throws(() => requireTurnPlayingResult({ ...raw, engine: { ...raw.engine, threads: 2 } }, spot, hash), /quality|precision/i);
  assert.throws(() => requireTurnPlayingResult({ ...raw, exploitability: { ...raw.exploitability, reached: false } }, spot, hash), /quality|target/i);
  const decision = raw.tree.find(n => n.kind === "player" && n.actions.length === 2);
  assert.ok(decision?.kind === "player");
  const bad = { ...raw, tree: raw.tree.map(n => n === decision
    ? { ...decision, strategy: [decision.strategy[1], decision.strategy[0]] } : n) };
  assert.throws(() => requireTurnPlayingResult(bad, spot, hash), /independent|target|disagree/i);
  const partialSpot = buildNestedTurnSpot(root, { type: "bet", to: 37 }), partial = runWasmSpot(bindings, partialSpot);
  assert.throws(() => requireTurnPlayingResult({ ...partial, exploitability: { ...partial.exploitability,
    chips: Math.fround(-.00003), pctPot: Math.fround(-.00003) / partialSpot.startingPot * 100 } }, partialSpot, hashBridgeSpot(partialSpot)), /complete|terminal|truncated/i);
});
