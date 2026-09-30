import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadWasm, runWasmSpot } from "./bridge-wasm-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { REFEREE_GAMES } from "../src/lib/solver/bridge/referee-node";
import { BRIDGE_FLOAT32_TOLERANCE_CHIPS, refereeGates, refereeWalk } from "../src/lib/solver/bridge/referee";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { rootSummary } from "../src/lib/solver/bridge/live/view";

async function main() {
  const mode = process.argv[2]; assert.ok(mode === "--write" || mode === "--check");
  const id = "referee-turn-v2-dry-value", base = buildBridgeFixture(id);
  const spot = { ...base, solve: { ...base.solve, maxIterations: 1000, timeoutMs: 120000 } };
  const { bindings } = await loadWasm(), result = runWasmSpot(bindings, spot);
  const fixture = REFEREE_GAMES.find(g => g.id === id)!, engine = fixture.engine(), walk = refereeWalk(engine, result);
  assert.deepEqual(walk.mismatches, []);
  const grade = engine.grade(walk.policy), gates = refereeGates(result, grade, BRIDGE_FLOAT32_TOLERANCE_CHIPS, fixture.bounds);
  assert.deepEqual(gates.failures, []);
  const payload = { format: "poker-face-live-example", version: 1, spot, summary: rootSummary(result),
    independent: { exploitability: grade.exploitability, value0: grade.value[0], toleranceChips: BRIDGE_FLOAT32_TOLERANCE_CHIPS,
      source: fixture.artifactPayloadHash } };
  const payloadHash = createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
  const json = JSON.stringify({ ...payload, payloadHash }, null, 2) + "\n";
  const path = "src/lib/solver/bridge/live/example.json";
  if (mode === "--write") writeFileSync(path, json); else assert.equal(readFileSync(path, "utf8"), json, "Saved live example must reproduce byte for byte");
  console.log(JSON.stringify({ audit: "live-example", passed: true, payloadHash, iterations: result.iterations,
    selfReported: result.exploitability.chips, independent: grade.exploitability }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
