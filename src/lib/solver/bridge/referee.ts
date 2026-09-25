/**
 * Referee for bridge results: our own engines check postflop-solver's output.
 *
 * One walk over the exported result tree, in lockstep with one of our engines' public
 * states, does two jobs:
 * 1. Tree identity. Every node's kind, actor, street, board, committed chips, legal
 *    actions (with chip amounts), terminal outcome and chance cards must equal what our
 *    engine produces. Any difference is reported with its path, e.g. `root/bet50/raise150`.
 * 2. Policy adapter. Each exported per-hand average strategy is written into our engine's
 *    information-set keys (in our action order). Every card our engine can deal must be
 *    either an exported child (suit-isomorphic cards included, `representative: false`)
 *    or one postflop-solver lists as impossible, and our engine must agree that such a card
 *    leaves no compatible private pair. Every one of our information sets must be filled
 *    exactly once.
 *
 * The grade itself (best responses, value) is always computed by our engine's own grader
 * from the adapted policy; postflop-solver's self-reported exploitability is only compared.
 */
import type { RiverCard, RiverCombo } from "../river/cards";
import { riverComboKey } from "../river/cards";
import type { BehavioralStrategy, StrategyEntry } from "../toy/game";
import { parseBridgeCombo, canonicalBridgeCombo, type BridgeAction, type BridgePlayer, type BridgeResultNode,
  type BridgeResultV1, type BridgeSpotV1, type BridgeStreet } from "./contract";

export type RefereeView<Action extends string> =
  | {
    readonly kind: "player";
    readonly player: BridgePlayer;
    readonly street: BridgeStreet;
    readonly board: readonly RiverCard[];
    readonly committed: readonly [number, number];
    /** Our engine's actions in our order, with their contract equivalents. */
    readonly actions: readonly { readonly native: Action; readonly contract: BridgeAction }[];
  }
  | {
    readonly kind: "chance";
    readonly street: "turn" | "river";
    readonly board: readonly RiverCard[];
    readonly committed: readonly [number, number];
    /** Every card our engine deals here (including cards no private pair survives). */
    readonly cards: readonly RiverCard[];
  }
  | {
    readonly kind: "terminal";
    readonly outcome: "fold" | "showdown";
    readonly folder: BridgePlayer | null;
    readonly board: readonly RiverCard[];
    readonly committed: readonly [number, number];
  };

export interface RefereeGrade {
  /** Player values of the graded profile, player 0 first (net chips, our utility origin). */
  readonly value: readonly [number, number];
  /** Best-response gains, player 0 first. */
  readonly gains: readonly [number, number];
  /** Half the Nash gap (the convention both engines report). */
  readonly exploitability: number;
  readonly grader: string;
}

/** One of our engines, seen through the public betting tree. */
export interface RefereeEngine<State, Action extends string> {
  readonly name: string;
  /** Our range per player (our order) and relative weights (largest = 1). */
  readonly hands: readonly [readonly RiverCombo[], readonly RiverCombo[]];
  readonly weights: readonly [readonly number[], readonly number[]];
  root(): State;
  view(state: State): RefereeView<Action>;
  act(state: State, action: Action): State;
  deal(state: State, card: RiverCard): State;
  /** Our information-set key for hand `hand` (index into hands[player]) or null when our engine has none (blocked or zero reach). */
  informationSet(state: State, player: BridgePlayer, hand: number): string | null;
  /** True when our engine sees no compatible private pair after dealing `card` here. */
  cardLeavesNoPair(state: State, card: RiverCard): boolean;
  /** Every information-set key our engine's policy format requires. */
  informationSetKeys(): readonly string[];
  grade(policy: BehavioralStrategy<Action>): RefereeGrade;
}

export interface RefereeWalk<Action extends string> {
  readonly mismatches: readonly string[];
  readonly policy: BehavioralStrategy<Action>;
  readonly stats: {
    readonly playerNodes: number;
    readonly chanceNodes: number;
    readonly terminalNodes: number;
    /** Chance children postflop-solver serves through a suit-isomorphic representative. */
    readonly nonRepresentativeChildren: number;
    /** Dealable cards postflop-solver never deals (our engine confirmed: no private pair survives). */
    readonly impossibleCards: number;
    readonly informationSetsFilled: number;
    /** Exported (node, hand) strategies our engine has no information set for (zero reach). */
    readonly zeroReachHands: number;
    /** Largest |sum − 1| of an exported float32 strategy column before renormalizing. */
    readonly maximumStrategySumError: number;
  };
}

const MAX_MISMATCHES = 50;
/** Exported float32 columns must sum to 1 within this before being renormalized in float64. */
export const BRIDGE_STRATEGY_SUM_TOLERANCE = 1e-5;

export function bridgeActionLabel(action: BridgeAction): string {
  return action.type + ("to" in action ? action.to : "");
}
const sameAction = (left: BridgeAction, right: BridgeAction) =>
  left.type === right.type && ("to" in left ? left.to : null) === ("to" in right ? right.to : null);
const listText = (values: readonly unknown[]) => `[${values.join(", ")}]`;

/** Walk a result tree against our engine: tree identity + policy extraction, never trusting either side. */
export function refereeWalk<State, Action extends string>(
  engine: RefereeEngine<State, Action>, result: BridgeResultV1,
): RefereeWalk<Action> {
  const mismatches: string[] = [];
  const report = (path: string, message: string) => {
    if (mismatches.length < MAX_MISMATCHES) mismatches.push(`${path}: ${message}`);
  };
  const stats = { playerNodes: 0, chanceNodes: 0, terminalNodes: 0, nonRepresentativeChildren: 0, impossibleCards: 0,
    informationSetsFilled: 0, zeroReachHands: 0, maximumStrategySumError: 0 };

  // Hands: result order → our index, and the same weights (relative to each player's largest).
  const handMaps = ([0, 1] as const).map(player => {
    const ours = new Map(engine.hands[player].map((hand, index) => [riverComboKey(hand), index]));
    const theirs = result.hands[player];
    const map = theirs.map(combo => {
      const cards = parseBridgeCombo(combo);
      const index = ours.get(canonicalBridgeCombo(cards[0], cards[1]));
      if (index === undefined) report("hands", `player ${player} hand ${combo} is not in our range`);
      return index ?? -1;
    });
    if (theirs.length !== engine.hands[player].length || new Set(map).size !== map.length) {
      report("hands", `player ${player} has ${theirs.length} exported hands; our range has ${engine.hands[player].length}`);
    }
    return map;
  });

  const policy = new Map<string, StrategyEntry<Action>>();
  const nodes = result.tree;
  const board = (cards: readonly RiverCard[]) => cards.join("");

  const visit = (id: number, state: State, path: string): void => {
    const node: BridgeResultNode | undefined = nodes[id];
    if (!node) { report(path, `missing exported node ${id}`); return; }
    let ours: RefereeView<Action>;
    try { ours = engine.view(state); } catch (error) { report(path, `our engine failed: ${String(error)}`); return; }
    if (node.kind !== ours.kind) { report(path, `bridge ${node.kind} node, our ${ours.kind} node`); return; }
    if (board(node.board) !== board(ours.board)) report(path, `board ${board(node.board)} ≠ ours ${board(ours.board)}`);
    if (node.committed[0] !== ours.committed[0] || node.committed[1] !== ours.committed[1]) {
      report(path, `committed ${listText(node.committed)} ≠ ours ${listText(ours.committed)}`);
    }
    if (node.kind === "terminal" && ours.kind === "terminal") {
      stats.terminalNodes += 1;
      if (node.outcome !== ours.outcome || node.folder !== ours.folder) {
        report(path, `terminal ${node.outcome}/${node.folder} ≠ ours ${ours.outcome}/${ours.folder}`);
      }
      return;
    }
    if (node.kind === "chance" && ours.kind === "chance") {
      stats.chanceNodes += 1;
      if (node.street !== ours.street) report(path, `deals the ${node.street}; ours deals the ${ours.street}`);
      if (node.truncated) { report(path, "chance node is truncated (referee needs exportScope full)"); return; }
      const dealt = new Map(node.children.map(child => [child.card, child]));
      const impossible = new Set(node.impossibleCards);
      const ourCards = new Set(ours.cards);
      for (const card of [...dealt.keys(), ...impossible]) {
        if (!ourCards.has(card)) report(path, `bridge deals ${card}, which our engine cannot deal`);
      }
      if (dealt.size !== node.children.length) report(path, "bridge repeats a chance card");
      for (const card of ours.cards) {
        const child = dealt.get(card);
        if (child) {
          if (impossible.has(card)) report(path, `${card} is both dealt and impossible`);
          if (!child.representative) stats.nonRepresentativeChildren += 1;
          visit(child.child, engine.deal(state, card), `${path}/${card}`);
        } else if (impossible.has(card)) {
          stats.impossibleCards += 1;
          if (!engine.cardLeavesNoPair(state, card)) report(path, `bridge never deals ${card}, but our engine has a live private pair after it`);
        } else report(path, `our card ${card} is neither dealt nor listed impossible by the bridge`);
      }
      return;
    }
    if (node.kind !== "player" || ours.kind !== "player") return;
    stats.playerNodes += 1;
    if (node.player !== ours.player) { report(path, `actor ${node.player} ≠ ours ${ours.player}`); return; }
    if (node.street !== ours.street) report(path, `street ${node.street} ≠ ours ${ours.street}`);
    const theirLabels = node.actions.map(a => bridgeActionLabel(a.action)), ourLabels = ours.actions.map(a => bridgeActionLabel(a.contract));
    if (theirLabels.join() !== ourLabels.join()) {
      report(path, `actions ${listText(theirLabels)} ≠ ours ${listText(ourLabels)}`);
      return;
    }
    // Our action order → bridge action index (identical order today; mapped, not assumed).
    const toBridge = ours.actions.map(a => node.actions.findIndex(edge => sameAction(edge.action, a.contract)));
    const player = node.player, handMap = handMaps[player];
    for (let bridgeHand = 0; bridgeHand < handMap.length; bridgeHand += 1) {
      const hand = handMap[bridgeHand];
      if (hand < 0) continue;
      const column = node.strategy.map(row => row[bridgeHand]);
      const key = engine.informationSet(state, player, hand);
      const blocked = column.every(p => p === null);
      if (key === null) { if (!blocked) stats.zeroReachHands += 1; continue; }
      if (blocked || column.some(p => p === null)) {
        report(path, `bridge has no strategy for ${result.hands[player][bridgeHand]}, which our engine plays (${key})`);
        continue;
      }
      const probabilities = toBridge.map(index => column[index] as number);
      const sum = probabilities.reduce((total, p) => total + p, 0);
      stats.maximumStrategySumError = Math.max(stats.maximumStrategySumError, Math.abs(sum - 1));
      if (!(Math.abs(sum - 1) <= BRIDGE_STRATEGY_SUM_TOLERANCE) || probabilities.some(p => !(p >= 0))) {
        report(path, `strategy for ${result.hands[player][bridgeHand]} sums to ${sum}`);
        continue;
      }
      if (policy.has(key)) { report(path, `information set ${key} is reached twice`); continue; }
      policy.set(key, { actions: ours.actions.map(a => a.native), probabilities: probabilities.map(p => p / sum) });
      stats.informationSetsFilled += 1;
    }
    ours.actions.forEach((action, index) => {
      const edge = node.actions[toBridge[index]];
      visit(edge.child, engine.act(state, action.native), `${path}/${bridgeActionLabel(action.contract)}`);
    });
  };
  visit(0, engine.root(), "root");

  const expected = engine.informationSetKeys();
  const missing = expected.filter(key => !policy.has(key));
  if (missing.length) report("policy", `${missing.length} of our information sets have no bridge strategy, e.g. ${missing[0]}`);
  if (policy.size !== expected.length && !missing.length) report("policy", `filled ${policy.size} information sets; our engine has ${expected.length}`);
  if (stats.playerNodes + stats.chanceNodes + stats.terminalNodes !== nodes.length) {
    report("tree", `walked ${stats.playerNodes + stats.chanceNodes + stats.terminalNodes} of ${nodes.length} exported nodes`);
  }
  return { mismatches, policy, stats };
}

/** The spot must hand postflop-solver exactly our ranges: same combos, same relative weights. */
export function refereeRangeMismatches(engine: Pick<RefereeEngine<unknown, string>, "hands" | "weights">,
  spot: BridgeSpotV1): readonly string[] {
  const mismatches: string[] = [];
  for (const player of [0, 1] as const) {
    const ours = new Map(engine.hands[player].map((hand, h) => [riverComboKey(hand), engine.weights[player][h]]));
    const theirs = spot.ranges[player].combos;
    if (theirs.length !== ours.size) mismatches.push(`ranges[${player}]: spot has ${theirs.length} combos, our engine ${ours.size}`);
    for (const { combo, weight } of theirs) {
      const expected = ours.get(combo);
      if (expected === undefined) mismatches.push(`ranges[${player}]: ${combo} is not in our range`);
      else if (Math.abs(expected - weight) > 1e-15) mismatches.push(`ranges[${player}]: ${combo} weight ${weight} ≠ ours ${expected}`);
    }
  }
  return mismatches;
}

/** postflop-solver's own value for player `player`: its root EVs averaged with its root weights. */
export function bridgeSelfReportedValue(result: BridgeResultV1, player: BridgePlayer): number {
  const ev = result.root.ev[player], weights = result.root.weights[player];
  let total = 0, mass = 0;
  for (let h = 0; h < ev.length; h += 1) { total += ev[h] * weights[h]; mass += weights[h]; }
  if (!(mass > 0)) throw new Error("Bridge result has no root weight");
  return total / mass;
}

/**
 * Locked agreement tolerance between postflop-solver's float32 self-report and our float64
 * grade of its exported strategy, in chips. Measured (npm run audit:bridge -- --measure,
 * 2026-09-25): over 40 uncompressed solves (4 games × 10/30/100/300/1000 iterations × 1 and
 * 10 threads) the largest |Δ| of exploitability, player-0 value or the self-report's zero-sum
 * error was 1.21e-5 chips; 10× that, rounded up to the next 1-2-5 step, is 2e-4 chips
 * (2e-4 % of the 100-chip referee pots, 50× below their 0.01-chip solve target). Valid for
 * float32 solves at the referee games' scale (pots ~100, stacks ≤ 200); int16 compression
 * measured up to 8.7e-4 chips of value error and is not covered. Derivation:
 * tasks/postflop-solver-bridge-spec.md ("B2 referee results").
 */
export const BRIDGE_FLOAT32_TOLERANCE_CHIPS = 2e-4;

export interface RefereeArtifactBounds {
  /** Our saved artifact's player-0 value and best-response gains. */
  readonly value0: number;
  readonly gains: readonly [number, number];
  /** Our saved artifact's quality gate (maximum exploitability, chips). */
  readonly maximumExploitability: number;
  readonly source: string;
}

export interface RefereeGates {
  readonly selfReported: { readonly exploitability: number; readonly value0: number; readonly value1: number };
  readonly ours: RefereeGrade;
  readonly deltas: { readonly exploitability: number; readonly value0: number; readonly zeroSum: number };
  /** Our artifact's certified interval for the equilibrium value, [v0 − gain1, v0 + gain0]. */
  readonly artifactInterval: readonly [number, number] | null;
  /** Certified interval from our grade of the bridge strategy, [v − gain1, v + gain0]. */
  readonly bridgeInterval: readonly [number, number];
  readonly failures: readonly string[];
}

/** Gates (a) exploitability agreement, (b) value agreement and interval containment, (c) quality. */
export function refereeGates(result: BridgeResultV1, ours: RefereeGrade, tolerance: number,
  bounds: RefereeArtifactBounds | null): RefereeGates {
  if (!(tolerance > 0)) throw new Error("Referee tolerance must be positive");
  const failures: string[] = [];
  const selfReported = { exploitability: result.exploitability.chips, value0: bridgeSelfReportedValue(result, 0),
    value1: bridgeSelfReportedValue(result, 1) };
  const deltas = { exploitability: Math.abs(selfReported.exploitability - ours.exploitability),
    value0: Math.abs(selfReported.value0 - ours.value[0]), zeroSum: Math.abs(selfReported.value0 + selfReported.value1) };
  if (!(deltas.exploitability <= tolerance)) {
    failures.push(`(a) self-reported exploitability ${selfReported.exploitability} vs our grade ${ours.exploitability}: |Δ| ${deltas.exploitability} > ${tolerance}`);
  }
  if (!(deltas.value0 <= tolerance)) {
    failures.push(`(b) self-reported value ${selfReported.value0} vs our grade ${ours.value[0]}: |Δ| ${deltas.value0} > ${tolerance}`);
  }
  if (!(deltas.zeroSum <= tolerance)) failures.push(`(b) self-reported values are not zero-sum: ${selfReported.value0} + ${selfReported.value1}`);
  const bridgeInterval = [ours.value[0] - ours.gains[1], ours.value[0] + ours.gains[0]] as const;
  let artifactInterval: readonly [number, number] | null = null;
  if (bounds) {
    artifactInterval = [bounds.value0 - bounds.gains[1], bounds.value0 + bounds.gains[0]];
    for (const [label, value] of [["our grade of the bridge value", ours.value[0]], ["the self-reported value", selfReported.value0]] as const) {
      // The float32 self-report gets the tolerance as slack; our float64 grade gets none.
      const slack = label === "the self-reported value" ? tolerance : 0;
      if (!(value >= artifactInterval[0] - slack && value <= artifactInterval[1] + slack)) {
        failures.push(`(b) ${label} ${value} is outside ${bounds.source}'s certified interval [${artifactInterval.join(", ")}]`);
      }
    }
    if (!(bridgeInterval[0] <= artifactInterval[1] && artifactInterval[0] <= bridgeInterval[1])) {
      failures.push(`(b) certified intervals are disjoint: bridge [${bridgeInterval.join(", ")}], ours [${artifactInterval.join(", ")}]`);
    }
    if (!(ours.exploitability <= bounds.maximumExploitability)) {
      failures.push(`(c) our grade ${ours.exploitability} fails the ${bounds.maximumExploitability}-chip quality gate`);
    }
  }
  return { selfReported, ours, deltas, artifactInterval, bridgeInterval, failures };
}
