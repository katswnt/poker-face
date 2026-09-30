// Frozen independent gates, plus native-vs-WASM measurement. No widened tolerances.
import assert from "node:assert/strict";
import { runBridgeSpot } from "./bridge-runner";
import { compareBridgeResults, loadWasm, runWasmSpot } from "./bridge-wasm-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { BRIDGE_FLOAT32_TOLERANCE_CHIPS, refereeGates, refereeRangeMismatches, refereeWalk } from "../src/lib/solver/bridge/referee";
import { REFEREE_GAMES, isomorphismProbeSpot, ISOMORPHISM_PROBE_REQUEST, ISOMORPHISM_PROBE_MAXIMUM_EXPLOITABILITY,
  turnV2RefereeEngine } from "../src/lib/solver/bridge/referee-node";

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--measure"), "Usage: audit:wasm [-- --measure]");
  const measure = args[0] === "--measure";
  const { bindings, manifest } = await loadWasm();
  const cases = [...REFEREE_GAMES.map(item => ({ ...item, spot: buildBridgeFixture(item.id) })), {
    id: "probe-turn-v2-suit-isomorphism", spot: isomorphismProbeSpot(), bounds: null,
    engine: () => turnV2RefereeEngine(ISOMORPHISM_PROBE_REQUEST),
  }];
  const rows = [];
  for (const item of cases) {
    const engine = item.engine();
    assert.deepEqual(refereeRangeMismatches(engine, item.spot), []);
    for (const iterations of (measure ? [10, 30, 100, 300, 1000] : [null])) {
      const spot = iterations === null ? item.spot : { ...item.spot, solve: { ...item.spot.solve,
        maxIterations: iterations, targetExploitabilityPctPot: 1e-9 } };
      const native = (await runBridgeSpot(spot, { threads: 1 })).result;
      const wasm = runWasmSpot(bindings, spot);
      const deltas = compareBridgeResults(native, wasm);
      // W1's stronger empirical gate: investigate ANY nonzero native/WASM difference on
      // these fixtures. This is not a claim of universal cross-platform bit identity.
      assert.ok(Object.values(deltas).every(v => v === 0), `Native/WASM drift: ${JSON.stringify(deltas)}`);
      const walk = refereeWalk(engine, wasm);
      assert.deepEqual(walk.mismatches, []);
      const ours = engine.grade(walk.policy);
      const gates = refereeGates(wasm, ours, BRIDGE_FLOAT32_TOLERANCE_CHIPS, iterations === null ? item.bounds : null);
      assert.deepEqual(gates.failures, []);
      if (iterations === null) {
        assert.ok(wasm.exploitability.reached);
        if (!item.bounds) {
          assert.ok(ours.exploitability <= ISOMORPHISM_PROBE_MAXIMUM_EXPLOITABILITY);
          assert.ok(walk.stats.nonRepresentativeChildren > 0);
        }
      }
      const row = { game: item.id, iterations: wasm.iterations, nodes: wasm.tree.length,
        nativeVsWasm: deltas, selfExploitability: wasm.exploitability.chips,
        independentExploitability: ours.exploitability, refereeDeltas: gates.deltas };
      rows.push(row); console.log(JSON.stringify(row));
    }
  }
  if (!measure) {
    // Larger upstream turn demo: parity smoke only, NOT independently certified by B2.
    const spot = buildBridgeFixture("smoke-upstream-basic");
    const native = (await runBridgeSpot(spot, { threads: 1 })).result;
    const wasm = runWasmSpot(bindings, spot);
    const deltas = compareBridgeResults(native, wasm);
    assert.ok(Object.values(deltas).every(v => v === 0), `Upstream demo drift: ${JSON.stringify(deltas)}`);
    assert.ok(wasm.exploitability.reached);
    console.log(JSON.stringify({ game: spot.id, paritySmokeOnly: true, iterations: wasm.iterations,
      nativeVsWasm: deltas, selfExploitability: wasm.exploitability.chips }));
  }
  console.log(JSON.stringify({ audit: "wasm-st", passed: true, buildHash: manifest.buildHash, cases: rows.length,
    toleranceChips: BRIDGE_FLOAT32_TOLERANCE_CHIPS }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
