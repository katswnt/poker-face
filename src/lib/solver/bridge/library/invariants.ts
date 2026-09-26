/**
 * Full invariant audit of one library spot's chunks (used by `npm run audit:bridge:library`).
 * Checks that only need the saved data, so CI can run them without the native engine:
 *
 * 1. Reach chain: every stored reach equals initial range weight × the saved probabilities of
 *    the player's own actions along the path (0 for board-blocked hands), whenever every
 *    decision on the path is itself saved. Across chance nodes reach is unchanged.
 * 2. Actor EV: a hand's EV equals Σ_a probability × action EV; fold is exactly 0.
 * 3. Opponent EV: at a node whose actions all lead to saved decision nodes, the non-actor's
 *    EV equals the average of its child EVs weighted by the actor's blocker-compatible
 *    action frequencies.
 * 4. Bounds: from-now EV lies in [−(own chips behind), pot + opponent's chips behind]; equity in [0, 1].
 *
 * Tolerances cover quantization (reach 1e-4, probability 1e-3, EV 0.1 chip) plus float32
 * noise; they were set from the measured maxima on the generated library (reported by the audit).
 */
import { EQUITY_SCALE, EV_SCALE, REACH_SCALE, STRATEGY_SCALE, type BridgeLibraryChunk, type BridgeLibraryNode, type BridgeLibraryRanges } from "./model";

export const LIBRARY_TOLERANCES = Object.freeze({
  /** Reach: a floor relative to the node's max reach, plus an absolute bound per saved probability on the path. */
  reachFloor: 1.5e-4, reachPerStep: 1e-3,
  /** Chips: actor EV vs Σ p·EV(a) (EV rounding 0.05 + probability rounding 0.0005 × |EV|). */
  actorEvChips: 0.1, actorEvRelative: 0.0015,
  /** Chips: opponent EV vs the frequency-weighted child EVs. */
  opponentEvChips: 0.5, opponentEvRelative: 0.01,
});

export interface LibraryInvariantReport {
  readonly nodes: number;
  readonly reachChecked: number;
  readonly reachSkipped: number;
  readonly opponentEvChecked: number;
  readonly maxReachError: number;
  readonly maxActorEvError: number;
  readonly maxOpponentEvError: number;
  readonly failures: readonly string[];
}

const CARD = /^[2-9TJQKA][cdhs]$/;

export function auditLibrarySpot(chunks: readonly BridgeLibraryChunk[], ranges: BridgeLibraryRanges,
  setup: { readonly startingPot: number; readonly effectiveStack: number }): LibraryInvariantReport {
  const failures: string[] = [];
  const nodes = new Map<string, BridgeLibraryNode>();
  for (const chunk of chunks) for (const node of chunk.nodes) nodes.set(node.path, node);
  const handCards = ranges.hands.map(list => list.map(combo => [combo.slice(0, 2), combo.slice(2, 4)]));
  const lookup = new Map<BridgeLibraryNode, Map<number, number>[]>();
  const index = (node: BridgeLibraryNode, p: number) => {
    let maps = lookup.get(node);
    if (!maps) { maps = [0, 1].map(q => new Map(node.live[q].map((h, i) => [h, i]))); lookup.set(node, maps); }
    return maps[p];
  };
  let reachChecked = 0, reachSkipped = 0, opponentEvChecked = 0, maxReachError = 0, maxActorEvError = 0, maxOpponentEvError = 0;
  const fail = (node: BridgeLibraryNode, message: string) => { if (failures.length < 50) failures.push(`${node.path || "(root)"}: ${message}`); };

  for (const node of nodes.values()) {
    const tokens = node.path === "" ? [] : node.path.split(" ");
    const pot = setup.startingPot + node.committed[0] + node.committed[1];
    // 4. Bounds.
    for (const p of [0, 1] as const) {
      // From now a player can lose at most what it still has behind and win at most the pot
      // plus whatever the opponent still has behind.
      const own = setup.effectiveStack - node.committed[p], other = setup.effectiveStack - node.committed[1 - p];
      node.ev[p].forEach(ev => { if (ev !== null && (ev / EV_SCALE < -own - 1 || ev / EV_SCALE > pot + other + 1)) fail(node, `ev[${p}] ${ev / EV_SCALE} outside bounds`); });
      node.equity[p].forEach(eq => { if (eq !== null && (eq < 0 || eq > EQUITY_SCALE)) fail(node, `equity out of range`); });
    }
    // 2. Actor EV.
    const actor = node.player, fold = node.actions.indexOf("f");
    node.live[actor].forEach((_, i) => {
      const ev = node.ev[actor][i];
      if (fold >= 0 && node.actionEv[fold][i] !== null && node.actionEv[fold][i] !== 0) fail(node, `fold EV ${node.actionEv[fold][i]} ≠ 0`);
      if (ev === null) return;
      let sum = 0, scale = 0;
      for (let a = 0; a < node.actions.length; a += 1) {
        const p = node.strategy[a][i] / STRATEGY_SCALE, v = node.actionEv[a][i];
        if (v === null) { if (p > 0) fail(node, `action ${node.actions[a]} has probability but no EV`); continue; }
        sum += p * v / EV_SCALE; scale = Math.max(scale, Math.abs(v / EV_SCALE));
      }
      const error = Math.abs(sum - ev / EV_SCALE);
      maxActorEvError = Math.max(maxActorEvError, error);
      if (error > LIBRARY_TOLERANCES.actorEvChips + LIBRARY_TOLERANCES.actorEvRelative * scale) fail(node, `actor EV ${ev / EV_SCALE} ≠ Σ p·EV ${sum}`);
    });
    // 1. Reach chain.
    for (const p of [0, 1] as const) {
      const predicted = ranges.weights[p].map(w => w);
      let steps = 0, complete = true;
      for (let t = 0; t < tokens.length; t += 1) {
        if (CARD.test(tokens[t])) {
          handCards[p].forEach((cards, h) => { if (cards.includes(tokens[t])) predicted[h] = 0; });
          continue;
        }
        const parent = nodes.get(tokens.slice(0, t).join(" "));
        if (!parent) { complete = false; break; }
        if (parent.player !== p) continue;
        const a = parent.actions.indexOf(tokens[t]);
        if (a < 0) { fail(node, `path token ${tokens[t]} is not an action of ${parent.path}`); complete = false; break; }
        const map = index(parent, p);
        predicted.forEach((r, h) => { const i = map.get(h); predicted[h] = i === undefined ? 0 : r * parent.strategy[a][i] / STRATEGY_SCALE; });
        steps += 1;
      }
      if (!complete) { reachSkipped += 1; continue; }
      reachChecked += 1;
      // Stored reach is rounded to 1e-4 of the node's max; each saved probability to 1e-3.
      const tolerance = LIBRARY_TOLERANCES.reachFloor * node.reachMax[p] + LIBRARY_TOLERANCES.reachPerStep * steps;
      const map = index(node, p);
      handCards[p].forEach((cards, h) => {
        if (node.board.some(c => cards.includes(c))) predicted[h] = 0;
        const i = map.get(h), stored = i === undefined ? 0 : node.reach[p][i] / REACH_SCALE * node.reachMax[p];
        const error = Math.abs(stored - predicted[h]);
        maxReachError = Math.max(maxReachError, error);
        if (error > tolerance) fail(node, `reach[${p}] of ${ranges.hands[p][h]} ${stored} ≠ predicted ${predicted[h]}`);
      });
    }
    // 3. Opponent EV at nodes whose children are all saved decision nodes.
    const children = node.actions.map(a => nodes.get([...tokens, a].join(" ")));
    if (children.every(c => c !== undefined)) {
      opponentEvChecked += 1;
      const o = (1 - actor) as 0 | 1;
      const actorHands = node.live[actor];
      node.live[o].forEach((h, i) => {
        const ev = node.ev[o][i];
        if (ev === null) return;
        const own = handCards[o][h];
        const weights = node.actions.map(() => 0);
        let total = 0;
        actorHands.forEach((g, j) => {
          if (handCards[actor][g].some(c => own.includes(c))) return;
          const r = node.reach[actor][j];
          total += r;
          node.actions.forEach((_, a) => { weights[a] += r * node.strategy[a][j]; });
        });
        if (!(total > 0)) return;
        let sum = 0, scale = 0, covered = true;
        children.forEach((child, a) => {
          const w = weights[a] / (total * STRATEGY_SCALE);
          if (w === 0) return;
          const k = index(child!, o).get(h), v = k === undefined ? null : child!.ev[o][k];
          if (v === null) { covered = false; return; }
          sum += w * v / EV_SCALE; scale = Math.max(scale, Math.abs(v / EV_SCALE));
        });
        if (!covered) return;
        const error = Math.abs(sum - ev / EV_SCALE);
        maxOpponentEvError = Math.max(maxOpponentEvError, error);
        if (error > LIBRARY_TOLERANCES.opponentEvChips + LIBRARY_TOLERANCES.opponentEvRelative * scale) fail(node, `opponent EV of ${ranges.hands[o][h]} ${ev / EV_SCALE} ≠ ${sum}`);
      });
    }
  }
  return { nodes: nodes.size, reachChecked, reachSkipped, opponentEvChecked, maxReachError, maxActorEvError, maxOpponentEvError, failures };
}
