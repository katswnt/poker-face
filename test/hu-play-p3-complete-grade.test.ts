import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { smallTurnRequest } from "./helpers/hu-play-turn";
import { buildNestedTurnSpot } from "../src/lib/hu-play/turn-tree";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";

test("P3 complete-turn sample gate matches the actual exported policy and independently checks its quality", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("scripts/audit-hu-play-p3-turn-grades.ts"), "Complete-turn P3 sample audit required");
  const { checkCompleteTurnReference, P3_COMPLETE_TURN_SAMPLE_SEEDS } = await import("../scripts/audit-hu-play-p3-turn-grades");
  assert.deepEqual(P3_COMPLETE_TURN_SAMPLE_SEEDS, [0, 50, 100, 150]);
  const { bindings } = await loadWasm(), partial = buildNestedTurnSpot(smallTurnRequest(), { type: "bet", to: 37 });
  const full = { ...partial, solve: { ...partial.solve, exportScope: "full" as const } };
  const reference = runWasmSpot(bindings, partial), result = runWasmSpot(bindings, full);
  assert.ok(checkCompleteTurnReference(full, result, reference).exploitabilityPctPot <= .3);
  assert.throws(() => checkCompleteTurnReference(partial, reference, reference), /complete/i);
  assert.throws(() => checkCompleteTurnReference(full, result, { ...reference, iterations: reference.iterations + 1 }));
  const lie = { chips: 0, pctPot: 0 };
  assert.throws(() => checkCompleteTurnReference(full, { ...result, exploitability: { ...result.exploitability, ...lie } },
    { ...reference, exploitability: { ...reference.exploitability, ...lie } }), /independent|tolerance/i);
});
