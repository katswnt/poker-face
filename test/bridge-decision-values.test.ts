import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { isomorphismProbeSpot } from "../src/lib/solver/bridge/referee-node";
import { canonicalBridgeSpotJson } from "../src/lib/solver/bridge/contract-node";
import { checkBridgeResult, validateBridgeSpot, type BridgeExplicitNode, type BridgeResultV1, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";

type Result = BridgeResultV1;
const native = { skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required" };

function run(spot: BridgeSpotV1, values: boolean, estimate = false) {
  const directory = mkdtempSync(join(tmpdir(), "poker-decision-values-"));
  try {
    const input = join(directory, "spot.json"), output = join(directory, "result.json");
    writeFileSync(input, canonicalBridgeSpotJson(spot));
    const process = spawnSync(BRIDGE_BINARY, [estimate ? "estimate" : "solve", input,
      ...(!estimate ? ["--out", output, "--threads", "1"] : []), ...(values ? ["--decision-values"] : [])],
    { encoding: "utf8", timeout: spot.solve.timeoutMs + 5000, maxBuffer: 16 * 1024 ** 2 });
    assert.equal(process.status, 0, `Native decision-value capability required: ${process.stderr}`);
    return JSON.parse(estimate ? process.stdout : readFileSync(output, "utf8"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

// This projection intentionally excludes ONLY timing/memory and the new optional block.
function oldMath(result: Result) {
  const { timings, memory, decisionValues, ...math } = result;
  void timings; void memory; void decisionValues;
  return { ...math, convergence: math.convergence.map(({ iteration, exploitability }) => ({ iteration, exploitability })) };
}

test("opt-in native decision values cover both seats without changing any old mathematical field", native, () => {
  for (const spot of [buildBridgeFixture("referee-river-v3-demo"), buildBridgeFixture("referee-turn-v2-dry-value"), isomorphismProbeSpot()]) {
    const plain: Result = run(spot, false), enabled: Result = run(spot, true);
    assert.equal(plain.decisionValues, undefined);
    const values = enabled.decisionValues;
    assert.ok(values, "Final result needs the requested decision values");
    assert.deepEqual({ ...values, nodes: [] }, { format: "poker-face-bridge-decision-values", version: 1,
      spotHash: enabled.spotHash, units: "chips", convention: "payout-minus-future-contributions", basis: "local-solved-policy", nodes: [] });
    assert.deepEqual(values.nodes.map(n => n.nodeId), enabled.tree.filter(n => n.kind === "player").map(n => n.id));
    for (const entry of values.nodes) {
      const node = enabled.tree[entry.nodeId]; assert.equal(node.kind, "player");
      if (node.kind !== "player") throw new Error("Player required");
      assert.equal(entry.actionEv.length, node.actions.length);
      assert.ok(entry.actionEv.every(row => row.length === enabled.hands[node.player].length));
      assert.ok(entry.actionEv.flat().every(v => v === null || Number.isFinite(v)));
    }
    assert.deepEqual(oldMath(enabled), oldMath(plain));
    const changed = structuredClone(enabled); Object.assign(changed.root.ev[0], { 0: changed.root.ev[0][0] + 1 });
    assert.notDeepEqual(oldMath(changed), oldMath(plain), "The comparison must retain old EVs");
    const changedStrategy = structuredClone(enabled);
    const first = changedStrategy.tree.find(n => n.kind === "player")!;
    if (first.kind === "player") Object.assign(first.strategy[0], { 0: .123 });
    assert.notDeepEqual(oldMath(changedStrategy), oldMath(plain), "The comparison must retain strategies");
  }
});

test("value export is reserved before allocation and covers its measured serialized bytes", native, () => {
  const spot = buildBridgeFixture("referee-turn-v2-dry-value");
  const plain = run(spot, false, true), enabled = run(spot, true, true), result = run(spot, true);
  assert.equal(plain.estimateExport.decisionValueCells, undefined);
  assert.equal(enabled.estimateExport.decisionValueCells, enabled.estimateExport.cells);
  assert.equal(enabled.estimatedBytes, plain.estimatedBytes, "No extra strategy allocation or solve");
  assert.ok(enabled.estimateExport.jsonBytesUpperBound > plain.estimateExport.jsonBytesUpperBound);
  assert.ok(enabled.estimateExport.workingBytesEstimate > plain.estimateExport.workingBytesEstimate);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= enabled.estimateExport.jsonBytesUpperBound);
});

test("the native playing source reserves and returns teaching values only when requested", native, async () => {
  const { solveNativePlay } = await import("../src/lib/hu-play/sources/native");
  const { loadP1ProductionRoots } = await import("../scripts/hu-play-p1-corpus");
  const spot = loadP1ProductionRoots().find(r => r.street === "river")!.playingSpot;
  let estimated = false;
  const result = await solveNativePlay(spot, { decisionValues: true, onEstimate: (_spot, estimate, verdict) => {
    assert.ok(estimate.estimateExport.decisionValueCells! > 0);
    assert.ok(verdict.ok); estimated = true;
  }, onResult: () => assert.ok(estimated, "Admission must precede computation") });
  assert.ok(estimated); assert.ok(result.decisionValues, "Native play must expose its requested values");
});

test("forced historical bet gives fold zero and call five chips at 25% equity", native, () => {
  const base = buildBridgeFixture("referee-river-v3-demo");
  const spot = validateBridgeSpot({ ...base, startingPot: 60, effectiveStack: 20,
    board: { flop: ["Kd", "8c", "4h"], turn: "2s", river: "9d" },
    ranges: [{ source: "test", combos: [{ combo: "7s6s", weight: .25 }, { combo: "AsAh", weight: .75 }] },
      { source: "test", combos: [{ combo: "KsQs", weight: 1 }] }],
    tree: { mode: "river-subgame-v1", prefixLength: 1, root: { kind: "player", player: 0, actions: [
      { action: { type: "bet", to: 20 }, next: { kind: "player", player: 1, actions: [
        { action: { type: "fold" }, next: { kind: "terminal", outcome: "fold" } },
        { action: { type: "call" }, next: { kind: "terminal", outcome: "showdown" } },
      ] } },
    ] } } });
  const result: Result = run(spot, true), node = result.tree[1];
  assert.equal(node.kind, "player");
  assert.deepEqual(result.decisionValues!.nodes.find(n => n.nodeId === 1)!.actionEv, [[0], [5]]);
});

test("a complete independent action-value oracle exists before teaching can ship", () => {
  assert.ok(existsSync("scripts/bridge-decision-value-oracle.ts"), "Independent pair/runout oracle is required");
});

test("every turn/river action value and reach mask matches independent pair/runout enumeration", native, async () => {
  assert.ok(existsSync("scripts/bridge-decision-value-oracle.ts"), "Independent oracle required");
  const { auditDecisionValues } = await import("../scripts/bridge-decision-value-oracle");
  for (const spot of [buildBridgeFixture("referee-river-v3-demo"), buildBridgeFixture("referee-turn-v2-dry-value"), isomorphismProbeSpot()]) {
    const result: Result = run(spot, true);
    const report = auditDecisionValues(spot, result);
    assert.ok(report.checkedCells > 0);
    assert.ok(report.maxAbsoluteError <= .0002);
    console.log(JSON.stringify({ spot: spot.id, ...report }));
    const altered = structuredClone(result);
    const live = altered.decisionValues!.nodes.find(n => n.actionEv.some(r => r.some(v => v !== null)))!;
    const row = live.actionEv.find(r => r.some(v => v !== null))!, h = row.findIndex(v => v !== null);
    Object.assign(row, { [h]: row[h]! + 1 });
    assert.throws(() => auditDecisionValues(spot, altered), /value/i);
    const masked = structuredClone(result);
    masked.decisionValues!.nodes.find(n => n.nodeId === live.nodeId)!.actionEv.forEach(r => { Object.assign(r, { [h]: null }); });
    assert.throws(() => auditDecisionValues(spot, masked), /mask/i);
    const chips = structuredClone(result);
    Object.assign(chips.tree.find(n => n.kind === "terminal")!, { committed: [12345, 12345] });
    assert.throws(() => auditDecisionValues(spot, chips), /chip|commit/i);
    const swapped = structuredClone(result), different = swapped.decisionValues!.nodes.find(n => n.actionEv.length >= 2
      && JSON.stringify(n.actionEv[0]) !== JSON.stringify(n.actionEv[1]))!;
    assert.ok(different); const first = different.actionEv[0];
    Object.assign(different.actionEv, { 0: different.actionEv[1], 1: first });
    assert.throws(() => auditDecisionValues(spot, swapped), /value|mask/i, "Swapping action values must be detected");
  }
});

test("a first-street river export is a complete game for independent value grading", native, async () => {
  const { auditDecisionValues } = await import("../scripts/bridge-decision-value-oracle");
  const base = buildBridgeFixture("referee-river-v3-demo");
  const spot = validateBridgeSpot({ ...base, solve: { ...base.solve, exportScope: "first-street" } });
  const result: Result = run(spot, true);
  assert.ok(auditDecisionValues(spot, result).checkedCells > 0);
});

test("result boundary rejects partial, mismatched, malformed and nonfinite teaching payloads", native, () => {
  const spot = buildBridgeFixture("referee-river-v3-demo"), result: Result = run(spot, true);
  assert.doesNotThrow(() => checkBridgeResult(result, spot, result.spotHash));
  // Deliberate malformed values cannot be expressed by the result type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutations: ((r: any) => void)[] = [
    r => { r.decisionValues = null; },
    r => { r.decisionValues.format = "unknown"; }, r => { r.decisionValues.version = 2; },
    r => { r.decisionValues.spotHash = "0".repeat(64); }, r => { r.decisionValues.units = "bb"; },
    r => { r.decisionValues.convention = "root-net"; }, r => { r.decisionValues.basis = "global-gto"; },
    r => { r.decisionValues.nodes.pop(); }, r => { r.decisionValues.nodes.push(r.decisionValues.nodes[0]); },
    r => { r.decisionValues.nodes.reverse(); }, r => { r.decisionValues.nodes[0].nodeId = 99999; },
    r => { r.decisionValues.nodes[0].actionEv.pop(); }, r => { r.decisionValues.nodes[0].actionEv[0].pop(); },
    r => { r.decisionValues.nodes[0].actionEv[0][0] = NaN; }, r => { r.decisionValues.nodes[0].actionEv[0][0] = Infinity; },
    r => { r.decisionValues.nodes[0].actionEv[0][0] = "0"; }, r => { r.decisionValues.nodes[0].actionEv[0][0] = null; },
    r => { r.tree[0].board[0] = r.hands[0][0].slice(0, 2); },
    r => { r.engine.precision = "int16-compressed"; },
  ];
  mutations.forEach((mutate, index) => {
    const bad = structuredClone(result); mutate(bad);
    assert.throws(() => checkBridgeResult(bad, spot, bad.spotHash), /decision value/i, `Mutation ${index}`);
  });
});

test("nonfinite strategy probabilities cannot pass the result boundary", native, () => {
  const spot = buildBridgeFixture("referee-river-v3-demo"), result: Result = run(spot, false);
  for (const value of [NaN, Infinity, -Infinity]) {
    const bad = structuredClone(result), node = bad.tree[0];
    if (node.kind !== "player") throw new Error("Player root required");
    Object.assign(node.strategy[0], { 0: value });
    assert.throws(() => checkBridgeResult(bad, spot, bad.spotHash), /probabilit/);
  }
});

test("native runner forwards the optional teaching request and requires its result", native, async () => {
  const options = { threads: 1, decisionValues: true };
  const { result } = await runBridgeSpot(buildBridgeFixture("referee-river-v3-demo"), options);
  assert.ok(result.decisionValues, "Runner must not silently drop the requested values");
});

test("native and WASM teaching exports are exactly equal and independently graded", {
  skip: existsSync(BRIDGE_BINARY) && existsSync(join(WASM_BUILD_ROOT, "manifest.json")) ? false : "native/WASM builds required",
}, async () => {
  const { bindings } = await loadWasm(), { auditDecisionValues } = await import("../scripts/bridge-decision-value-oracle");
  for (const spot of [buildBridgeFixture("referee-river-v3-demo"), buildBridgeFixture("referee-turn-v2-dry-value"), isomorphismProbeSpot()]) {
    const wasm = runWasmSpot(bindings, spot, 7, { decisionValues: true });
    assert.ok(wasm.decisionValues, "WASM runner must export the requested values");
    const nativeResult: Result = run(spot, true);
    assert.deepEqual(oldMath(wasm), oldMath(nativeResult));
    assert.deepEqual(wasm.decisionValues, nativeResult.decisionValues);
    assert.ok(auditDecisionValues(spot, wasm).maxAbsoluteError <= .0002);
  }
});

test("both actors, sunk raises, negative zero-frequency calls, ties and turn all-ins keep from-now units", native, async () => {
  const { auditDecisionValues, recomputeDecisionValues } = await import("../scripts/bridge-decision-value-oracle");
  const base = buildBridgeFixture("referee-river-v3-demo");
  const response = (player: 0 | 1): BridgeExplicitNode => ({ kind: "player", player, actions: [
    { action: { type: "fold" }, next: { kind: "terminal", outcome: "fold" } },
    { action: { type: "call" }, next: { kind: "terminal", outcome: "showdown" } },
  ] });
  const mixed = { source: "25% bluff, 75% value", combos: [{ combo: "7s6s", weight: .25 }, { combo: "AsAh", weight: .75 }] };
  const kings = { source: "test", combos: [{ combo: "KsQs", weight: 1 }] };
  const common = { ...base, startingPot: 60, effectiveStack: 20,
    board: { flop: ["Kd", "8c", "4h"], turn: "2s", river: "9d" } };
  const oop = validateBridgeSpot({ ...common, ranges: [kings, mixed], tree: { mode: "river-subgame-v1", prefixLength: 2,
    root: { kind: "player", player: 0, actions: [{ action: { type: "check" }, next: { kind: "player", player: 1,
      actions: [{ action: { type: "bet", to: 20 }, next: response(0) }] } }] } } });
  const sunk = validateBridgeSpot({ ...common, effectiveStack: 40, ranges: [kings, mixed], tree: { mode: "river-subgame-v1", prefixLength: 2,
    root: { kind: "player", player: 0, actions: [{ action: { type: "bet", to: 20 }, next: { kind: "player", player: 1,
      actions: [{ action: { type: "raise", to: 40 }, next: response(0) }] } }] } } });
  const losing = validateBridgeSpot({ ...oop, ranges: [kings, { source: "test", combos: [{ combo: "AsAh", weight: 1 }] }] });
  const tie = validateBridgeSpot({ ...oop, board: { flop: ["Tc", "Jc", "Qc"], turn: "Kc", river: "Ac" } });
  for (const [spot, expectedCall] of [[oop, 5], [sunk, 15], [losing, -20], [tie, 30]] as const) {
    const result: Result = run(spot, true), entry = result.decisionValues!.nodes.find(n => n.nodeId === 2)!;
    assert.ok(auditDecisionValues(spot, result).maxAbsoluteError <= .0002);
    assert.equal(entry.actionEv[0][0], 0);
    assert.ok(Math.abs(entry.actionEv[1][0]! - expectedCall) <= .0002);
    const caller = result.tree[2], bettor = result.tree[1];
    assert.ok(caller.kind === "player" && bettor.kind === "player");
    const callerValue = entry.actionEv.reduce((sum, row, a) => sum + row[0]! * caller.strategy[a][0]!, 0);
    const betValues = result.decisionValues!.nodes.find(n => n.nodeId === 1)!.actionEv[0];
    const weight = spot.ranges[1].combos.reduce((s, h) => s + h.weight, 0);
    const bettorBefore = betValues.reduce<number>((sum, value, h) => sum + value! * spot.ranges[1].combos[h].weight / weight, 0);
    const sunkSinceBet = caller.committed[1] - bettor.committed[1];
    assert.ok(Math.abs(callerValue + bettorBefore + sunkSinceBet - (spot.startingPot + caller.committed[0] + caller.committed[1])) <= .0002,
      "At the same public history, both players' compatible policy values sum to the current pot");
    if (spot === losing) {
      const node = result.tree[2]; if (node.kind !== "player") throw new Error("Player required");
      assert.equal(node.strategy[1][0], 0, "A never-chosen losing call still has a meaningful value");
    }
    if (spot === oop) {
      const computed = recomputeDecisionValues(spot, result).nodes.find(n => n.nodeId === 2)!.actionEv;
      assert.equal(Math.max(...computed.map(r => r[0]!)), 5, "Hidden-card averaging must precede the choice");
      assert.notEqual(Math.max(...computed.map(r => r[0]!)), .25 * 80, "A cheating choice would fold only against the value hand");
    }
  }
  const turn = validateBridgeSpot({ ...oop, board: { ...oop.board, river: null }, tree: { ...oop.tree, mode: "turn-subgame-v1" } });
  const result: Result = run(turn, true);
  assert.ok(result.tree.some(n => n.kind === "terminal" && n.outcome === "showdown" && n.board.length === 4));
  assert.ok(auditDecisionValues(turn, result).maxAbsoluteError <= .0002);
});

test("positive compatible mass that underflows float32 must be refused, never labelled unreachable", native, () => {
  const base = buildBridgeFixture("referee-river-v3-demo");
  const spot = validateBridgeSpot({ ...base, board: { flop: ["Kd", "8c", "4h"], turn: "2s", river: "9d" },
    ranges: [{ source: "underflow probe", combos: [{ combo: "KsQs", weight: 1 }, { combo: "AsAh", weight: Math.fround(1e-30) }] },
      { source: "underflow probe", combos: [{ combo: "7s6s", weight: Math.fround(1e-20) }, { combo: "AhAc", weight: 1 }] }],
    tree: { mode: "explicit", root: { kind: "player", player: 0, actions: [{ action: { type: "check" }, next: {
      kind: "player", player: 1, actions: [{ action: { type: "check" }, next: { kind: "terminal", outcome: "showdown" } }],
    } }] } } });
  // AsAh has positive own weight and one compatible opponent (7s6s), despite the
  // product (~1e-50) being below float32. Calling it an unreachable hand is false.
  const directory = mkdtempSync(join(tmpdir(), "poker-positive-reach-"));
  try {
    const input = join(directory, "spot.json"), output = join(directory, "result.json");
    writeFileSync(input, canonicalBridgeSpotJson(spot));
    const process = spawnSync(BRIDGE_BINARY, ["solve", input, "--out", output, "--threads", "1", "--decision-values"], { encoding: "utf8" });
    assert.notEqual(process.status, 0, "Must refuse a positive-reach value that cannot be normalized");
    assert.match(process.stderr, /positive.*reach|underflow/i);
    assert.equal(existsSync(output), false, "No partial result may survive");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
