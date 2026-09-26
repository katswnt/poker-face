// Vector-form CFR+ (default) or DCFR on the public preflop tree over hand classes (spec §4).
//
// Each decision node holds per-class regret and strategy-sum vectors for its actor. One
// iteration = two alternating traversals (player 0 then player 1). A traversal for player i
// carries i's own reach vector and the opponent's reach vector; terminal counterfactual values
// are matrix-vector products cfv_i[h] = Σ_k D[h][k]·u_i(h, k)·r_opp[k], with D the ordered
// card-disjoint combo-pair counts (card removal) and u from terminal.ts.
//
// CFR+: regrets floored at 0 after every update; average strategy weighted by max(0, t − d).
// DCFR(α, β, γ): positive regrets × t^α/(t^α + 1), negative × t^β/(t^β + 1); weight t^γ.
// Deterministic: no sampling, fixed traversal order.
import type { PreflopGame } from "./terminal";
import { terminalUtility } from "./terminal";
import type { PreflopDecisionNode, PreflopNode, PreflopProfile, PreflopTerminalNode } from "./tree";

interface NodeState {
  readonly node: PreflopDecisionNode;
  readonly regrets: Float64Array;   // [a·n + h]
  readonly strategySum: Float64Array;
}

export class PreflopCfr {
  readonly game: PreflopGame;
  iterations = 0;
  private readonly n: number;
  private readonly states = new Map<string, NodeState>();
  /** payoff[terminalId][player] = n×n matrix, row = that player's class, col = opponent's class, D-weighted. */
  private readonly payoff = new Map<string, [Float64Array, Float64Array]>();

  constructor(game: PreflopGame) {
    this.game = game;
    const n = this.n = game.n;
    for (const node of game.tree.decisions) {
      const size = node.actions.length * n;
      this.states.set(node.id, { node, regrets: new Float64Array(size), strategySum: new Float64Array(size) });
    }
    for (const terminal of game.tree.terminals) {
      const m0 = new Float64Array(n * n), m1 = new Float64Array(n * n);
      for (let h = 0; h < n; h++) for (let k = 0; k < n; k++) {
        const d = game.deal[h * n + k];
        const [u0, u1] = terminalUtility(game.spot, terminal, game.classes[h], game.classes[k]);
        m0[h * n + k] = d * u0; // player 0 holds h, player 1 holds k
        m1[k * n + h] = d * u1; // row = player 1's class
      }
      this.payoff.set(terminal.id, [m0, m1]);
    }
  }

  private currentStrategy(state: NodeState): Float64Array[] {
    const n = this.n, actions = state.node.actions.length, regrets = state.regrets;
    const out = Array.from({ length: actions }, () => new Float64Array(n));
    for (let h = 0; h < n; h++) {
      let positive = 0;
      for (let a = 0; a < actions; a++) { const r = regrets[a * n + h]; if (r > 0) positive += r; }
      for (let a = 0; a < actions; a++) {
        const r = regrets[a * n + h];
        out[a][h] = positive > 0 ? (r > 0 ? r / positive : 0) : 1 / actions;
      }
    }
    return out;
  }

  private terminalValue(node: PreflopTerminalNode, player: 0 | 1, opponentReach: Float64Array): Float64Array {
    const n = this.n, matrix = this.payoff.get(node.id)![player];
    const out = new Float64Array(n);
    for (let h = 0; h < n; h++) {
      let sum = 0;
      const row = h * n;
      for (let k = 0; k < n; k++) sum += matrix[row + k] * opponentReach[k];
      out[h] = sum;
    }
    return out;
  }

  private traverse(node: PreflopNode, player: 0 | 1, ownReach: Float64Array, opponentReach: Float64Array, weight: number): Float64Array {
    if (node.kind === "terminal") return this.terminalValue(node, player, opponentReach);
    const n = this.n, state = this.states.get(node.id)!, actions = node.actions.length;
    const sigma = this.currentStrategy(state);
    if (node.player !== player) {
      const value = new Float64Array(n);
      for (let a = 0; a < actions; a++) {
        const reach = new Float64Array(n);
        for (let k = 0; k < n; k++) reach[k] = opponentReach[k] * sigma[a][k];
        const child = this.traverse(node.children[a], player, ownReach, reach, weight);
        for (let h = 0; h < n; h++) value[h] += child[h];
      }
      return value;
    }
    const childValues: Float64Array[] = [];
    const value = new Float64Array(n);
    for (let a = 0; a < actions; a++) {
      const reach = new Float64Array(n);
      for (let h = 0; h < n; h++) reach[h] = ownReach[h] * sigma[a][h];
      const child = this.traverse(node.children[a], player, reach, opponentReach, weight);
      childValues.push(child);
      for (let h = 0; h < n; h++) value[h] += sigma[a][h] * child[h];
    }
    const { regrets, strategySum } = state;
    const options = this.game.spot.solver;
    const t = this.iterations + 1;
    let positiveScale = 1, negativeScale = 0;
    if (options.algorithm === "dcfr") {
      const ta = Math.pow(t, options.dcfr.alpha), tb = Math.pow(t, options.dcfr.beta);
      positiveScale = ta / (ta + 1);
      negativeScale = tb / (tb + 1);
    }
    for (let a = 0; a < actions; a++) {
      const child = childValues[a], offset = a * n, s = sigma[a];
      for (let h = 0; h < n; h++) {
        const i = offset + h;
        const r = regrets[i] + child[h] - value[h];
        regrets[i] = options.algorithm === "dcfr" ? r * (r > 0 ? positiveScale : negativeScale) : Math.max(0, r);
        if (weight > 0) strategySum[i] += weight * ownReach[h] * s[h];
      }
    }
    return value;
  }

  /** Run `count` more iterations (each = one traversal per player). */
  run(count: number): void {
    const n = this.n, options = this.game.spot.solver;
    for (let step = 0; step < count; step++) {
      const t = this.iterations + 1;
      const weight = options.algorithm === "dcfr" ? Math.pow(t, options.dcfr.gamma) : Math.max(0, t - options.averagingDelay);
      for (const player of [0, 1] as const) {
        const ones = new Float64Array(n).fill(1);
        this.traverse(this.game.tree.root, player, ones, new Float64Array(n).fill(1), weight);
      }
      this.iterations = t;
    }
  }

  /** Average strategy; classes that never reach a node (strategy sum 0) take the current strategy there. */
  averageStrategy(): PreflopProfile {
    const n = this.n, out = new Map<string, number[][]>();
    for (const [id, state] of this.states) {
      const actions = state.node.actions.length, current = this.currentStrategy(state);
      const freq = Array.from({ length: actions }, () => new Array<number>(n).fill(0));
      for (let h = 0; h < n; h++) {
        let sum = 0;
        for (let a = 0; a < actions; a++) sum += state.strategySum[a * n + h];
        for (let a = 0; a < actions; a++) freq[a][h] = sum > 0 ? state.strategySum[a * n + h] / sum : current[a][h];
      }
      out.set(id, freq);
    }
    return out;
  }
}
