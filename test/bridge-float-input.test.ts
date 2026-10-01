import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { WASM_BUILD_ROOT, compareBridgeResults, loadWasm, runWasmSpot } from "../scripts/bridge-wasm-runner";
import { validateBridgeSpot } from "../src/lib/solver/bridge/contract";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";

function weightedFixture() {
  const fixture = buildBridgeFixture("referee-river-v3-demo");
  return validateBridgeSpot({ ...fixture, ranges: fixture.ranges.map(range => ({ ...range,
    combos: range.combos.map((combo, i) => ({ ...combo, weight: Math.fround([.03, .07, .333, .66, 1][i % 5]) })) })),
    solve: { ...fixture.solve, maxIterations: 20, targetExploitabilityPctPot: 1e-9 } });
}

test("native JSON accepts exact float32 decimal weights without modifying their canonical spot", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  const spot = weightedFixture(), json = canonicalBridgeSpotJson(spot);
  assert.ok(json.includes("0.029999999329447746"));
  const { result } = await runBridgeSpot(spot, { threads: 1 });
  assert.equal(result.spotHash, hashBridgeSpot(spot));
  assert.equal(result.iterations, 20);
  assert.equal(result.engine.precision, "float32");
  assert.equal(canonicalBridgeSpotJson(spot), json);
});

test("weighted native and WASM solves retain exact numerical parity with strict JSON inputs", {
  skip: existsSync(BRIDGE_BINARY) && existsSync(join(WASM_BUILD_ROOT, "manifest.json")) ? false : "build:bridge and build:wasm required",
}, async () => {
  const spot = weightedFixture(), native = await runBridgeSpot(spot, { threads: 1 });
  const { bindings } = await loadWasm(), wasm = runWasmSpot(bindings, spot);
  assert.ok(Object.values(compareBridgeResults(native.result, wasm)).every(delta => delta === 0));
  const invalid = structuredClone(spot);
  const bytes = new TextEncoder().encode(JSON.stringify({ ...invalid, ranges: invalid.ranges.map((r, p) => p === 0
    ? { ...r, combos: r.combos.map((c, h) => h === 0 ? { ...c, weight: .03 } : c) } : r) }));
  assert.throws(() => new bindings.SolverSession(bytes), /float32-exact/);
});
