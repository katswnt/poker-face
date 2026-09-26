/**
 * Probability that play reaches a subgame at the end of `path` (a flop spot): the reach mass
 * of compatible private pairs there, over the same mass at the flop root, times the chance
 * weight 1/45 · 1/44 of the dealt turn and river (postflop-solver's convention: each card is
 * one of the 45 / 44 cards unseen given both hands). A best response that deviates only in
 * this subgame gains probability × local gain, so probability × local exploitability can
 * never exceed the whole-game exploitability; the B3 report checks that bound.
 */
export function subgameProbability(reachMass: number, rootMass: number, cardsDealt: number): number {
  return reachMass / rootMass * (cardsDealt >= 1 ? 1 / 45 : 1) * (cardsDealt >= 2 ? 1 / 44 : 1);
}

/** Σ over compatible pairs of w0 × w1 (the flop-root reach mass). */
export function compatibleMass(hands: readonly [readonly string[], readonly string[]], weights: readonly [readonly number[], readonly number[]],
  board: readonly RiverCard[]): number {
  const combos = [hands[0].map(parseRiverCombo), hands[1].map(parseRiverCombo)];
  let mass = 0;
  combos[0].forEach((a, i) => {
    if (a.some(c => board.includes(c))) return;
    combos[1].forEach((b, j) => { if (!riverCombosOverlap(a, b) && !b.some(c => board.includes(c))) mass += weights[0][i] * weights[1][j]; });
  });
  return mass;
}

/**
 * B3 referee spot-check: grade one exported river subgame of a big postflop-solver solve with
 * OUR factorized river scorekeeper (the audited river v3 acceptance grader).
 *
 * The subgame is the exported subtree below one river decision node. Its private deals are
 * every blocker-compatible (OOP hand, IP hand) pair with probability ∝ reach0 × reach1 at the
 * subtree root (the reach postflop-solver's own strategy gives each hand along the line), so
 * the grade is a *local* exploitability: how much each player could gain by deviating inside
 * this river subgame against the other's saved river strategy, holding the arriving ranges
 * fixed. It is not the whole-game exploitability and cannot certify earlier streets.
 *
 * The public tree comes from the export itself (actions, chip totals, terminals), not from a
 * re-derivation of the Fold rules, so there is no second rules implementation to disagree
 * with; payoffs are recomputed from the exported chip totals and our own hand evaluator.
 */
import { canonicalRiverCombo, parseRiverCombo, riverComboKey, riverCombosOverlap, riverHandScore, type RiverCard, type RiverCombo } from "../river/cards";
import type { ConfigurableRiverAction } from "../river/configurable/game";
import type { ConfigurableRiverRangeEntry } from "../river/configurable/range";
import { compileFactorizedRiverGame, type FactorizedRiverSource, type FactorizedRiverSourceState } from "../river/factorized/game";
import { compileFactorizedRiverScorekeeper, gradeFactorizedRiverStrategy } from "../river/factorized/scorekeeper";
import type { BehavioralStrategy, GameNode, SolverPlayer, StrategyEntry, Weighted } from "../toy/game";
import type { BridgeAction, BridgeResultNode, BridgeSubtree } from "./contract";

export interface RiverSubgameInput {
  /** Spot hand lists (result.hands). */
  readonly hands: readonly [readonly string[], readonly string[]];
  readonly startingPot: number;
  readonly subtree: BridgeSubtree;
  /** Hands with reach at or below this are left out of the subgame (default 0: keep every live hand). */
  readonly minimumReach?: number;
}

export interface RiverSubgameGrade {
  readonly path: readonly string[];
  readonly board: readonly RiverCard[];
  readonly handsInPlay: readonly [number, number];
  readonly deals: number;
  readonly publicNodes: number;
  /** Pot at the subtree root (startingPot + both players' committed chips). */
  readonly pot: number;
  /** Our grade of postflop-solver's river strategy: values are net chips from the start of the hand. */
  readonly ours: { readonly value: readonly [number, number]; readonly gains: readonly [number, number]; readonly exploitability: number };
  /** postflop-solver's own subgame value (its per-hand from-now EVs at the root, converted to our origin). */
  readonly theirs: { readonly value: readonly [number, number] };
  readonly localExploitabilityPctPot: number;
  /** Σ over compatible (OOP, IP) pairs of reach0 × reach1 at the subtree root (unnormalized). */
  readonly reachMass: number;
  readonly maxColumnSumError: number;
  readonly elapsedMs: number;
}

interface SubState extends FactorizedRiverSourceState {
  readonly node: number;
  readonly hands: readonly [RiverCombo, RiverCombo] | null;
  readonly public: { readonly terminal: "fold" | "showdown" | null; readonly history: readonly ConfigurableRiverAction[] };
}

export function actionLabel(action: BridgeAction): ConfigurableRiverAction {
  return action.type === "bet" || action.type === "raise" ? `${action.type}-to-${action.to}` : action.type;
}

export function gradeRiverSubgame(input: RiverSubgameInput): RiverSubgameGrade {
  const started = performance.now();
  const { subtree, startingPot } = input, nodes = subtree.nodes;
  const root = nodes[0];
  if (!root || root.kind !== "player" || root.street !== "river") throw new Error("A river subgame must start at a river decision node");
  const board = root.board;
  if (board.length !== 5) throw new Error("River subgame needs a five-card board");
  for (const node of nodes) {
    if (node.kind === "chance") throw new Error("A river subgame cannot contain chance nodes");
    if (node.board.join() !== board.join()) throw new Error("River subgame nodes disagree on the board");
  }
  const minimumReach = input.minimumReach ?? 0;
  const combos = [input.hands[0].map(parseRiverCombo), input.hands[1].map(parseRiverCombo)] as const;
  // Hands in play: live on this board with positive reach.
  const live = ([0, 1] as const).map(p => combos[p].map((c, h) => subtree.reach[p][h] > minimumReach && !c.some(x => board.includes(x))));
  const index = ([0, 1] as const).map(p => combos[p].map((_, h) => h).filter(h => live[p][h]));
  const ranges = ([0, 1] as const).map(p => index[p].map(h => ({ cards: canonicalRiverCombo(combos[p][h]), weight: subtree.reach[p][h] })));

  const deals: Weighted<{ readonly hands: readonly [RiverCombo, RiverCombo] }>[] = [];
  let total = 0;
  for (const a of ranges[0]) for (const b of ranges[1]) {
    if (riverCombosOverlap(a.cards, b.cards)) continue;
    const w = a.weight * b.weight;
    if (w > 0) { deals.push({ outcome: { hands: [a.cards, b.cards] }, probability: w }); total += w; }
  }
  if (!deals.length) throw new Error("River subgame has no compatible private deals");
  for (let i = 0; i < deals.length; i += 1) deals[i] = { outcome: deals[i].outcome, probability: deals[i].probability / total };
  // Kahan-free renormalization can leave |Σ − 1| ~ 1e-13 on 10^5 deals; fold the residue into the largest deal.
  const residue = 1 - deals.reduce((s, d) => s + d.probability, 0);
  if (Math.abs(residue) > 1e-12) {
    const largest = deals.reduce((best, d, i) => d.probability > deals[best].probability ? i : best, 0);
    deals[largest] = { outcome: deals[largest].outcome, probability: deals[largest].probability + residue };
  }

  const scores = new Map<string, number>();
  const score = (c: RiverCombo) => { const k = riverComboKey(c); let v = scores.get(k); if (v === undefined) { v = riverHandScore(c, board); scores.set(k, v); } return v; };
  const contributions = (node: BridgeResultNode): readonly [number, number] => [startingPot / 2 + node.committed[0], startingPot / 2 + node.committed[1]];
  const terminals = nodes.filter(n => n.kind === "terminal").length;
  const labels = nodes.map(n => n.kind === "player" ? n.actions.map(a => actionLabel(a.action)) : []);
  const state = (node: number, hands: SubState["hands"], history: readonly ConfigurableRiverAction[]): SubState => {
    const n = nodes[node];
    return { node, hands, public: { terminal: n.kind === "terminal" ? n.outcome : null, history } };
  };
  const source: FactorizedRiverSource<SubState> = {
    id: `bridge-river-subgame:${subtree.path.join(".")}`,
    scenario: { ranges: [ranges[0] as ConfigurableRiverRangeEntry[], ranges[1] as ConfigurableRiverRangeEntry[]] },
    deals,
    preflight: { publicStatesPerDeal: nodes.length, publicTerminalStatesPerDeal: terminals, projectedFullStates: 1 + nodes.length * deals.length },
    initialState: () => state(0, null, []),
    node(s): GameNode<ConfigurableRiverAction, { readonly hands: readonly [RiverCombo, RiverCombo] }> {
      if (!s.hands) return { kind: "chance", outcomes: deals };
      const n = nodes[s.node];
      if (n.kind === "player") return { kind: "player", player: n.player, actions: labels[s.node] };
      if (n.kind !== "terminal") throw new Error("unreachable");
      const tc = contributions(n);
      let u0: number;
      if (n.outcome === "fold") u0 = n.folder === 0 ? -tc[0] : tc[1];
      else {
        // Uncalled chips are returned; the contested part goes to the winner.
        const matched = Math.min(tc[0], tc[1]), winner = this.showdownWinner(s.hands);
        u0 = winner === null ? 0 : winner === 0 ? matched : -matched;
      }
      return { kind: "terminal", utility: [u0, -u0] };
    },
    nextChance: (s, outcome) => state(0, outcome.hands, []),
    nextAction(s, action) {
      const n = nodes[s.node];
      if (n.kind !== "player") throw new Error("Action at a non-decision node");
      const edge = labels[s.node].indexOf(action);
      if (edge < 0) throw new Error(`Unknown subgame action ${action}`);
      return state(n.actions[edge].child, s.hands, [...s.public.history, action]);
    },
    informationSet(s, player) {
      return `p${player}:${riverComboKey(s.hands![player])}:${s.node}`;
    },
    totalContributions: s => contributions(nodes[s.node]),
    showdownWinner(hands) {
      const a = score(hands[0]), b = score(hands[1]);
      return a === b ? null : a > b ? 0 : 1;
    },
  };
  const compiled = compileFactorizedRiverGame(source);
  const keeper = compileFactorizedRiverScorekeeper(compiled);

  // Policy adapter: every (decision node, live hand of its actor) gets postflop-solver's
  // float32 column renormalized in float64.
  const policy = new Map<string, StrategyEntry<ConfigurableRiverAction>>();
  let maxColumnSumError = 0;
  nodes.forEach((n, id) => {
    if (n.kind !== "player") return;
    for (const h of index[n.player]) {
      const column = n.strategy.map(row => row[h]);
      if (column.some(p => p === null || !(p >= 0))) throw new Error(`Subgame node ${id} hand ${input.hands[n.player][h]} has no strategy`);
      const sum = (column as number[]).reduce((s, p) => s + p, 0);
      maxColumnSumError = Math.max(maxColumnSumError, Math.abs(sum - 1));
      if (Math.abs(sum - 1) > 1e-5) throw new Error(`Subgame node ${id} hand ${input.hands[n.player][h]} sums to ${sum}`);
      policy.set(`p${n.player}:${riverComboKey(combos[n.player][h])}:${id}`, { actions: labels[id], probabilities: (column as number[]).map(p => p / sum) });
    }
  });
  const strategy: BehavioralStrategy<ConfigurableRiverAction> = policy;
  const grade = gradeFactorizedRiverStrategy(keeper, strategy);

  // postflop-solver's value: Σ_h w(h)·c(h)·(ev(h) − own contribution) / Σ_h w(h)·c(h), where
  // c(h) = compatible opponent reach (its normalized weights) and ev is from-now.
  const rootContribution = contributions(root);
  const theirs = ([0, 1] as const).map(p => {
    const o = (1 - p) as SolverPlayer;
    let numerator = 0, denominator = 0;
    for (const h of index[p]) {
      const own = combos[p][h];
      let compatible = 0;
      for (const g of index[o]) if (!riverCombosOverlap(own, combos[o][g])) compatible += subtree.reach[o][g];
      const w = subtree.reach[p][h] * compatible, ev = subtree.ev[p][h];
      if (w <= 0) continue;
      if (ev === null) throw new Error(`postflop-solver reported no EV for live hand ${input.hands[p][h]}`);
      numerator += w * (ev - rootContribution[p]); denominator += w;
    }
    return numerator / denominator;
  });
  const pot = rootContribution[0] + rootContribution[1];
  return {
    path: subtree.path, board, handsInPlay: [index[0].length, index[1].length], deals: deals.length, publicNodes: nodes.length, pot,
    ours: { value: [grade.value[0], grade.value[1]], gains: [grade.gains[0], grade.gains[1]], exploitability: grade.exploitability },
    theirs: { value: [theirs[0], theirs[1]] },
    localExploitabilityPctPot: 100 * grade.exploitability / pot, reachMass: total, maxColumnSumError, elapsedMs: performance.now() - started,
  };
}
