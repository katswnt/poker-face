import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { encodeFullReachNode, splitFullReachChunks, validateFullReachChunk, validateFullReachParts,
  auditFullReachChunks, type FullReachContext } from "../src/lib/solver/bridge/formations/full-reach-v2";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { validateLibraryChunk } from "../src/lib/solver/bridge/library/load";
import type { BridgeLibrarySpot } from "../src/lib/solver/bridge/library/model";
import type { BridgeSliceNode } from "../src/lib/solver/bridge/contract";
import { checkFullReachReferences } from "../src/lib/solver/bridge/formations/full-reach-library-v2";
import { sha256 } from "../src/lib/solver/preflop-v2/corpus";
import { restoreNativeQuality } from "../scripts/publish-full-reach-v3";
import type { DiagnosticObservation } from "../scripts/capture-formation-export-diagnostic";
import { STRATEGY_SCALE, EV_SCALE } from "../src/lib/solver/bridge/library/model";
import { LIBRARY_TOLERANCES } from "../src/lib/solver/bridge/library/invariants";

const sample = () => (JSON.parse(readFileSync("tasks/artifacts/formation-export-diagnostic-v1/observation.json", "utf8")) as DiagnosticObservation).sample;

test("publication restores native float32 quality metadata without relaxing the identity or quality gates", () => {
  const q = restoreNativeQuality(1.9376081, .2980935573577881, 650);
  assert.equal(q.chips, 1.9376081228256226);
  assert.equal(q.pctPot, q.chips / 650 * 100);
  assert.throws(() => restoreNativeQuality(1.9376081, .298, 650));
  assert.throws(() => restoreNativeQuality(2, 2 / 650 * 100, 650));
});

function synthetic() {
  const context: FullReachContext = { id: "tiny", spotHash: "a".repeat(64), flop: ["Ts", "7h", "6s"], effectiveStack: 100,
    ranges: { hands: [["AdKd", "2c2d", "3c3d"], ["AdQc"]], weights: [[1, .000051, .000049], [1]] } };
  const parent: BridgeSliceNode = { path: [], street: "flop", board: ["Ts", "7h", "6s"], player: 0, committed: [0, 0],
    actions: [{ token: "x", engineAction: "Check", action: { type: "check" } },
      { token: "b100", engineAction: "Bet(100)", action: { type: "bet", to: 100 } }],
    reach: [[1, .000051, .000049], [1]], strategy: [[1, 1, 0], [0, 0, 1]],
    ev: [[0, 0, 0], [49]], actionEv: [[0, 0, 0], [0, 0, 0]], equity: [[.5, .5, .5], [.5]] };
  const children: BridgeSliceNode[] = [0, 1].map(a => ({ ...parent, path: [parent.actions[a].token], player: 1,
    committed: [a * 100, 0], reach: [parent.reach[0].map((r, h) => r * parent.strategy[a][h]!), [1]],
    ev: [[0, 0, 0], [a * 100]], strategy: [[1], [0]], actionEv: [[a * 100], [0]] }));
  return { context, parent, children };
}

test("v2 preserves every positive native float32 reach, including subnormal ratios", () => {
  const raw = sample().parent, node = encodeFullReachNode(raw);
  for (const p of [0, 1] as const) {
    const live = raw.reach[p].flatMap((r, h) => r > 0 ? [h] : []);
    assert.deepEqual(node.live[p], live);
    assert.deepEqual(node.reach[p], live.map(h => Math.fround(raw.reach[p][h])));
    assert.equal(node.omittedReach[p], 0);
  }
  const tiny = structuredClone(raw), weights = tiny.reach[0] as number[];
  const indices = raw.reach[0].flatMap((r, h) => r > 0 ? [h] : []);
  weights.fill(0); weights[indices[0]] = 1e-45; weights[indices[1]] = 3e-45;
  const encoded = encodeFullReachNode(tiny);
  assert.equal(encoded.reach[0][1] / encoded.reach[0][0], 2);
  weights[indices[0]] = 1e-50;
  assert.throws(() => encodeFullReachNode(tiny), /float32/);
});

test("v2 independently recomputes all 179 captured opponent values within unchanged tolerance", () => {
  const s = sample(), n = encodeFullReachNode(s.parent), children = s.children.map(encodeFullReachNode);
  const actor = n.player, other = (1 - actor) as 0 | 1;
  const cards = (h: string) => [h.slice(0, 2), h.slice(2)];
  let checked = 0, maximum = 0;
  n.live[other].forEach((h, i) => {
    const own = cards(s.hands[other][h]), frequencies = n.actions.map(() => 0);
    let mass = 0;
    n.live[actor].forEach((g, j) => {
      if (cards(s.hands[actor][g]).some(c => own.includes(c))) return;
      mass += n.reach[actor][j];
      frequencies.forEach((_, a) => { frequencies[a] += n.reach[actor][j] * n.strategy[a][j] / STRATEGY_SCALE; });
    });
    assert.ok(mass > 0); assert.notEqual(n.ev[other][i], null);
    let response = 0, scale = 0;
    children.forEach((child, a) => {
      if (frequencies[a] === 0) return;
      const index = child.live[other].indexOf(h); assert.ok(index >= 0);
      const value = child.ev[other][index]; assert.notEqual(value, null);
      response += frequencies[a] / mass * value! / EV_SCALE;
      scale = Math.max(scale, Math.abs(value! / EV_SCALE));
    });
    const error = Math.abs(response - n.ev[other][i]! / EV_SCALE);
    assert.ok(error <= LIBRARY_TOLERANCES.opponentEvChips + LIBRARY_TOLERANCES.opponentEvRelative * scale);
    maximum = Math.max(maximum, error); checked++;
  });
  assert.equal(checked, 179); assert.ok(maximum < .1);
});

test("v2 blocker example retains the known 49-chip response and unavailable values", () => {
  const { context, parent, children } = synthetic(), chunks = splitFullReachChunks([parent, ...children].map(encodeFullReachNode), context);
  const report = auditFullReachChunks(chunks, context.ranges, { startingPot: 100, effectiveStack: 100 });
  assert.deepEqual(report.failures, []); assert.ok(report.maxOpponentEvError < .00001); assert.equal(report.opponentEvChecked, 1);
  const nullable = encodeFullReachNode({ ...parent, ev: [[null, 0, 0], [49]], equity: [[null, .5, .5], [.5]] });
  assert.equal(nullable.ev[0][0], null); assert.equal(nullable.equity[0][0], null);
  splitFullReachChunks([nullable], context);
});

test("v2 schema rejects wrong units, malformed rows, blocked hands and legacy decoding", () => {
  const { context, parent } = synthetic(), chunk = splitFullReachChunks([encodeFullReachNode(parent)], context)[0];
  const check = (input: unknown) => validateFullReachChunk(input, context, "flop", 0);
  const node = chunk.nodes[0];
  for (const change of [{ reachEncoding: "relative" }, { reach: [[10000, 1, 1], [1]] },
    { reach: [[1, .000051, .000049], [1]] }, { reachMax: [.5, 1] }, { omittedReach: [1e-30, 0] },
    { live: [[0, 0, 2], [0]] }, { live: [[0, 1, 3], [0]] }, { strategy: [[1], [999]] },
    { actionEv: [[0, 0, 0]] }, { board: ["Ts", "Ts", "6s"] }, { actions: ["x", "x"] }, { player: 2 }])
    assert.throws(() => check({ ...chunk, nodes: [{ ...node, ...change }] }));
  assert.throws(() => check({ ...chunk, version: 1 }));
  assert.throws(() => check({ ...chunk, spotHash: "b".repeat(64) }));
  assert.throws(() => check({ ...chunk, nodes: [node, node] }));
  assert.throws(() => validateFullReachChunk(chunk, { ...context, ranges: { ...context.ranges,
    hands: [["TsKd", "2c2d", "3c3d"], ["AdQc"]] } }, "flop", 0));
  assert.throws(() => validateLibraryChunk(chunk, {} as BridgeLibrarySpot, "flop", context.ranges), /unsupported/);
});

test("v2 parts split deterministically and reject missing initial parts, duplicates and oversize nodes", () => {
  const { context, parent } = synthetic(), node = encodeFullReachNode(parent);
  const nodes = Array.from({ length: 201 }, (_, i) => ({ ...node, path: Array(i).fill("x").join(" ") }));
  const chunks = splitFullReachChunks(nodes, context);
  assert.deepEqual(chunks.map(c => [c.part, c.nodes.length]), [[0, 200], [1, 1]]);
  validateFullReachParts(chunks, context);
  assert.equal(canonicalSolverJson(chunks), canonicalSolverJson(splitFullReachChunks(nodes, context)));
  const reorderedKeys = nodes.map(n => Object.fromEntries(Object.entries(n).reverse()) as typeof n);
  assert.equal(canonicalSolverJson(chunks), canonicalSolverJson(splitFullReachChunks(reorderedKeys, context)), "cached/fresh object key order must not change saved bytes");
  assert.throws(() => validateFullReachParts(chunks.slice(1), context));
  assert.throws(() => validateFullReachParts([chunks[0], chunks[0]], context));
  assert.throws(() => splitFullReachChunks([node, node], context));
  assert.throws(() => splitFullReachChunks([{ ...node, actionEv: [Array(600_000).fill(1000)] }], context), /file size/);
  const refs = chunks.map(c => ({ key: c.key, part: c.part, nodes: c.nodes.length, url: `part-${c.part}.json`,
    bytes: Buffer.byteLength(canonicalSolverJson(c)), sha256: sha256(canonicalSolverJson(c)) }));
  checkFullReachReferences(chunks, refs, context);
  assert.throws(() => checkFullReachReferences(chunks.slice(0, 1), refs, context));
  assert.throws(() => checkFullReachReferences(chunks, refs.map(r => ({ ...r, sha256: "0".repeat(64) })), context));
  assert.throws(() => checkFullReachReferences(chunks, refs.map(r => ({ ...r, bytes: r.bytes + 1 })), context));
});
