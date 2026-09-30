/** P1 offline admission diagnostic. No substitute policy, no solve, no production ladder. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mulberry32 } from "../src/lib/poker/equity";
import { reachCapacityBound, type ReachCapacityBound } from "../src/lib/hu-play/admission";
import { advance, applyHumanAction, startHand, type DecisionSource, type HuRanges } from "../src/lib/hu-play/hand";
import { actionToken, isStreetRoot, illegalActionReason } from "../src/lib/hu-play/public-state";
import { rangeFromBridge } from "../src/lib/hu-play/reach";
import { buildResolveSpot, HU_RESOLVE_SOLVE } from "../src/lib/hu-play/resolve-spot";
import { dealFromSeed, decisionDraw, fnv1a, sampleAction } from "../src/lib/hu-play/rng";
import type { HeadsUpPublicState } from "../src/lib/hu-play/types";
import { validateBridgeSpot, type BridgeAction, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { LEAN_SRP_TREE } from "../src/lib/solver/bridge/fixtures";
import { LIVE_LIMITS, parseLiveSpot } from "../src/lib/solver/bridge/live/admission";
import { libraryRangesFromSpot, validateLibraryChunk, validateLibraryManifest, validateLibraryRef } from "../src/lib/solver/bridge/library/load";
import { chunkKeyForNode, STRATEGY_SCALE, type BridgeLibraryChunk, type BridgeLibraryFileRef, type BridgeLibrarySpot } from "../src/lib/solver/bridge/library/model";
import { findLibraryNode, parseActionToken } from "../src/lib/solver/bridge/library/query";

export interface ProbeRoot {
  seed: number; librarySpotId: string; publicState: HeadsUpPublicState;
  spot: BridgeSpotV1; spotHash: string; capacity: readonly [ReachCapacityBound, ReachCapacityBound];
  savedBoardAvailable: boolean; exactNodeAvailable: boolean; browserInputError: string | null;
}
const hash = (input: string | Uint8Array) => createHash("sha256").update(input).digest("hex");
const actionFromToken = (token: string): BridgeAction => {
  const a = parseActionToken(token);
  return a.kind === "bet" || a.kind === "raise" ? { type: a.kind, to: a.to! } : { type: a.kind };
};
class LibraryGap extends Error {}

export function probeLibraryPrefixes(seeds: readonly number[]) {
  if (new Set(seeds).size !== seeds.length || seeds.some(s => !Number.isSafeInteger(s) || s < 0 || s > 0xffffffff)) {
    throw new Error("Probe seeds must be distinct uint32 values");
  }
  const files = new Map<string, { url: string; bytes: number; sha256: string }>();
  const jsonCache = new Map<string, unknown>();
  const read = (url: string, ref?: BridgeLibraryFileRef): unknown => {
    if (ref) validateLibraryRef(ref, "probe input");
    if (!jsonCache.has(url)) {
      const bytes = readFileSync(`public${url}`), sha256 = hash(bytes);
      if (ref) { assert.equal(bytes.length, ref.bytes); assert.equal(sha256, ref.sha256); }
      files.set(url, { url, bytes: bytes.length, sha256 });
      jsonCache.set(url, JSON.parse(bytes.toString("utf8")));
    }
    return jsonCache.get(url);
  };
  const manifest = validateLibraryManifest(read("/solver-data/bridge-v1/manifest.json"));
  assert.equal(manifest.spots.length, 12);
  const roots: ProbeRoot[] = [];
  const hands: { seed: number; aiSeat: 0 | 1; librarySpotId: string; outcome: "completed" | "unavailable";
    reason: string | null; path: readonly string[]; publicPrefixHash: string }[] = [];
  const chunkCache = new Map<string, BridgeLibraryChunk>();
  for (const seed of seeds) {
    const entry: BridgeLibrarySpot = manifest.spots[Math.floor(mulberry32(fnv1a(`hu-probe-flop|${seed}`))() * manifest.spots.length)];
    const spot = validateBridgeSpot(read(entry.spot.url, entry.spot));
    assert.equal(hashBridgeSpot(spot), entry.spotHash);
    const libraryRanges = libraryRangesFromSpot(spot, entry), aiSeat = (seed % 2) as 0 | 1;
    const config = { handSeed: seed, aiSeat, startingPot: 550, startingStack: 9750, minimumBet: 100, flop: spot.board.flop };
    assert.equal(spot.startingPot, config.startingPot); assert.equal(spot.effectiveStack, config.startingStack);
    const ranges: HuRanges = { ai: rangeFromBridge(spot.ranges[aiSeat]), human: rangeFromBridge(spot.ranges[1 - aiSeat]) };
    const deal = dealFromSeed(seed, config.flop, spot.ranges, aiSeat);
    const captured = new Set<string>();
    let lastPublic: HeadsUpPublicState;
    const nodeAt = (state: HeadsUpPublicState) => {
      const board = [...state.board.flop, ...(state.board.turn ? [state.board.turn] : []), ...(state.board.river ? [state.board.river] : [])];
      const key = chunkKeyForNode({ street: state.street, board, path: state.path.join(" ") }), ref = entry.chunks[key];
      if (!ref) return null;
      if (!chunkCache.has(ref.url)) chunkCache.set(ref.url, validateLibraryChunk(read(ref.url, ref), entry, key, libraryRanges));
      return findLibraryNode(chunkCache.get(ref.url)!, state.path);
    };
    const observe = (state: HeadsUpPublicState, reach: HuRanges) => {
      lastPublic = state;
      const key = state.path.join(" ");
      if (state.street === "flop" || !isStreetRoot(state) || captured.has(key)) return;
      captured.add(key);
      const full = buildResolveSpot({ publicState: state, aiSeat, ranges: reach, tree: LEAN_SRP_TREE,
        solve: { ...HU_RESOLVE_SOLVE, memoryCapBytes: LIVE_LIMITS.budgetBytes }, minimumRelativeReach: 0 });
      const bySeat = aiSeat === 0 ? [reach.ai, reach.human] : [reach.human, reach.ai];
      const capacity = bySeat.map(r => reachCapacityBound(r.entries.map(e => e.weight), LIVE_LIMITS.rangeHands, .99)) as [ReachCapacityBound, ReachCapacityBound];
      // No f32-normalization underflow is allowed to disappear from the diagnostic.
      assert.deepEqual(full.ranges.map(r => r.combos.length), capacity.map(c => c.totalHands));
      let browserInputError: string | null = null;
      try { parseLiveSpot(JSON.stringify(full)); } catch (e) { browserInputError = (e as Error).message; }
      roots.push({ seed, librarySpotId: entry.id, publicState: state, spot: full, spotHash: hashBridgeSpot(full), capacity,
        savedBoardAvailable: state.street === "turn" ? entry.turnCards.includes(state.board.turn!)
          : entry.riverBoards.some(([t, r]) => t === state.board.turn && r === state.board.river),
        exactNodeAvailable: nodeAt(state) !== null, browserInputError });
    };
    const policy = (state: HeadsUpPublicState, reach: HuRanges) => {
      observe(state, reach);
      const node = nodeAt(state);
      if (!node) throw new LibraryGap(`No exact saved ${state.street} decision at ${state.path.join(" ") || "root"}`);
      assert.equal(node.player, state.toAct);
      assert.deepEqual(node.committed, state.streetPut.map(p => p + state.closed));
      const actions = node.actions.map(actionFromToken);
      for (const a of actions) assert.equal(illegalActionReason(state, a), null);
      const incoming = node.player === aiSeat ? reach.ai : reach.human;
      const columns = new Map(node.live[node.player].map((h, i) => [libraryRanges.hands[node.player][h], i]));
      for (const e of incoming.entries) if (e.weight > 0 && !columns.has(e.combo)) {
        throw new LibraryGap(`Saved ${state.street} node omits a positive-reach strategy column`);
      }
      const probability = (action: BridgeAction, combo: string) => {
        const a = node.actions.indexOf(actionToken(action)), h = columns.get(combo);
        if (a < 0) throw new LibraryGap("Action is not in the saved policy");
        return h === undefined ? 0 : node.strategy[a][h] / STRATEGY_SCALE;
      };
      return { actions, probability, distribution: (combo: string) => {
        if (!columns.has(combo)) throw new LibraryGap("Dealt hand has no saved strategy column");
        return actions.map(action => ({ action, probability: probability(action, combo) }));
      } };
    };
    const source: DecisionSource = {
      decide(request) {
        const p = policy(request.publicState, request.ranges);
        return { strategy: p.distribution(request.aiHand), rangeProbability: p.probability,
          provenance: { source: "library", spotHash: entry.spotHash, librarySpotId: entry.id } };
      },
      humanModel(request, action) {
        const p = policy(request.publicState, request.ranges);
        return combo => p.probability(action, combo);
      },
    };
    let state = startHand(config, deal, ranges);
    lastPublic = state.public;
    try {
      state = advance(state, source);
      for (let guard = 0; !state.result && guard < 200; guard++) {
        const p = policy(state.public, state.ranges);
        const u = decisionDraw(fnv1a(`hu-probe-human|${seed}`), state.humanActions.length, state.public.path);
        state = applyHumanAction(state, sampleAction(p.distribution(deal.humanHand), u).action, source);
      }
      assert.ok(state.result, "real reducer must terminate or report a missing policy");
      assert.equal(state.result.payouts[0] + state.result.payouts[1], state.public.pot);
      assert.equal(state.result.net[0] + state.result.net[1], 0); // P0's equal-share pot origin, not a preflop ledger.
      hands.push({ seed, aiSeat, librarySpotId: entry.id, outcome: "completed", reason: null,
        path: state.public.path, publicPrefixHash: hash(JSON.stringify(state.public)) });
    } catch (error) {
      if (!(error instanceof LibraryGap)) throw error;
      hands.push({ seed, aiSeat, librarySpotId: entry.id, outcome: "unavailable", reason: error.message,
        path: lastPublic.path, publicPrefixHash: hash(JSON.stringify(lastPublic)) });
    }
  }
  return { hands, roots, inputFiles: [...files.values()].sort((a, b) => a.url.localeCompare(b.url)) };
}
