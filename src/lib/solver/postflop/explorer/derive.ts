import type { BehavioralStrategy } from "../../toy/game";
import { encodeVectorPolicy } from "../vector/core";
import type { TurnV2Game } from "../configurable-turn/game";
import type { TurnV2Action } from "../configurable-turn/rules";
import { CONDITIONAL_MIN_REACH, type ActionView, type ExplorerChunk, type HandView, type NodeView } from "./model";

/** Offline only. Bounded explicit-pair explanation, separate from CFR and its grader.
 * Summary columns: EV0, fold0, fold1, win0, split, win1. Never best-respond here. */
export function deriveTurnExplorer(game: TurnV2Game, policy: BehavioralStrategy<TurnV2Action>, sourceHash: string): ExplorerChunk[] {
  if (game.ranges.players.some(p => p.hands.length > 8) || game.ranges.compatibleDeals > 16 || game.index.totalStates > 100_000) {
    throw new Error("Saved explorer derivation is bounded to 8 hands/player, 16 deals and 100,000 equivalent states");
  }
  const flat = encodeVectorPolicy(game, policy), size = game.publicStates.length;
  const children = (n: number) => Array.from(game.edgeChildren.subarray(game.nodeEdgeStarts[n], game.nodeEdgeStarts[n] + game.nodeEdgeCounts[n]));
  const edges = game.publicStates.map((_, n) => children(n));
  const parents = Array<number | null>(size).fill(null);
  edges.forEach((nodes, n) => nodes.forEach(child => { parents[child] = n; }));
  const probabilities = (n: number, h: number) => {
    const p = game.publicStates[n].actor!;
    const info = game.lookup[p][n * game.ranges.players[p].hands.length + h];
    if (info < 0) throw new Error("Missing live explorer information set");
    return flat.subarray(game.actionStarts[info], game.actionStarts[info] + game.actionCounts[info]);
  };
  const pairs: { hands: number[]; reach: Float64Array; values: Float64Array; live: (n: number) => boolean; wins: (number | null)[]; checkdown0: number }[] = [];
  for (const [a, left] of game.ranges.players[0].hands.entries()) for (const [b, right] of game.ranges.players[1].hands.entries()) {
    if (left.some(c => right.includes(c))) continue;
    const hands = [a, b], cards = [...left, ...right];
    const reach = new Float64Array(size), values = new Float64Array(size * 6);
    const live = (n: number) => game.publicStates[n].river === null || !cards.includes(game.publicStates[n].river!);
    const wins = game.ranges.rivers.map((river, r) => cards.includes(river) ? null : Math.sign(
      game.ranges.players[0].ranks[r * game.ranges.players[0].hands.length + a]
      - game.ranges.players[1].ranks[r * game.ranges.players[1].hands.length + b]));
    const checkdown0 = wins.reduce<number>((sum, win) => sum + (win === null ? 0 : (win + 1) / 2), 0) / 44;
    // Public nodes are preorder, so forward propagation needs no recursive state replay.
    reach[0] = game.ranges.players[0].weights[a] * game.ranges.players[1].weights[b] / game.rootNormalizer;
    for (let n = 0; n < size; n++) {
      if (!live(n)) continue;
      const state = game.publicStates[n];
      if (state.phase === "river-card") for (const child of edges[n]) { if (live(child)) reach[child] = reach[n] / 44; }
      else if (state.phase === "play") {
        const probs = probabilities(n, hands[state.actor!]);
        edges[n].forEach((child, i) => { reach[child] = reach[n] * probs[i]; });
      }
    }
    for (const n of game.postorder) {
      if (!live(n)) continue;
      const state = game.publicStates[n], offset = n * 6;
      if (state.phase === "terminal") {
        const sign = state.folded === null ? wins[game.nodeRivers[n]]! : state.folded === 0 ? -1 : 1;
        values[offset] = sign * (game.request.committedPerPlayer + state.carried);
        values[offset + (state.folded === 0 ? 1 : state.folded === 1 ? 2 : sign === 1 ? 3 : sign === 0 ? 4 : 5)] = 1;
      } else {
        const probs = state.phase === "play" ? probabilities(n, hands[state.actor!]) : null;
        edges[n].forEach((child, i) => {
          if (!live(child)) return;
          const weight = probs ? probs[i] : 1 / 44;
          for (let k = 0; k < 6; k++) values[offset + k] += weight * values[child * 6 + k];
        });
      }
    }
    pairs.push({ hands, reach, values, live, wins, checkdown0 });
  }
  const reaches = game.publicStates.map((_, n) => pairs.reduce((sum, pair) => sum + pair.reach[n], 0));
  const supports = game.publicStates.map((_, n) => pairs.filter(pair => pair.live(n)).length);
  const chunks = new Map<string, ExplorerChunk>();
  for (let n = 0; n < size; n++) {
    const state = game.publicStates[n], publicReach = reaches[n], actor = state.actor;
    const handViews: HandView[] = [];
    if (state.phase === "play" && actor !== null) {
      const other = 1 - actor, opponentCount = game.ranges.players[other].hands.length;
      for (let h = 0; h < game.ranges.players[actor].hands.length; h++) {
        const compatible = pairs.filter(pair => pair.live(n) && pair.hands[actor] === h);
        if (!compatible.length) continue;
        const reach = compatible.reduce((sum, pair) => sum + pair.reach[n], 0), known = reach > CONDITIONAL_MIN_REACH;
        const opponent = known ? Array<number>(opponentCount).fill(0) : null;
        let checkdown = 0;
        if (known) for (const pair of compatible) {
          const weight = pair.reach[n] / reach;
          opponent![pair.hands[other]] += weight;
          const share0 = state.river ? (pair.wins[game.nodeRivers[n]]! + 1) / 2 : pair.checkdown0;
          checkdown += weight * (actor === 0 ? share0 : 1 - share0);
        }
        const probs = probabilities(n, h);
        const actions: ActionView[] = game.actions[n].map((action, a) => {
          const child = edges[n][a], next = game.publicStates[child];
          const immediate = next.phase === "play" && next.actor === other;
          const summary = Array<number>(6).fill(0);
          if (known) for (const pair of compatible) for (let k = 0; k < 6; k++) summary[k] += pair.reach[n] / reach * pair.values[child * 6 + k];
          const ev = known ? summary[0] * (actor === 0 ? 1 : -1) : null;
          const outcomes = known ? actor === 0 ? summary.slice(1) : [summary[2], summary[1], summary[5], summary[4], summary[3]] : null;
          const showdown = summary[3] + summary[4] + summary[5];
          const responses = immediate ? game.actions[child].map((response, r) => {
            const mass = Array<number>(opponentCount).fill(0);
            if (known) for (const pair of compatible) mass[pair.hands[other]] += pair.reach[n] / reach * probabilities(child, pair.hands[other])[r];
            const probability = known ? mass.reduce((sum, v) => sum + v, 0) : null;
            return { action: response, probability, opponent: probability !== null && probability > CONDITIONAL_MIN_REACH ? mass.map(v => v / probability) : null };
          }) : [];
          return { action, frequency: probs[a], ev, evFromNow: ev === null ? null : ev + game.request.committedPerPlayer + state.carried + state.streetPaid[actor],
            behindBest: null, outcomes, showdownShare: known && showdown > CONDITIONAL_MIN_REACH ? (outcomes![2] + outcomes![3] / 2) / showdown : null,
            foldNext: responses.find(response => response.action === "fold")?.probability ?? null, responses };
        });
        if (known) {
          const best = Math.max(...actions.map(a => a.ev!));
          for (const action of actions) action.behindBest = best - action.ev!;
        }
        handViews.push({ hand: h, reach, opponent, checkdownShare: known ? checkdown : null, actions });
      }
    }
    const node: NodeView = { id: n, parent: parents[n], state, reach: publicReach, compatibleDeals: supports[n], hands: handViews,
      mix: state.phase === "play" && publicReach > CONDITIONAL_MIN_REACH ? game.actions[n].map((_, a) => handViews.reduce((sum, hand) => sum + hand.reach / publicReach * hand.actions[a].frequency, 0)) : null,
      terminalValue0: state.phase === "terminal" && publicReach > CONDITIONAL_MIN_REACH ? pairs.reduce((sum, pair) => sum + pair.reach[n] / publicReach * pair.values[n * 6], 0) : null,
      children: edges[n].map((child, a) => ({ node: child, label: state.phase === "river-card" ? game.publicStates[child].river! : game.actions[n][a],
        card: game.publicStates[child].river, compatibleDeals: supports[child], probability: publicReach > CONDITIONAL_MIN_REACH ? reaches[child] / publicReach : null,
        value0: reaches[child] > CONDITIONAL_MIN_REACH ? pairs.reduce((sum, pair) => sum + pair.reach[child] / reaches[child] * pair.values[child * 6], 0) : null })) };
    const key = state.river ?? "turn";
    if (!chunks.has(key)) chunks.set(key, { version: 1, scenario: game.request.id, sourceHash, card: state.river, nodes: [] });
    chunks.get(key)!.nodes.push(node);
  }
  return [...chunks.values()];
}
