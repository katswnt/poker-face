/** Exact evaluation and information-set BR of a finite exported river tree, not a solve.
 * Independent card ranks, chip reducer and blocker kernels; naive pair enumeration is the
 * test oracle. Maximize only AFTER summing hidden opponent hands. Values are net chips from
 * the spot origin; forced-prefix sunk bets remain in that origin for both comparisons.
 */
import { checkBridgeResult, parseBridgeCombo, validateBridgeSpot, type BridgeExplicitNode, type BridgeResultV1, type BridgeSpotV1 } from "./contract";
import { RIVER_DECK, riverComboKey, riverHandScore } from "../river/cards";
import { createVectorKernelScratch, naiveTerminalValues, vectorTerminalValues } from "../postflop/vector/kernels";
import type { VectorRange, VectorRanges } from "../postflop/vector/ranges";
import { actionToken, applyPublicEvent, initialPublicState } from "../../hu-play/public-state";
import type { HeadsUpPublicState } from "../../hu-play/types";

export function compileBridgeRiverRanges(input: BridgeSpotV1): VectorRanges {
  const spot = validateBridgeSpot(input);
  if (!spot.board.turn || !spot.board.river) throw new Error("River hand values need five public cards");
  const board = [...spot.board.flop, spot.board.turn, spot.board.river];
  const compile = (p: 0 | 1): VectorRange => {
    const hands = spot.ranges[p].combos.map(h => parseBridgeCombo(h.combo));
    const ranks = Float64Array.from(hands.map(h => riverHandScore(h, board)));
    return { hands, weights: Float64Array.from(spot.ranges[p].combos.map(h => h.weight)),
      card0: Uint8Array.from(hands.map(h => RIVER_DECK.indexOf(h[0]))), card1: Uint8Array.from(hands.map(h => RIVER_DECK.indexOf(h[1]))),
      sameOpponent: new Int32Array(hands.length).fill(-1), compatibleCounts: new Uint16Array(2 * hands.length), ranks,
      rankOrders: [Int32Array.from(hands.map((_, i) => i).sort((a, b) => ranks[a] - ranks[b] || a - b))] };
  };
  const players = [compile(0), compile(1)] as const;
  for (const p of [0, 1] as const) {
    const own = players[p], other = players[1 - p], index = new Map(other.hands.map((h, i) => [riverComboKey(h), i]));
    const byCard = new Uint16Array(52);
    for (let j = 0; j < other.hands.length; j++) { byCard[other.card0[j]]++; byCard[other.card1[j]]++; }
    own.hands.forEach((h, i) => {
      own.sameOpponent[i] = index.get(riverComboKey(h)) ?? -1;
      const n = other.hands.length - byCard[own.card0[i]] - byCard[own.card1[i]] + Number(own.sameOpponent[i] >= 0);
      own.compatibleCounts[i] = n; own.compatibleCounts[own.hands.length + i] = n;
    });
  }
  return { players, rivers: [spot.board.river], riverCardIds: Uint8Array.of(RIVER_DECK.indexOf(spot.board.river)),
    compatibleDeals: players[0].compatibleCounts.subarray(0, players[0].hands.length).reduce((s, n) => s + n, 0), blockedCombos: [0, 0] };
}

export function gradeRiverHands(input: BridgeSpotV1, raw: BridgeResultV1, kernel: "vector" | "naive" = "vector") {
  const spot = validateBridgeSpot(input), r = checkBridgeResult(raw, spot, raw.spotHash);
  return gradeRiverProfile(spot, r, kernel);
}

/** Derived/composed policies have no upstream EVs, solve status or engine hash. Grade only
 * their actual tree and strategy, rather than attaching fabricated engine metadata.
 */
export type RiverProfile = Pick<BridgeResultV1, "hands" | "tree">;
export function gradeRiverProfile(input: BridgeSpotV1, r: RiverProfile, kernel: "vector" | "naive" = "vector") {
  const spot = validateBridgeSpot(input);
  if (kernel !== "vector" && kernel !== "naive") throw new Error("Unknown river terminal kernel");
  for (const p of [0, 1] as const) if (!Array.isArray(r.hands?.[p])
    || r.hands[p].join() !== spot.ranges[p].combos.map(h => h.combo).join()) throw new Error("River profile hands differ from spot ranges");
  if (!Array.isArray(r.tree) || !r.tree.length || r.tree.length > 200000) throw new Error("River public-node bound exceeded");
  r.tree.forEach((node, id) => {
    if (!node || node.id !== id || !["player", "terminal"].includes(node.kind)) throw new Error("Invalid river profile node");
    if (node.kind === "player") {
      if ((node.player !== 0 && node.player !== 1) || !Array.isArray(node.actions) || !Array.isArray(node.strategy)
        || node.strategy.length !== node.actions.length || node.strategy.some((row: readonly (number | null)[]) => !Array.isArray(row)
          || row.length !== r.hands[node.player].length || row.some(v => v !== null && (!Number.isFinite(v) || v < 0 || v > 1)))) {
        throw new Error("Invalid river strategy shape or probability");
      }
      if (node.actions.some((e: { child: number }) => !Number.isSafeInteger(e.child) || e.child <= id || e.child >= r.tree.length)) throw new Error("Invalid river child");
    }
  });
  const ranges = compileBridgeRiverRanges(spot), seen = new Uint8Array(r.tree.length);
  const policies: Float64Array[][] = r.tree.map(() => []);
  let root = initialPublicState({ startingPot: spot.startingPot, startingStack: spot.effectiveStack, minimumBet: 1, flop: spot.board.flop });
  for (const [street, card] of [["turn", spot.board.turn!], ["river", spot.board.river!]] as const) {
    root = applyPublicEvent(root, { kind: "action", player: 0, action: { type: "check" } });
    root = applyPublicEvent(root, { kind: "action", player: 1, action: { type: "check" } });
    root = applyPublicEvent(root, { kind: "card", street, card });
  }
  let maxDepth = 0, maxColumnSumError = 0;
  const verify = (id: number, p: HeadsUpPublicState, depth: number, expected?: BridgeExplicitNode) => {
    if (seen[id]) throw new Error("River tree repeats a child"); seen[id] = 1; maxDepth = Math.max(maxDepth, depth);
    const n = r.tree[id];
    if (n.kind === "chance" || n.board.join() !== [...spot.board.flop, spot.board.turn, spot.board.river].join()) throw new Error("River export board or chance differs");
    if (n.committed.some((v, i) => v !== p.closed + p.streetPut[i])) throw new Error("River committed chips disagree with public history");
    if (expected && n.kind !== expected.kind) throw new Error("River export kind differs from explicit game");
    if (n.kind === "terminal") {
      if (p.status !== n.outcome || p.folder !== n.folder) throw new Error("River terminal disagrees with public history");
      return;
    }
    if (p.status !== "betting" || p.toAct !== n.player || n.street !== "river" || !n.actions.length) throw new Error("River player differs");
    if (expected?.kind === "player" && (expected.player !== n.player
      || expected.actions.map(e => actionToken(e.action)).join() !== n.actions.map(e => actionToken(e.action)).join())) throw new Error("River export actions differ from explicit game");
    const own = ranges.players[n.player], rows = n.actions.map(() => new Float64Array(own.hands.length));
    for (let h = 0; h < own.hands.length; h++) {
      if (!own.compatibleCounts[h]) continue;
      const col = n.strategy.map(row => row[h]);
      if (col.some(v => v === null || !Number.isFinite(v) || v < 0)) throw new Error("Missing live river strategy column");
      const sum = (col as number[]).reduce((a, b) => a + b, 0);
      maxColumnSumError = Math.max(maxColumnSumError, Math.abs(sum - 1));
      if (Math.abs(sum - 1) > 1e-5) throw new Error("Invalid river column sum");
      col.forEach((v, a) => { rows[a][h] = v! / sum; });
    }
    policies[id] = rows;
    n.actions.forEach((e, a) => verify(e.child, applyPublicEvent(p, { kind: "action", player: n.player, action: e.action }), depth + 1,
      expected?.kind === "player" ? expected.actions[a].next : undefined));
  };
  verify(0, root, 0, spot.tree.mode === "menu" ? undefined : spot.tree.root);
  if (seen.some(v => !v)) throw new Error("River export has unreachable nodes");
  const terminal = kernel === "vector" ? vectorTerminalValues : naiveTerminalValues;
  const compatible = ([0, 1] as const).map(p => {
    const out = new Float64Array(r.hands[p].length), other = ranges.players[1 - p];
    terminal(ranges, p, 0, other.weights, 1, 1, out, createVectorKernelScratch(other.hands.length)); return out;
  });
  const normalizer = ranges.players[0].weights.reduce((sum, w, h) => sum + w * compatible[0][h], 0);
  if (!(normalizer > 0)) throw new Error("Empty river compatible mass");
  const evaluate = (p: 0 | 1, br: boolean) => {
    const own = ranges.players[p], other = ranges.players[1 - p], scratch = createVectorKernelScratch(other.hands.length);
    const values = Array.from({ length: maxDepth + 1 }, () => new Float64Array(own.hands.length));
    const reaches = Array.from({ length: maxDepth + 1 }, () => new Float64Array(other.hands.length));
    reaches[0].set(other.weights);
    const walk = (id: number, depth: number): Float64Array => {
      const n = r.tree[id], out = values[depth], reach = reaches[depth];
      if (n.kind === "chance") throw new Error("River chance");
      if (n.kind === "terminal") {
        const fold = n.outcome === "fold", sign = fold ? n.folder === p ? -1 : 1 : 0;
        const scale = spot.startingPot / 2 + (fold ? n.committed[n.folder!] : Math.min(...n.committed));
        terminal(ranges, p, 0, reach, scale, sign, out, scratch); return out;
      }
      const hero = n.player === p;
      out.fill(hero && br ? -Infinity : 0);
      n.actions.forEach((edge, a) => {
        reaches[depth + 1].set(reach.map((w, j) => w * (hero ? 1 : policies[id][a][j])));
        const child = walk(edge.child, depth + 1);
        for (let h = 0; h < out.length; h++) {
          if (!own.compatibleCounts[h]) out[h] = 0;
          else if (hero && br) out[h] = Math.max(out[h], child[h]);
          else out[h] += child[h] * (hero ? policies[id][a][h] : 1);
        }
      });
      return out;
    };
    const cf = walk(0, 0);
    return { value: own.weights.reduce((sum, w, h) => sum + w * cf[h] / normalizer, 0),
      perHand: Array.from(cf, (v, h) => compatible[p][h] > 0 ? v / compatible[p][h] : null) };
  };
  const profile = [evaluate(0, false), evaluate(1, false)], response = [evaluate(0, true), evaluate(1, true)];
  const value = profile.map(v => v.value) as [number, number], tolerance = 1e-10 * (spot.startingPot + spot.effectiveStack);
  if (value.some(v => !Number.isFinite(v)) || Math.abs(value[0] + value[1]) > tolerance) throw new Error("River value is not finite zero-sum");
  const gains = response.map((v, p) => {
    const gain = v.value - value[p]; if (!Number.isFinite(gain) || gain < -tolerance) throw new Error("Invalid river BR gain"); return Math.max(0, gain);
  }) as [number, number];
  const exploitability = (gains[0] + gains[1]) / 2;
  return { value, gains, exploitability, exploitabilityPctPot: 100 * exploitability / spot.startingPot,
    perHand: ([0, 1] as const).map(p => ({ hands: r.hands[p], value: profile[p].perHand, bestResponse: response[p].perHand })),
    compatibleDeals: ranges.compatibleDeals, publicNodes: r.tree.length, maxColumnSumError,
    grader: "bridge-river-public-information-per-hand-best-response" as const };
}
