/** Referee-scale Resolve / Max-margin adapters. No Rust or browser-play integration. */
import { buildGameTreeIndex, validateStrategy, type BehavioralStrategy, type ExtensiveFormGame,
  type GameTreeIndex, type SolverPlayer } from "../toy/game";
import { gradeStrategy, informationSetBestResponse } from "../toy/best-response";
import { solveCompactCfr } from "./compact/cfr";

export type ResolveMode = "unsafe" | "resolve" | "max-margin";
export interface SubgameInput<S, A extends string, C> {
  game: ExtensiveFormGame<S, A, C>; blueprint: BehavioralStrategy<A>; ai: SolverPlayer;
  /** Must select a public forest, closed under both players' information sets. */
  cut(state: S): boolean;
  /** Opponent's augmented root information set (private hand + public history). */
  opponentKey(state: S): string;
  /** Explicit modeled joint root weight, only for the unsafe comparator; never gadget weights. */
  modeledWeight?(state: S, counterfactualWeight: number): number;
}
export interface SubgameRoot<S> { state: S; key: string; counterfactualWeight: number; modeledWeight: number }
export interface Subgame<S, A extends string, C> {
  game: ExtensiveFormGame<S, A, C>; blueprint: BehavioralStrategy<A>; ai: SolverPlayer;
  index: GameTreeIndex<A>; roots: readonly SubgameRoot<S>[];
  bounds: readonly { key: string; mass: number; value: number }[];
}
const PREFIX = "@poker-face-resolve/";
type Wrapped<S> = { kind: "start" } | { kind: "choose-root"; group: string }
  | { kind: "opt"; root: number } | { kind: "exit"; root: number }
  | { kind: "base"; state: S; group: string };
type Draw<C> = { kind: "root"; index: number } | { kind: "base"; outcome: C };
function reachProduct(a: number, b: number): number {
  const product = a * b;
  if (a > 0 && b > 0 && product === 0) throw new Error("Positive reach would underflow");
  return product;
}

/** A forest preserves original information sets; conditioning never reveals the AI's hidden opponent hand. */
function forestGame<S, A extends string, C>(game: ExtensiveFormGame<S, A, C>, roots: readonly SubgameRoot<S>[],
  weights: readonly number[]): ExtensiveFormGame<Wrapped<S>, string, Draw<C>> {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Forest needs positive finite root mass");
  const outcomes = weights.flatMap((w, index) => w > 0 ? [{ outcome: { kind: "root" as const, index }, probability: w / total }] : []);
  return {
    id: `${game.id}:forest`, initialState: () => ({ kind: "start" }),
    node(s) {
      if (s.kind === "start") return { kind: "chance", outcomes };
      if (s.kind !== "base") throw new Error("Invalid forest state");
      const n = game.node(s.state);
      return n.kind === "chance" ? { kind: "chance", outcomes: n.outcomes.map(o => ({
        outcome: { kind: "base" as const, outcome: o.outcome }, probability: o.probability })) } : n;
    },
    nextChance(s, d) {
      if (s.kind === "start" && d.kind === "root" && outcomes.some(o => o.outcome.index === d.index)) {
        return { kind: "base", state: roots[d.index].state, group: roots[d.index].key };
      }
      if (s.kind === "base" && d.kind === "base") return { ...s, state: game.nextChance(s.state, d.outcome) };
      throw new Error("Invalid forest chance transition");
    },
    nextAction(s, a) {
      if (s.kind !== "base") throw new Error("Invalid forest action");
      return { ...s, state: game.nextAction(s.state, a as A) };
    },
    informationSet(s, p) {
      if (s.kind !== "base") throw new Error("Invalid forest information set");
      return game.informationSet(s.state, p);
    },
  };
}
function restrictProfile<A extends string>(index: GameTreeIndex<string>, strategy: BehavioralStrategy<A>): BehavioralStrategy<string> {
  return new Map(index.informationSets.map(i => {
    const entry = strategy.get(i.key);
    if (!entry) throw new Error(`Missing continuation strategy: ${i.key}`);
    return [i.key, entry];
  }));
}

/** Compute root counterfactual reach from a complete, validated blueprint, not guessed hand priors. */
export function prepareSubgame<S, A extends string, C>(input: SubgameInput<S, A, C>): Subgame<S, A, C> {
  const { game, blueprint, ai } = input;
  if (ai !== 0 && ai !== 1) throw new Error("Invalid resolving player");
  const index = buildGameTreeIndex(game, { maxStates: 100_000 });
  validateStrategy(index, blueprint);
  for (const entry of blueprint.values()) if (entry.probabilities.some(p => p < 0 || p > 1)) {
    throw new Error("Reach probabilities must be strictly within [0, 1]");
  }
  if (index.informationSets.some(i => i.key.startsWith(PREFIX) || i.actions.some(a => a.startsWith(PREFIX)))) {
    throw new Error("Game uses reserved gadget identifiers");
  }
  const roots: SubgameRoot<S>[] = [], sides = new Map<string, Set<boolean>>();
  const visit = (s: S, chance: number, reach: readonly [number, number], inside: boolean): void => {
    const n = game.node(s);
    if (!inside && input.cut(s)) {
      if (n.kind === "terminal") throw new Error("Subgame cut cannot be terminal");
      inside = true;
      const key = input.opponentKey(s), counterfactualWeight = reachProduct(chance, reach[ai]);
      if (!key) throw new Error("Subgame root needs an opponent key");
      const modeledWeight = input.modeledWeight?.(s, counterfactualWeight) ?? reachProduct(counterfactualWeight, reach[1 - ai]);
      if (!Number.isFinite(modeledWeight) || modeledWeight < 0) throw new Error("Invalid modeled root weight");
      if (counterfactualWeight > 0) roots.push({ state: s, key, counterfactualWeight, modeledWeight });
    }
    if (n.kind === "terminal") return;
    if (n.kind === "chance") {
      for (const o of n.outcomes) visit(game.nextChance(s, o.outcome), reachProduct(chance, o.probability), reach, inside);
      return;
    }
    const key = game.informationSet(s, n.player), seen = sides.get(key) ?? new Set<boolean>();
    seen.add(inside); sides.set(key, seen);
    if (seen.size > 1) throw new Error(`Subgame cut splits an information set: ${key}`);
    const entry = blueprint.get(key)!;
    for (const [a, action] of n.actions.entries()) {
      const next: [number, number] = [...reach]; next[n.player] = reachProduct(next[n.player], entry.probabilities[a]);
      visit(game.nextAction(s, action), chance, next, inside);
    }
  };
  visit(game.initialState(), 1, [1, 1], false);
  if (!roots.length) throw new Error("Empty positive counterfactual roots");
  const bounds = [...new Set(roots.map(r => r.key))].map(key => {
    const subset = roots.filter(r => r.key === key), mass = subset.reduce((s, r) => s + r.counterfactualWeight, 0);
    const forest = forestGame(game, subset, subset.map(r => r.counterfactualWeight));
    const ix = buildGameTreeIndex(forest);
    const value = informationSetBestResponse(forest, restrictProfile(ix, blueprint), (1 - ai) as SolverPlayer, ix).value;
    return { key, mass, value };
  });
  return { game, blueprint, ai, index, roots, bounds };
}

export function createGadgetGame<S, A extends string, C>(p: Subgame<S, A, C>, mode: ResolveMode): ExtensiveFormGame<Wrapped<S>, string, Draw<C>> {
  if (!["unsafe", "resolve", "max-margin"].includes(mode)) throw new Error("Unknown resolving mode");
  if (mode === "unsafe") {
    if (!p.roots.some(r => r.modeledWeight > 0)) throw new Error("Unsafe modeled root mass is zero; posterior is undefined");
    return forestGame(p.game, p.roots, p.roots.map(r => r.modeledWeight));
  }
  const opponent = (1 - p.ai) as SolverPlayer, bound = new Map(p.bounds.map(b => [b.key, b]));
  const total = p.bounds.reduce((s, b) => s + b.mass, 0);
  const choices = p.bounds.map((_, i) => `${PREFIX}hand-${i}`);
  const rootDraws = (group?: string) => p.roots.flatMap((r, index) => group === undefined || r.key === group
    ? [{ outcome: { kind: "root" as const, index }, probability: r.counterfactualWeight / (group === undefined ? total : bound.get(group)!.mass) }] : []);
  const utility = (value: number): readonly [number, number] => opponent === 0 ? [value, -value] : [-value, value];
  return {
    id: `${p.game.id}:${mode}`, initialState: () => ({ kind: "start" }),
    node(s) {
      if (s.kind === "start") return mode === "resolve" ? { kind: "chance", outcomes: rootDraws() }
        : { kind: "player", player: opponent, actions: choices };
      if (s.kind === "choose-root") return { kind: "chance", outcomes: rootDraws(s.group) };
      if (s.kind === "opt") return { kind: "player", player: opponent, actions: [`${PREFIX}exit`, `${PREFIX}enter`] };
      if (s.kind === "exit") return { kind: "terminal", utility: utility(bound.get(p.roots[s.root].key)!.value) };
      const n = p.game.node(s.state);
      if (n.kind === "terminal" && mode === "max-margin") return { kind: "terminal", utility: utility(n.utility[opponent] - bound.get(s.group)!.value) };
      if (n.kind === "chance") return { kind: "chance", outcomes: n.outcomes.map(o => ({ outcome: { kind: "base" as const, outcome: o.outcome }, probability: o.probability })) };
      return n;
    },
    nextChance(s, d) {
      if (d.kind === "root" && (s.kind === "start" && mode === "resolve" || s.kind === "choose-root")) {
        const root = p.roots[d.index];
        if (!root || s.kind === "choose-root" && root.key !== s.group) throw new Error("Invalid gadget root");
        return mode === "resolve" ? { kind: "opt", root: d.index } : { kind: "base", state: root.state, group: root.key };
      }
      if (s.kind === "base" && d.kind === "base") return { ...s, state: p.game.nextChance(s.state, d.outcome) };
      throw new Error("Invalid gadget chance transition");
    },
    nextAction(s, a) {
      if (s.kind === "start" && mode === "max-margin" && choices.includes(a)) return { kind: "choose-root", group: p.bounds[choices.indexOf(a)].key };
      if (s.kind === "opt") {
        if (a === `${PREFIX}exit`) return { kind: "exit", root: s.root };
        if (a === `${PREFIX}enter`) return { kind: "base", state: p.roots[s.root].state, group: p.roots[s.root].key };
      }
      if (s.kind === "base") return { ...s, state: p.game.nextAction(s.state, a as A) };
      throw new Error("Invalid gadget action");
    },
    informationSet(s, player) {
      if (s.kind === "start" && mode === "max-margin" && player === opponent) return `${PREFIX}choose-hand`;
      if (s.kind === "opt" && player === opponent) return `${PREFIX}opt/${p.roots[s.root].key}`;
      if (s.kind === "base") return p.game.informationSet(s.state, player);
      throw new Error("Invalid gadget information set");
    },
  };
}

/** Independent BR per root hand, conditional on chance × fixed AI reach, in original chip units. */
export function gradeSubgameResponse<S, A extends string, C>(p: Subgame<S, A, C>, strategy: BehavioralStrategy<A>) {
  validateStrategy(p.index, strategy);
  return p.bounds.map(b => {
    const subset = p.roots.filter(r => r.key === b.key), game = forestGame(p.game, subset, subset.map(r => r.counterfactualWeight));
    const index = buildGameTreeIndex(game);
    const value = informationSetBestResponse(game, restrictProfile(index, strategy), (1 - p.ai) as SolverPlayer, index).value;
    return { key: b.key, mass: b.mass, bound: b.value, value, gain: value - b.value, margin: b.value - value };
  });
}

export function solveGadgetSubgame<S, A extends string, C>(p: Subgame<S, A, C>, mode: ResolveMode,
  options: { iterations: number; averagingDelay: number }) {
  const game = createGadgetGame(p, mode);
  const solve = solveCompactCfr(game, { ...options, algorithm: "cfr-plus" });
  const strategy = new Map(p.blueprint);
  for (const i of solve.index.informationSets) if (i.player === p.ai) {
    const entry = solve.averageStrategy.get(i.key)!;
    strategy.set(i.key, { actions: entry.actions as readonly A[], probabilities: entry.probabilities });
  }
  validateStrategy(p.index, strategy);
  const constraints = gradeSubgameResponse(p, strategy);
  const gadgetGrade = gradeStrategy(game, solve.averageStrategy, solve.index);
  return { mode, iterations: solve.iterations, strategy, constraints,
    maximumGain: Math.max(...constraints.map(r => r.gain)), minimumMargin: Math.min(...constraints.map(r => r.margin)),
    gadgetNashGap: gadgetGrade.nashGap, gadgetStates: solve.index.totalStates };
}
