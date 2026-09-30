// Controlled Node/WASM grid for W2 admission; NOT a process-RSS/mobile safety measurement.
import assert from "node:assert/strict";
import { loadWasm, wasmSpotBytes } from "./bridge-wasm-runner";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { parseLiveEstimate, admitBrowserSolve } from "../src/lib/solver/bridge/live/admission";
import { buildLiveSizingGrid } from "./bridge-live-grid";

async function main() {
  const { bindings, memory } = await loadWasm();
  for (const s of buildLiveSizingGrid()) {
    const session = new bindings.SolverSession(wasmSpotBytes(s));
    try {
      const estimate = parseLiveEstimate(session.estimate(), s, hashBridgeSpot(s)), preflightBytes = memory.buffer.byteLength;
      const verdict = admitBrowserSolve(estimate, { profile: "unknown" }, preflightBytes);
      let jsonBytes: number | null = null, nodes: number | null = null;
      if (verdict.ok) {
        let status = JSON.parse(session.allocate()); while (!status.done) status = JSON.parse(session.step(10));
        const json = session.finish(), result = JSON.parse(json); jsonBytes = Buffer.byteLength(json); nodes = result.tree.length;
        assert.ok(jsonBytes <= estimate.estimateExport.jsonBytesUpperBound); assert.ok(nodes! <= estimate.estimateExport.nodes);
        assert.ok(memory.buffer.byteLength < verdict.totalBytes);
      }
      console.log(JSON.stringify({ id: s.id, admitted: verdict.ok, engineBytes: estimate.estimatedBytes,
        estimatedExport: estimate.estimateExport, reservedTotalBytes: verdict.totalBytes, preflightBytes,
        // Shared instance makes later high-water observations conservative, not per-job peaks.
        cumulativeLinearBytes: memory.buffer.byteLength, actualJsonBytes: jsonBytes, actualNodes: nodes }));
    } finally { session.free(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
