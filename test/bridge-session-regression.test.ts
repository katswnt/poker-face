// Numerical fingerprints from the preserved PRE-W1 native binary (8866180's bridge).
// Timings/RSS are excluded; all tree, strategy, EV, grade/checkpoint and slice data remain.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { isomorphismProbeSpot } from "../src/lib/solver/bridge/referee-node";
import type { BridgeSlicePlanV1 } from "../src/lib/solver/bridge/contract";

test("resumable native bridge preserves pre-W1 numerical results and slice exports", {
  skip: existsSync(BRIDGE_BINARY) ? false : "run npm run build:bridge",
}, async () => {
  const slices: BridgeSlicePlanV1 = { format: "poker-face-bridge-slices", version: 1, flop: { maxDepth: null },
    turn: { cards: ["2c", "Ah"], maxDepth: 2, maxPriorRaises: 0 },
    river: { boards: [["2c", "3d"]], maxDepth: 2, maxPriorRaises: 0 },
    subtrees: [["b25", "c", "2c", "b25", "c", "3d"]], equity: true };
  const cases = [
    { spot: buildBridgeFixture("referee-river-v3-demo"), hash: "d08f66f5158ad9880366672162fa8dac5ff01f2d453d5f1981c357740aa66b72" },
    { spot: buildBridgeFixture("referee-turn-v2-dry-value"), hash: "2f2c26b9590a955fbed7779ad91fcc7031d654552222d4c74993e8dba2519977" },
    { spot: buildBridgeFixture("referee-flop-reference"), slices, hash: "94b86eea51465c7e88503068fac442106d0a022f7cbb587a6dd40a730a7e0cdf" },
    { spot: isomorphismProbeSpot(), hash: "6d3369547d22cdaf2badee35bcfba610dd02365ebe01d8def1f515b8d60754fc" },
  ];
  for (const item of cases) {
    const { result } = await runBridgeSpot(item.spot, { threads: 1, slices: item.slices });
    const { timings, memory, ...math } = result;
    void timings; void memory;
    const projection = { ...math, convergence: result.convergence.map(({ iteration, exploitability }) => ({ iteration, exploitability })) };
    assert.equal(createHash("sha256").update(JSON.stringify(projection)).digest("hex"), item.hash, item.spot.id);
  }
});
