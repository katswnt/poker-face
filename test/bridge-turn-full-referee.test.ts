import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { refereeWalk } from "../src/lib/solver/bridge/referee";
import { turnV2RefereeEngine } from "../src/lib/solver/bridge/referee-node";
import { TURN_V2_CORPUS } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { canonicalBridgeCombo, compareBridgeCombos } from "../src/lib/solver/bridge/contract";
import { RIVER_DECK } from "../src/lib/solver/river/cards";
import { createVectorKernelScratch, naiveTerminalValues, vectorTerminalValues } from "../src/lib/solver/postflop/vector/kernels";

test("full 1,128-hand blocker/rank kernels match the quadratic oracle and preserve tiny compatible mass", async () => {
  assert.ok(existsSync("src/lib/solver/bridge/turn-referee.ts"));
  const { compileBridgeTurnRanges } = await import("../src/lib/solver/bridge/turn-referee");
  const base = buildBridgeFixture("referee-turn-v2-dry-value"), board = [...base.board.flop, base.board.turn!];
  const deck = RIVER_DECK.filter(c => !board.includes(c));
  const combos = deck.flatMap((a, i) => deck.slice(0, i).map(b => ({ combo: canonicalBridgeCombo(a, b), weight: 1 })))
    .sort((a, b) => compareBridgeCombos(a.combo, b.combo));
  const range = { source: "Full unblocked range for kernel verification", combos };
  const ranges = compileBridgeTurnRanges({ ...base, ranges: [range, range] });
  assert.equal(ranges.players[0].hands.length, 1128);
  assert.equal(ranges.compatibleDeals, 1128 * 1035);
  for (const p of [0, 1] as const) {
    const own = ranges.players[p], other = ranges.players[1 - p], scratch = createVectorKernelScratch(other.hands.length);
    for (const river of [-1, 0, 17, 47]) {
      const v = new Float64Array(1128), n = new Float64Array(1128);
      const weights = Float64Array.from(other.weights, (_, i) => (i % 13 + 1) / 16);
      for (const sign of river < 0 ? [1] : [-1, 0, 1]) {
        vectorTerminalValues(ranges, p, river, weights, 150, sign, v, scratch);
        naiveTerminalValues(ranges, p, river, weights, 150, sign, n);
        for (let h = 0; h < 1128; h++) assert.ok(Math.abs(v[h] - n[h]) <= 1e-9);
      }
    }
    // A huge incompatible hand must not numerically erase all tiny compatible hands.
    const weights = new Float64Array(1128).fill(1e-40); weights[own.sameOpponent[0]] = 1;
    const v = new Float64Array(1128), n = new Float64Array(1128);
    vectorTerminalValues(ranges, p, -1, weights, 1, 1, v, scratch);
    naiveTerminalValues(ranges, p, -1, weights, 1, 1, n);
    assert.ok(v[0] > 0 && Math.abs(v[0] / n[0] - 1) < 1e-12);
    for (let h = 0; h < 1128; h++) {
      let runoutPairs = 0;
      for (let r = 0; r < 48; r++) runoutPairs += own.compatibleCounts[(r + 1) * 1128 + h];
      assert.equal(runoutPairs, 44 * own.compatibleCounts[h]);
    }
  }
});

test("complete bridge turn referee matches our independent turn game and quadratic terminal oracle", {
  skip: existsSync(join(WASM_BUILD_ROOT, "manifest.json")) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/solver/bridge/turn-referee.ts"), "Complete turn grading is required, not an engine self-grade");
  const { gradeBridgeTurn } = await import("../src/lib/solver/bridge/turn-referee");
  const { bindings } = await loadWasm(), base = buildBridgeFixture("referee-turn-v2-dry-value");
  const engine = turnV2RefereeEngine(TURN_V2_CORPUS.find(r => r.id === "turn-v2-dry-value")!);
  for (const iterations of [1, 30, 200]) {
    const spot = { ...base, solve: { ...base.solve, maxIterations: iterations, targetExploitabilityPctPot: 1e-9 } };
    const result = runWasmSpot(bindings, spot), walked = refereeWalk(engine, result);
    assert.deepEqual(walked.mismatches, []);
    const reference = engine.grade(walked.policy), actual = gradeBridgeTurn(spot, result), naive = gradeBridgeTurn(spot, result, "naive");
    for (const p of [0, 1] as const) {
      assert.ok(Math.abs(actual.value[p] - reference.value[p]) < 1e-10);
      assert.ok(Math.abs(actual.gains[p] - reference.gains[p]) < 1e-10);
      assert.ok(Math.abs(actual.value[p] - naive.value[p]) < 1e-10);
      assert.ok(Math.abs(actual.gains[p] - naive.gains[p]) < 1e-10);
      assert.deepEqual(actual.perHand[p].hands, result.hands[p]);
      assert.ok(actual.perHand[p].bestResponse.every((v, i) => v === null || v + 1e-10 >= actual.perHand[p].value[i]!));
    }
    assert.ok(Math.abs(actual.exploitability - reference.exploitability) < 1e-10);
    assert.equal(actual.exploitabilityPctPot, 100 * actual.exploitability / spot.startingPot);
    const truncated = structuredClone(result), chance = truncated.tree.find(n => n.kind === "chance")!;
    if (chance.kind !== "chance") throw new Error("chance required");
    Object.assign(chance, { truncated: true, children: [] });
    assert.throws(() => gradeBridgeTurn(spot, truncated), /complete|truncat/i);
    const changed = structuredClone(result), terminal = changed.tree.find(n => n.kind === "terminal")!;
    Object.assign(terminal, { committed: [999, 999] });
    assert.throws(() => gradeBridgeTurn(spot, changed), /chip|commit/i);
  }
});
