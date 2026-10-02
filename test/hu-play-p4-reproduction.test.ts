import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { smallTurnRequest } from "./helpers/hu-play-turn";
import { buildNestedTurnSpot } from "../src/lib/hu-play/turn-tree";

test("P4 fresh-build reproduction requires every numerical cell, not binary-path identity or a rounded score", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("scripts/reproduce-hu-play-p4.ts"), "P4 needs fresh-build reproduction without rewriting frozen inputs");
  const { checkP4ReproducedPolicy } = await import("../scripts/reproduce-hu-play-p4");
  const { bindings } = await loadWasm(), spot = buildNestedTurnSpot(smallTurnRequest(), { type: "bet", to: 37 });
  const original = runWasmSpot(bindings, spot), fresh = runWasmSpot(bindings, spot);
  assert.doesNotThrow(() => checkP4ReproducedPolicy(spot, fresh, original));
  const altered = structuredClone(fresh);
  // A valid-looking policy score cannot excuse one altered action probability.
  const node = altered.tree.find(n => n.kind === "player" && n.actions.length > 1);
  assert.ok(node && node.kind === "player");
  const hand = node.strategy[0].findIndex(v => v !== null); assert.ok(hand >= 0);
  const old = node.strategy[0][hand]!;
  Object.assign(node.strategy[0], { [hand]: old > .5 ? old - .001 : old + .001 });
  assert.throws(() => checkP4ReproducedPolicy(spot, altered, original));
  assert.throws(() => checkP4ReproducedPolicy(spot, { ...fresh,
    exploitability: { ...fresh.exploitability, reached: false } }, original), /quality|target|numerical/i);
  assert.throws(() => checkP4ReproducedPolicy({ ...spot, startingPot: spot.startingPot + 1 }, fresh, original));
});
