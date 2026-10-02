/** Complete, even-pot turn-game referee for P1's full-range comparison.
 * Independent of Rust/DCFR. Uses our card evaluator, blocker/rank kernels and public chip
 * reducer. Best response maximizes per own hand AFTER summing hidden opponent hands and
 * future cards. The quadratic kernel remains an oracle. No first-street/truncated grades.
 * Cryptographic input/result binding belongs to the caller (as in subgame-referee.ts).
 */
import { checkBridgeResult, parseBridgeCombo, validateBridgeSpot, type BridgeResultV1, type BridgeSpotV1 } from "./contract";
import { RIVER_DECK, riverComboKey, riverHandScore } from "../river/cards";
import { createVectorKernelScratch, naiveTerminalValues, vectorTerminalValues } from "../postflop/vector/kernels";
import type { VectorRange, VectorRanges } from "../postflop/vector/ranges";
import { applyPublicEvent, initialPublicState } from "../../hu-play/public-state";
import type { HeadsUpPublicState } from "../../hu-play/types";

/** Same audited kernel layout, without the teaching parser's 64-hand/1e-12 weight limits.
 * At most 1,326 legal combos: support counters fit Uint16. Every positive weight is kept.
 */
export function compileBridgeTurnRanges(input: BridgeSpotV1): VectorRanges {
  const spot = validateBridgeSpot(input);
  if (!spot.board.turn || spot.board.river) throw new Error("Complete turn referee requires exactly four public cards");
  const board = [...spot.board.flop, spot.board.turn], rivers = RIVER_DECK.filter(c => !board.includes(c));
  const riverCardIds = Uint8Array.from(rivers.map(c => RIVER_DECK.indexOf(c)));
  const compilePlayer = (range: BridgeSpotV1["ranges"][number]) => {
    const hands = range.combos.map(h => parseBridgeCombo(h.combo));
    return { hands, weights: Float64Array.from(range.combos.map(h => h.weight)),
      card0: Uint8Array.from(hands.map(h => RIVER_DECK.indexOf(h[0]))), card1: Uint8Array.from(hands.map(h => RIVER_DECK.indexOf(h[1]))),
      sameOpponent: new Int32Array(hands.length).fill(-1), compatibleCounts: new Uint16Array(49 * hands.length),
      ranks: new Float64Array(48 * hands.length), rankOrders: [] as Int32Array[] };
  };
  const players = [compilePlayer(spot.ranges[0]), compilePlayer(spot.ranges[1])] satisfies [VectorRange, VectorRange];
  for (const p of [0, 1] as const) {
    const own = players[p], other = players[1 - p], keys = new Map(other.hands.map((h, i) => [riverComboKey(h), i]));
    own.hands.forEach((h, i) => { own.sameOpponent[i] = keys.get(riverComboKey(h)) ?? -1; });
    for (let river = -1; river < 48; river++) {
      const card = river < 0 ? -1 : riverCardIds[river], byCard = new Uint16Array(52); let total = 0;
      for (let j = 0; j < other.hands.length; j++) {
        if (other.card0[j] === card || other.card1[j] === card) continue;
        total++; byCard[other.card0[j]]++; byCard[other.card1[j]]++;
      }
      const order: number[] = [];
      for (let h = 0; h < own.hands.length; h++) {
        if (own.card0[h] === card || own.card1[h] === card) continue;
        own.compatibleCounts[(river + 1) * own.hands.length + h] = total - byCard[own.card0[h]] - byCard[own.card1[h]] + Number(own.sameOpponent[h] >= 0);
        if (river >= 0) { own.ranks[river * own.hands.length + h] = riverHandScore(own.hands[h], [...board, rivers[river]]); order.push(h); }
      }
      if (river >= 0) own.rankOrders.push(Int32Array.from(order.sort((a, b) =>
        own.ranks[river * own.hands.length + a] - own.ranks[river * own.hands.length + b] || a - b)));
    }
  }
  const compatibleDeals = players[0].compatibleCounts.subarray(0, players[0].hands.length).reduce((a, b) => a + b, 0);
  if (!compatibleDeals) throw new Error("No compatible private deals");
  return { players, rivers, riverCardIds, compatibleDeals, blockedCombos: [0, 0] };
}

export function gradeBridgeTurn(input: BridgeSpotV1, raw: BridgeResultV1, kernel: "vector" | "naive" = "vector") {
  if (input.solve.exportScope !== "full") throw new Error("Turn grade requires a complete export, never truncated continuations");
  return gradeCompleteTurn(input, raw, kernel);
}

/** A first-street export is complete only when no river betting continuation exists.
 * This separate entry never upgrades a truncated chance node to a complete strategy.
 * The ordinary complete-export referee above retains its original strict contract.
 */
export function gradeTerminalTurnExport(input: BridgeSpotV1, raw: BridgeResultV1, kernel: "vector" | "naive" = "vector") {
  if (input.tree.mode !== "turn-subgame-v1" || raw.tree.some(n => n.kind === "chance")) {
    throw new Error("Terminal turn quality requires a complete policy with no chance continuation or truncation");
  }
  return gradeCompleteTurn(input, raw, kernel);
}

function gradeCompleteTurn(input: BridgeSpotV1, raw: BridgeResultV1, kernel: "vector" | "naive") {
  const spot = validateBridgeSpot(input), result = checkBridgeResult(raw, spot, raw.spotHash);
  if (kernel !== "vector" && kernel !== "naive") throw new Error("Unknown terminal kernel");
  if (result.tree.some(n => n.kind === "chance" && n.truncated)) throw new Error("Turn grade requires a complete export, never truncated continuations");
  if (result.tree.length > 200000) throw new Error("Turn referee public-node bound exceeded");
  const ranges = compileBridgeTurnRanges(spot), nodes = result.tree;
  const riverAt = Int16Array.from(nodes.map(n => n.board.length === 4 ? -1 : ranges.rivers.indexOf(n.board[4])));
  const policies: (readonly Float64Array[] | null)[] = nodes.map(() => null);
  const seen = new Uint8Array(nodes.length);
  let maximumDepth = 0, maximumColumnSumError = 0;
  let root = initialPublicState({ startingPot: spot.startingPot, startingStack: spot.effectiveStack, minimumBet: 1, flop: spot.board.flop });
  root = applyPublicEvent(root, { kind: "action", player: 0, action: { type: "check" } });
  root = applyPublicEvent(root, { kind: "action", player: 1, action: { type: "check" } });
  root = applyPublicEvent(root, { kind: "card", street: "turn", card: spot.board.turn! });
  const verify = (id: number, state: HeadsUpPublicState, depth: number) => {
    if (seen[id]) throw new Error("Turn export repeats a public child"); seen[id] = 1;
    maximumDepth = Math.max(maximumDepth, depth);
    const n = nodes[id], board = [...state.board.flop, state.board.turn!, ...(state.board.river ? [state.board.river] : [])];
    if (n.board.join() !== board.join()) throw new Error("Turn export board disagrees with public history");
    if (n.committed.some((c, p) => c !== state.closed + state.streetPut[p])) throw new Error("Turn export committed chips disagree with public history");
    if (n.kind === "terminal") {
      // The bridge represents a called turn all-in as a four-card showdown terminal;
      // its remaining river is implicit, not an omitted betting continuation.
      const allInRunout = n.outcome === "showdown" && state.status === "chance"
        && board.length === 4 && state.stacks.every(s => s === 0);
      if ((!allInRunout && n.outcome !== state.status) || n.folder !== state.folder) throw new Error("Turn terminal outcome differs from public history");
      return;
    }
    if (n.kind === "chance") {
      if (state.status !== "chance" || n.street !== "river") throw new Error("Unexpected turn chance node");
      const children = new Map(n.children.map(e => [e.card, e.child]));
      if (children.size !== n.children.length || new Set(n.impossibleCards).size !== n.impossibleCards.length) throw new Error("Repeated river outcome");
      for (const card of ranges.rivers) {
        const r = ranges.rivers.indexOf(card), own = ranges.players[0];
        const possible = own.compatibleCounts.subarray((r + 1) * own.hands.length, (r + 2) * own.hands.length).some(c => c > 0);
        if (possible !== children.has(card) || possible === n.impossibleCards.includes(card)) throw new Error("Incomplete or wrongly impossible river outcome");
      }
      if (n.children.length + n.impossibleCards.length !== 48) throw new Error("Incomplete river enumeration");
      for (const e of n.children) verify(e.child, applyPublicEvent(state, { kind: "card", street: "river", card: e.card }), depth + 1);
      return;
    }
    if (state.status !== "betting" || n.player !== state.toAct || n.street !== state.street || !n.actions.length) throw new Error("Unexpected turn actor");
    const own = ranges.players[n.player], rows = n.actions.map(() => new Float64Array(own.hands.length));
    for (let h = 0; h < own.hands.length; h++) {
      if (!own.compatibleCounts[(riverAt[id] + 1) * own.hands.length + h]) continue;
      const col = n.strategy.map(row => row[h]);
      if (col.some(p => p === null || !Number.isFinite(p) || p < 0)) throw new Error("Missing live turn strategy column");
      const sum = (col as number[]).reduce((a, b) => a + b, 0);
      maximumColumnSumError = Math.max(maximumColumnSumError, Math.abs(sum - 1));
      if (Math.abs(sum - 1) > 1e-5) throw new Error("Invalid turn strategy sum");
      col.forEach((v, a) => { rows[a][h] = v! / sum; });
    }
    policies[id] = rows;
    for (const e of n.actions) verify(e.child, applyPublicEvent(state, { kind: "action", player: n.player, action: e.action }), depth + 1);
  };
  verify(0, root, 0);
  if (seen.some(n => n !== 1)) throw new Error("Unreachable nodes in turn export");

  const terminal = kernel === "vector" ? vectorTerminalValues : naiveTerminalValues;
  const compatible = ([0, 1] as const).map(p => {
    const out = new Float64Array(ranges.players[p].hands.length), other = ranges.players[1 - p];
    terminal(ranges, p, -1, other.weights, 1, 1, out, createVectorKernelScratch(other.hands.length)); return out;
  });
  const normalizer = ranges.players[0].weights.reduce((s, w, h) => s + w * compatible[0][h], 0);
  if (!(normalizer > 0)) throw new Error("Non-positive turn deal normalizer");
  const evaluate = (player: 0 | 1, response: boolean) => {
    const own = ranges.players[player], other = ranges.players[1 - player], h = own.hands.length, k = other.hands.length;
    const values = Array.from({ length: maximumDepth + 1 }, () => new Float64Array(h));
    const reach = Array.from({ length: maximumDepth + 1 }, () => new Float64Array(k));
    reach[0].set(other.weights);
    const scratch = createVectorKernelScratch(k);
    const runout = new Float64Array(h);
    const walk = (id: number, depth: number): Float64Array => {
      const n = nodes[id], out = values[depth], weights = reach[depth], river = riverAt[id];
      if (n.kind === "terminal") {
        const fold = n.outcome === "fold", sign = fold ? n.folder === player ? -1 : 1 : 0;
        const scale = spot.startingPot / 2 + (fold ? n.committed[n.folder!] : Math.min(...n.committed));
        if (!fold && river < 0) {
          out.fill(0);
          for (let r = 0; r < 48; r++) {
            terminal(ranges, player, r, weights, scale, 0, runout, scratch);
            for (let i = 0; i < h; i++) out[i] += runout[i] / 44;
          }
          return out;
        }
        terminal(ranges, player, river, weights, scale, sign, out, scratch); return out;
      }
      const chance = n.kind === "chance", hero = n.kind === "player" && n.player === player;
      out.fill(hero && response ? -Infinity : 0);
      const edges = n.kind === "chance" ? n.children : n.actions;
      edges.forEach((edge, a) => {
        const childWeights = reach[depth + 1];
        for (let j = 0; j < k; j++) childWeights[j] = weights[j] * (!chance && !hero ? policies[id]![a][j] : 1);
        const child = walk(edge.child, depth + 1);
        for (let i = 0; i < h; i++) {
          if (!own.compatibleCounts[(river + 1) * h + i]) { out[i] = 0; continue; }
          if (chance) out[i] += child[i] / 44; // 52 minus four board cards and BOTH private hands
          else if (!hero) out[i] += child[i];
          else if (response) out[i] = Math.max(out[i], child[i]);
          else out[i] += policies[id]![a][i] * child[i];
        }
      });
      return out;
    };
    const cf = walk(0, 0);
    return { value: own.weights.reduce((sum, w, i) => sum + w * cf[i] / normalizer, 0),
      perHand: Array.from(cf, (v, i) => compatible[player][i] > 0 ? v / compatible[player][i] : null) };
  };
  const profile = [evaluate(0, false), evaluate(1, false)], response = [evaluate(0, true), evaluate(1, true)];
  const value = profile.map(p => p.value) as [number, number], tolerance = 1e-10 * (spot.startingPot + spot.effectiveStack);
  if (value.some(v => !Number.isFinite(v)) || Math.abs(value[0] + value[1]) > tolerance) throw new Error("Turn profile is not finite zero-sum");
  const gains = response.map((r, p) => {
    const gain = r.value - value[p]; if (!Number.isFinite(gain) || gain < -tolerance) throw new Error("Invalid turn best-response gain"); return Math.max(0, gain);
  }) as [number, number];
  const exploitability = (gains[0] + gains[1]) / 2;
  return { value, gains, exploitability, exploitabilityPctPot: 100 * exploitability / spot.startingPot,
    perHand: ([0, 1] as const).map(p => ({ hands: result.hands[p], value: profile[p].perHand, bestResponse: response[p].perHand })),
    compatibleDeals: ranges.compatibleDeals, publicNodes: nodes.length, maximumColumnSumError,
    grader: "complete-bridge-turn-public-information-best-response" };
}
