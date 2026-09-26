import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { BRIDGE_SLICE_PLAN_FORMAT, validateBridgeSlicePlan, type BridgeSliceNode, type BridgeSlicePlanV1 } from "../src/lib/solver/bridge/contract";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { encodeSliceNode, quantizeDistribution } from "../src/lib/solver/bridge/library/encode";
import { auditLibrarySpot } from "../src/lib/solver/bridge/library/invariants";
import {
  fetchLibraryJson, libraryRangesFromSpot, loadLibraryChunk, validateLibraryChunk, validateLibraryManifest,
} from "../src/lib/solver/bridge/library/load";
import { BRIDGE_LIBRARY_CHUNK_FORMAT, type BridgeLibraryChunk, type BridgeLibraryRanges, type BridgeLibrarySpot } from "../src/lib/solver/bridge/library/model";
import {
  findLibraryNode, libraryHandRow, minimumDefenceFrequency, parseActionToken, potOdds, rangeActionFrequencies, toCall,
} from "../src/lib/solver/bridge/library/query";
import { LIBRARY_FLOPS, librarySlicePlan, librarySpot } from "../src/lib/solver/bridge/library/spots";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const skipBinary = existsSync(BRIDGE_BINARY) ? false : "solver-bridge binary not built";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("quantized strategies sum to exactly 1000 and stay close to the input", () => {
  for (const input of [[1 / 3, 1 / 3, 1 / 3], [0.9995, 0.0005, 0], [0.12345, 0.5, 0.37655], [1, 0], [0.2, 0.2, 0.2, 0.2, 0.2]]) {
    const q = quantizeDistribution(input);
    assert.equal(q.reduce((s, x) => s + x, 0), 1000);
    q.forEach((x, i) => assert.ok(Math.abs(x - input[i] * 1000) < 1, `${input} → ${q}`));
  }
  assert.throws(() => quantizeDistribution([0, 0]), /empty/);
});

// A tiny two-hand-per-player node set: root (OOP, x/b100), IP after x, IP after b100.
const RANGES: BridgeLibraryRanges = { hands: [["AsKs", "QdQc"], ["JhJd", "Th9h"]], weights: [[1, 0.5], [1, 1]] };
function slice(path: string[], player: 0 | 1, actions: string[], strategy: number[][], actionEv: number[][], ev: number[][], reach: number[][]): BridgeSliceNode {
  return {
    path, street: "flop", board: ["2c", "7d", "8s"], player, committed: path.includes("b100") ? [100, 0] : [0, 0],
    actions: actions.map(token => ({ token, engineAction: token, action: token === "x" ? { type: "check" } : token === "f" ? { type: "fold" }
      : token === "c" ? { type: "call" } : { type: "bet", to: 100 } })) as Loose,
    strategy, actionEv, ev: ev as Loose, reach: reach as Loose, equity: [[0.6, 0.55], [0.4, 0.45]],
  };
}
function tinyChunk(): { chunk: BridgeLibraryChunk; spot: BridgeLibrarySpot } {
  // OOP: AsKs checks 25% / bets 75%; QdQc checks 100%. EVs chosen consistent with the invariants.
  const root = slice([], 0, ["x", "b100"], [[0.25, 1], [0.75, 0]], [[80, 60], [100, 70]], [[95, 60], [27.5, 25]], [[1, 0.5], [1, 1]]);
  const afterCheck = slice(["x"], 1, ["x", "b100"], [[1, 1], [0, 0]], [[45, 50], [30, 20]], [[70, 60], [45, 50]], [[0.25, 0.5], [1, 1]]);
  const afterBet = slice(["b100"], 1, ["f", "c"], [[0.5, 1], [0.5, 0]], [[0, 0], [20, -30]], [[110, 0], [10, 0]], [[0.75, 0], [1, 1]]);
  const nodes = [root, afterCheck, afterBet].map(encodeSliceNode);
  const spot = { id: "tiny", flop: ["2c", "7d", "8s"], spotHash: "a".repeat(64), chunks: { flop: { url: "", bytes: 1, sha256: "b".repeat(64), nodes: 3 } } } as Loose;
  return { chunk: { format: BRIDGE_LIBRARY_CHUNK_FORMAT, version: 1, spotId: "tiny", spotHash: "a".repeat(64), key: "flop", nodes }, spot };
}

test("encoded nodes keep only live hands, in quantized units", () => {
  const { chunk } = tinyChunk();
  const afterBet = chunk.nodes[2];
  assert.deepEqual(afterBet.live, [[0], [0, 1]]); // QdQc never bets: omitted with zero reach.
  assert.deepEqual(afterBet.reachMax, [0.75, 1]);
  assert.deepEqual(afterBet.reach, [[10000], [10000, 10000]]); // relative to each player's largest reach
  assert.deepEqual(afterBet.strategy, [[500, 1000], [500, 0]]);
  assert.deepEqual(afterBet.actionEv, [[0, 0], [200, -300]]);
  assert.deepEqual(afterBet.omittedReach, [0, 0]);
});

test("chunk validation refuses foreign, reordered or non-normalized data", () => {
  const { chunk, spot } = tinyChunk();
  assert.doesNotThrow(() => validateLibraryChunk(structuredClone(chunk), spot, "flop", RANGES));
  const broken = (edit: (c: Loose) => void) => { const c = structuredClone(chunk) as Loose; edit(c); return () => validateLibraryChunk(c, spot, "flop", RANGES); };
  assert.throws(broken(c => { c.spotHash = "c".repeat(64); }), /another spot/);
  assert.throws(broken(c => { c.nodes[0].strategy[0][0] += 1; }), /sum to 1/);
  assert.throws(broken(c => { c.nodes[1].live[1] = [1, 0]; }), /ascend/);
  assert.throws(broken(c => { c.nodes[1].board = ["2c", "7d", "9s"]; }), /board/);
  assert.throws(broken(c => { c.nodes.pop(); }), /node count/);
});

test("the invariant audit accepts consistent data and catches a corrupted reach or EV", () => {
  const { chunk } = tinyChunk();
  const setup = { startingPot: 100, effectiveStack: 1000 };
  const clean = auditLibrarySpot([chunk], RANGES, setup);
  assert.deepEqual(clean.failures, []);
  assert.equal(clean.reachChecked, 6);
  assert.equal(clean.opponentEvChecked, 1);
  const badReach = structuredClone(chunk) as Loose;
  badReach.nodes[1].reach[0][0] = 9000; // AsKs checks 25%, so its reach after "x" must be 0.25 = 5000 × max 0.5.
  assert.match(auditLibrarySpot([badReach], RANGES, setup).failures.join(), /reach\[0\] of AsKs/);
  const badEv = structuredClone(chunk) as Loose;
  badEv.nodes[0].ev[0][0] += 50;
  assert.match(auditLibrarySpot([badEv], RANGES, setup).failures.join(), /actor EV/);
  const badOpponent = structuredClone(chunk) as Loose;
  badOpponent.nodes[0].ev[1][0] += 100;
  assert.match(auditLibrarySpot([badOpponent], RANGES, setup).failures.join(), /opponent EV of JhJd/);
});

test("drill helpers: pot odds, MDF, hand rows and range frequencies", () => {
  const { chunk } = tinyChunk();
  const facing = findLibraryNode(chunk, ["b100"])!;
  assert.equal(toCall(facing), 100);
  assert.equal(potOdds(facing, 100), 100 / 300);
  assert.equal(minimumDefenceFrequency(100, 100), 0.5);
  assert.deepEqual(parseActionToken("r450"), { kind: "raise", to: 450 });
  assert.throws(() => parseActionToken("Qh"));
  const row = libraryHandRow(facing, RANGES, 1, "Th9h")!;
  assert.deepEqual(row.actions, [{ token: "f", probability: 1, ev: 0 }, { token: "c", probability: 0, ev: -30 }]);
  assert.equal(libraryHandRow(facing, RANGES, 0, "QdQc"), null);
  const root = findLibraryNode(chunk, [])!;
  const freq = rangeActionFrequencies(root);
  assert.ok(Math.abs(freq[1].frequency - 0.75 / 1.5) < 1e-12);
});

test("fetchLibraryJson refuses wrong sizes, hashes and URLs", async () => {
  const text = JSON.stringify({ ok: true }), ref = { url: "/solver-data/bridge-v1/x/y.json", bytes: text.length, sha256: sha(text) };
  const fetcher = (async () => new Response(text)) as typeof fetch;
  assert.deepEqual(await fetchLibraryJson(ref, undefined, fetcher), { ok: true });
  await assert.rejects(fetchLibraryJson({ ...ref, sha256: sha("other") }, undefined, fetcher), /integrity/);
  await assert.rejects(fetchLibraryJson({ ...ref, bytes: ref.bytes + 1 }, undefined, fetcher), /size/);
  await assert.rejects(fetchLibraryJson({ ...ref, url: "/elsewhere/y.json" }, undefined, fetcher), /outside/);
});

test("slice plans are strict and library plans only name off-board cards", () => {
  const board = { flop: ["Ks", "7h", "2d"] as const, turn: null, river: null } as Loose;
  const plan = librarySlicePlan(LIBRARY_FLOPS[0]);
  assert.deepEqual(validateBridgeSlicePlan(plan, board), plan);
  assert.throws(() => validateBridgeSlicePlan({ ...plan, turn: { ...plan.turn!, cards: ["Ks"] } }, board), /on the board/);
  assert.throws(() => validateBridgeSlicePlan({ ...plan, extra: 1 }, board), /unknown fields/);
  assert.throws(() => validateBridgeSlicePlan({ ...plan, subtrees: [["x", "zz"]] }, board), /not a path/);
  for (const definition of LIBRARY_FLOPS) {
    const spot = librarySpot(definition);
    assert.ok(spot.ranges.every(r => r.source.includes("hand-written approximations, not solved")), definition.id);
    assert.doesNotThrow(() => validateBridgeSlicePlan(librarySlicePlan(definition), spot.board), definition.id);
  }
  assert.equal(new Set(LIBRARY_FLOPS.map(d => d.flop.join(""))).size, LIBRARY_FLOPS.length);
});

test("slices from the native bridge satisfy the library invariants and our river grade", { skip: skipBinary }, async () => {
  const spot = buildBridgeFixture("referee-flop-reference");
  const plan: BridgeSlicePlanV1 = { format: BRIDGE_SLICE_PLAN_FORMAT, version: 1, flop: { maxDepth: null },
    turn: { cards: ["2c", "Ah"] as Loose, maxDepth: 2, maxPriorRaises: 0 }, river: { boards: [["2c", "3d"]] as Loose, maxDepth: 2, maxPriorRaises: 0 },
    subtrees: [["b25", "c", "2c", "b25", "c", "3d"]], equity: true };
  const run = await runBridgeSpot(spot, { slices: plan });
  const slices = run.result.slices!;
  assert.equal(slices.planHash, run.slicePlanHash);
  assert.deepEqual(slices.unreached, []);
  assert.ok(slices.nodes.some(n => n.street === "river") && slices.nodes.some(n => n.street === "turn"));
  const ranges = { hands: run.result.hands, weights: spot.ranges.map(r => r.combos.map(c => c.weight)) } as Loose as BridgeLibraryRanges;
  const nodes = slices.nodes.map(encodeSliceNode);
  const report = auditLibrarySpot([{ format: BRIDGE_LIBRARY_CHUNK_FORMAT, version: 1, spotId: spot.id, spotHash: run.spotHash, key: "all", nodes }],
    ranges, { startingPot: spot.startingPot, effectiveStack: spot.effectiveStack });
  assert.deepEqual(report.failures, []);
  assert.ok(report.reachChecked > 0 && report.opponentEvChecked > 0);
  const grade = gradeRiverSubgame({ hands: run.result.hands, startingPot: spot.startingPot, subtree: slices.subtrees[0] });
  assert.ok(Math.abs(grade.theirs.value[0] - grade.ours.value[0]) < 1e-3);
  assert.ok(grade.ours.exploitability < 0.25);
  // A strategy corrupted in the export must show up in our grade, not be averaged away.
  const corrupted = structuredClone(slices.subtrees[0]) as Loose;
  // Every hand always takes the first action (check, or fold facing a bet): trivially exploitable.
  for (const node of corrupted.nodes.filter((n: Loose) => n.kind === "player")) {
    node.strategy = node.strategy.map((row: (number | null)[], a: number) => row.map(p => p === null ? null : a === 0 ? 1 : 0));
  }
  const worse = gradeRiverSubgame({ hands: run.result.hands, startingPot: spot.startingPot, subtree: corrupted });
  assert.ok(worse.ours.exploitability > grade.ours.exploitability + 1);
});

const MANIFEST = "public/solver-data/bridge-v1/manifest.json";
test("the published library loads lazily through its hash-checked references", { skip: existsSync(MANIFEST) ? false : "library not generated" }, async () => {
  const manifest = validateLibraryManifest(JSON.parse(readFileSync(MANIFEST, "utf8")));
  const fetcher = (async (url: string) => new Response(readFileSync(`public${url}`))) as unknown as typeof fetch;
  const spot = manifest.spots[0];
  const ranges = libraryRangesFromSpot(await fetchLibraryJson(spot.spot, undefined, fetcher), spot);
  const flop = await loadLibraryChunk(spot, "flop", ranges, undefined, fetcher);
  const root = findLibraryNode(flop, [])!;
  assert.equal(root.player, 0);
  assert.equal(root.street, "flop");
  assert.ok(rangeActionFrequencies(root).reduce((s, f) => s + f.frequency, 0) > 0.999);
  await assert.rejects(loadLibraryChunk(spot, "turn-2c-missing", ranges, undefined, fetcher), /no saved slice/);
  const tampered = (async (url: string) => {
    const bytes = readFileSync(`public${url}`); bytes[bytes.length - 2] ^= 1; return new Response(bytes);
  }) as unknown as typeof fetch;
  await assert.rejects(loadLibraryChunk(spot, "flop", ranges, undefined, tampered), /integrity/);
});
