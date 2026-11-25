/** Offline v2 slices: absolute native float32 reach, unchanged probability/value rounding. */
import assert from "node:assert/strict";
import type { BridgeSliceNode } from "../contract";
import { encodeSliceNode } from "../library/encode";
import { auditLibrarySpot } from "../library/invariants";
import { BRIDGE_LIBRARY_CHUNK_FORMAT, BRIDGE_LIBRARY_FILE_BYTES, BRIDGE_LIBRARY_MAX_NODES_PER_CHUNK,
  chunkKeyForNode, REACH_SCALE, STRATEGY_SCALE, EQUITY_SCALE, type BridgeLibraryChunk,
  type BridgeLibraryNode, type BridgeLibraryRanges } from "../library/model";
import { canonicalSolverJson } from "../../toy/artifact";

export interface FullReachNode extends BridgeLibraryNode { readonly reachEncoding: "native-f32" }
export interface FullReachChunk {
  readonly format: "poker-face-formation-full-reach-chunk"; readonly version: 2;
  readonly spotId: string; readonly spotHash: string; readonly key: string; readonly part: number;
  readonly nodes: readonly FullReachNode[];
}
export const FULL_REACH_URL = "/solver-data/bridge-formations-v2/";

export function encodeFullReachNode(node: BridgeSliceNode): FullReachNode {
  const reach = node.reach.map(row => row.map(value => {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1 + 1e-6, "invalid native reach");
    const exact = Math.fround(value);
    assert.ok(value === 0 || exact > 0, "positive reach lost to float32 underflow");
    return exact;
  }));
  // Retain every positive hand while reusing the unchanged value/strategy encoder.
  const encoded = encodeSliceNode({ ...node, reach: [reach[0].map(r => r > 0 ? 1 : 0), reach[1].map(r => r > 0 ? 1 : 0)] });
  return { ...encoded, reachEncoding: "native-f32", omittedReach: [0, 0],
    reachMax: [Math.max(0, ...reach[0]), Math.max(0, ...reach[1])],
    reach: [encoded.live[0].map(h => reach[0][h]), encoded.live[1].map(h => reach[1][h])] };
}

const CARD = /^[2-9TJQKA][cdhs]$/, ACTION = /^(x|c|f|[br][1-9][0-9]*)$/;
const object = (v: unknown): Record<string, unknown> => {
  assert.ok(v !== null && typeof v === "object" && !Array.isArray(v), "object required"); return v as Record<string, unknown>;
};
const row = (v: unknown, length: number): unknown[] => { assert.ok(Array.isArray(v) && v.length === length, "row length"); return v; };
const integer = (v: unknown, low: number, high: number): number => {
  assert.ok(typeof v === "number" && Number.isSafeInteger(v) && v >= low && v <= high, "integer bounds"); return v;
};
const nativeFloat = (v: unknown): number => {
  assert.ok(typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 + 1e-6 && Math.fround(v) === v, "exact native float32 required"); return v;
};
export interface FullReachContext {
  readonly id: string; readonly spotHash: string; readonly flop: readonly string[];
  readonly effectiveStack: number; readonly ranges: BridgeLibraryRanges;
}

/** Separate strict v2 schema; legacy integer reach readers cannot accept this data. */
export function validateFullReachChunk(input: unknown, context: FullReachContext, key: string, part: number): FullReachChunk {
  const c = object(input);
  assert.equal(c.format, "poker-face-formation-full-reach-chunk"); assert.equal(c.version, 2);
  assert.equal(c.spotId, context.id); assert.equal(c.spotHash, context.spotHash);
  assert.equal(c.key, key); assert.equal(c.part, part); integer(part, 0, 100_000);
  assert.ok(Array.isArray(c.nodes) && c.nodes.length > 0 && c.nodes.length <= BRIDGE_LIBRARY_MAX_NODES_PER_CHUNK);
  assert.ok(Buffer.byteLength(canonicalSolverJson(input)) <= BRIDGE_LIBRARY_FILE_BYTES, "chunk file size");
  const seen = new Set<string>();
  for (const raw of c.nodes) {
    const n = object(raw); assert.equal(n.reachEncoding, "native-f32");
    assert.ok(typeof n.path === "string" && n.path.length <= 1024 && !seen.has(n.path), "duplicate/invalid path"); seen.add(n.path);
    const tokens = n.path === "" ? [] : n.path.split(" ");
    assert.ok(tokens.every(t => CARD.test(t) || ACTION.test(t)), "invalid path token");
    const cards = tokens.filter(t => CARD.test(t));
    assert.ok(n.street === "flop" || n.street === "turn" || n.street === "river");
    const board = row(n.board, { flop: 3, turn: 4, river: 5 }[n.street]);
    assert.deepEqual(board, [...context.flop, ...cards]);
    assert.ok(board.every(c => typeof c === "string" && CARD.test(c)) && new Set(board).size === board.length, "board cards");
    assert.equal(chunkKeyForNode(raw), key, "logical chunk mismatch");
    const actor = integer(n.player, 0, 1);
    row(n.committed, 2).forEach(v => integer(v, 0, context.effectiveStack));
    assert.ok(Array.isArray(n.actions) && n.actions.length > 0 && n.actions.length <= 8);
    const actions = n.actions; assert.ok(actions.every(a => typeof a === "string" && ACTION.test(a)) && new Set(actions).size === actions.length);
    const live = row(n.live, 2), reaches = row(n.reach, 2), maxima = row(n.reachMax, 2);
    assert.deepEqual(n.omittedReach, [0, 0], "v2 cannot omit positive reach");
    const ev = row(n.ev, 2), equity = row(n.equity, 2);
    const lists = [0, 1].map(p => {
      assert.ok(Array.isArray(live[p]) && live[p].length <= context.ranges.hands[p].length);
      const list = live[p] as number[];
      list.forEach((h, i) => {
        integer(h, 0, context.ranges.hands[p].length - 1); assert.ok(!i || h > list[i - 1], "live hand order");
        const hand = context.ranges.hands[p][h];
        assert.ok(!board.includes(hand.slice(0, 2)) && !board.includes(hand.slice(2)), "board-blocked live hand");
      });
      const r = row(reaches[p], list.length).map(nativeFloat); assert.ok(r.every(x => x > 0), "positive reach only");
      assert.equal(nativeFloat(maxima[p]), Math.max(0, ...r), "reach maximum");
      row(ev[p], list.length).forEach(v => { if (v !== null) integer(v, -1e9, 1e9); });
      row(equity[p], list.length).forEach(v => { if (v !== null) integer(v, 0, EQUITY_SCALE); });
      return list;
    });
    const strategies = row(n.strategy, actions.length).map(r => row(r, lists[actor].length).map(v => integer(v, 0, STRATEGY_SCALE)));
    row(n.actionEv, actions.length).forEach(r => row(r, lists[actor].length).forEach(v => { if (v !== null) integer(v, -1e9, 1e9); }));
    lists[actor].forEach((_, h) => assert.equal(strategies.reduce((sum, r) => sum + r[h], 0), STRATEGY_SCALE));
  }
  return input as FullReachChunk;
}

/** Greedy split: retain native node order within each sorted logical key. */
export function splitFullReachChunks(nodes: readonly FullReachNode[], context: FullReachContext): FullReachChunk[] {
  const groups = new Map<string, FullReachNode[]>(), seen = new Set<string>();
  for (const n of nodes) {
    assert.ok(!seen.has(n.path), "duplicate saved path"); seen.add(n.path);
    const key = chunkKeyForNode(n); (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }
  const chunks: FullReachChunk[] = [];
  for (const [key, group] of [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    let part = 0, pending: FullReachNode[] = [];
    const make = (rows: readonly FullReachNode[]): FullReachChunk => ({ format: "poker-face-formation-full-reach-chunk", version: 2,
      spotId: context.id, spotHash: context.spotHash, key, part, nodes: rows });
    const flush = () => { chunks.push(validateFullReachChunk(make(pending), context, key, part)); part++; pending = []; };
    for (const n of group) {
      const candidate = [...pending, n];
      if (pending.length && (candidate.length > BRIDGE_LIBRARY_MAX_NODES_PER_CHUNK || Buffer.byteLength(canonicalSolverJson(make(candidate))) > BRIDGE_LIBRARY_FILE_BYTES)) flush();
      pending.push(n);
      assert.ok(Buffer.byteLength(canonicalSolverJson(make(pending))) <= BRIDGE_LIBRARY_FILE_BYTES, "single node exceeds file size gate");
    }
    if (pending.length) flush();
  }
  return chunks;
}

export function validateFullReachParts(chunks: readonly FullReachChunk[], context: FullReachContext) {
  const next = new Map<string, number>(), paths = new Set<string>();
  for (const chunk of chunks) {
    const part = next.get(chunk.key) ?? 0; validateFullReachChunk(chunk, context, chunk.key, part); next.set(chunk.key, part + 1);
    for (const n of chunk.nodes) { assert.ok(!paths.has(n.path), "duplicate saved path"); paths.add(n.path); }
  }
  assert.ok(paths.has(""), "missing flop root");
  return chunks;
}

/** Convert units without rounding for the original algebraic audit; never serialize as v1. */
export function auditFullReachChunks(chunks: readonly FullReachChunk[], ranges: BridgeLibraryRanges,
  setup: { startingPot: number; effectiveStack: number }) {
  const adapted: BridgeLibraryChunk[] = chunks.map(c => ({ ...c, format: BRIDGE_LIBRARY_CHUNK_FORMAT, version: 1,
    nodes: c.nodes.map(n => ({ ...n, reach: [n.reach[0].map(r => r / n.reachMax[0] * REACH_SCALE),
      n.reach[1].map(r => r / n.reachMax[1] * REACH_SCALE)] })) }));
  return auditLibrarySpot(adapted, ranges, setup);
}
