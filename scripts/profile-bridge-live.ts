// Controlled Node/WASM grid for W2 admission; NOT a process-RSS/mobile safety measurement.
import assert from "node:assert/strict";
import { loadWasm, wasmSpotBytes } from "./bridge-wasm-runner";
import { canonicalBridgeCombo, compareBridgeCombos, validateBridgeSpot, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { parseLiveSpot, parseLiveEstimate, admitBrowserSolve } from "../src/lib/solver/bridge/live/admission";
import { RIVER_DECK } from "../src/lib/solver/river/cards";

async function main() {
  const { bindings, memory } = await loadWasm();
  for (const street of ["river", "turn"] as const) for (const width of [4, 16, 64])
    for (const scope of ["full", "first-street"] as const) for (const wide of [false, true]) {
    const board = { flop: ["Kd", "8c", "4h"] as const, turn: "2s", river: street === "river" ? "9d" : null };
    const used = new Set([...board.flop, board.turn, board.river]);
    const deck = RIVER_DECK.filter(c => !used.has(c));
    const combos = deck.flatMap((a, i) => deck.slice(i + 1).map(b => canonicalBridgeCombo(a, b)))
      .sort(compareBridgeCombos);
    // Reproducible spread through the deck; equal ranges retain symmetry and suit blockers.
    const range = Array.from({ length: width }, (_, i) => ({ combo: combos[Math.floor(i * combos.length / width)], weight: 1 }));
    const options = { bet: wide ? [{ kind: "pot", pct: 25 }, { kind: "pot", pct: 100 }] : [{ kind: "pot", pct: 50 }],
      raise: wide ? [{ kind: "prevBet", multiple: 2 }] : [] };
    const menu = { oop: options, ip: options };
    const s: BridgeSpotV1 = validateBridgeSpot({ format: "poker-face-bridge-spot", version: 1, id: `w2-${street}-${width}-${scope}-${wide ? "wide" : "small"}`,
      board, ranges: [{ source: "W2 synthetic measurement grid, not a poker range recommendation", combos: range },
        { source: "W2 synthetic measurement grid, not a poker range recommendation", combos: range }], startingPot: 100, effectiveStack: wide ? 1000 : 100, rake: 0,
      tree: { mode: "menu", flop: null, turn: street === "turn" ? menu : null, river: menu, turnDonk: null, riverDonk: null,
        maxRaisesPerStreet: wide ? 1 : 0, addAllInThreshold: 0, forceAllInThreshold: 0, mergingThreshold: 0 },
      solve: { compression: "off", exportScope: scope, timeoutMs: 120000, maxIterations: 10, memoryCapBytes: 256 * 1024 ** 2, targetExploitabilityPctPot: 1e-9 } });
    parseLiveSpot(JSON.stringify(s));
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
