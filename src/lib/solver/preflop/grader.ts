// Independent grader for preflop strategy profiles (spec §5).
//
// Does NOT import cfr.ts. It shares only the rules (terminal.ts) and the tree. Its traversal is
// organised differently from the solver's: the profile value is a scalar walk per dealt
// (h, k) pair, and each best response is computed class by class (backward induction for one
// own class h at a time, carrying the opponent's reach vector), rather than CFR's all-classes
// vector traversal.
//
// Units: bb per hand, net from the start of the hand. Exploitability = (gain0 + gain1) / 2.
import type { PreflopGrade, PreflopPlayer } from "./contract";
import { terminalUtility, type PreflopGame } from "./terminal";
import type { PreflopNode, PreflopProfile } from "./tree";

const SUM_TOLERANCE = 1e-6;

export function validateProfile(game: PreflopGame, profile: PreflopProfile): void {
  const n = game.n;
  for (const node of game.tree.decisions) {
    const freq = profile.get(node.id);
    if (!freq) throw new Error(`profile is missing node "${node.id}"`);
    if (freq.length !== node.actions.length) throw new Error(`profile node "${node.id}" has ${freq.length} actions, expected ${node.actions.length}`);
    for (let h = 0; h < n; h++) {
      let sum = 0;
      for (let a = 0; a < freq.length; a++) {
        const p = freq[a][h];
        if (freq[a].length !== n) throw new Error(`profile node "${node.id}" action ${a} has ${freq[a].length} classes, expected ${n}`);
        if (!Number.isFinite(p) || p < -1e-12 || p > 1 + 1e-12) throw new Error(`profile node "${node.id}" frequency ${p} outside [0, 1]`);
        sum += p;
      }
      if (Math.abs(sum - 1) > SUM_TOLERANCE) throw new Error(`profile node "${node.id}" class ${h} sums to ${sum}`);
    }
  }
  if (profile.size !== game.tree.decisions.length) throw new Error(`profile has ${profile.size} nodes, expected ${game.tree.decisions.length}`);
}

/** utility[terminalId][h][k] = [u0, u1] for player 0 in class position h and player 1 in k. */
function utilityTable(game: PreflopGame): Map<string, [number, number][][]> {
  const table = new Map<string, [number, number][][]>();
  for (const terminal of game.tree.terminals) {
    table.set(terminal.id, game.classes.map(h0 => game.classes.map(h1 => terminalUtility(game.spot, terminal, h0, h1))));
  }
  return table;
}

const UTILITY_CACHE = new WeakMap<PreflopGame, Map<string, [number, number][][]>>();
function utilities(game: PreflopGame) {
  let table = UTILITY_CACHE.get(game);
  if (!table) { table = utilityTable(game); UTILITY_CACHE.set(game, table); }
  return table;
}

/** Expected [u0, u1] of the profile when player 0 holds position h and player 1 holds k. */
function pairValue(game: PreflopGame, profile: PreflopProfile, h: number, k: number): [number, number] {
  const u = utilities(game);
  const walk = (node: PreflopNode): [number, number] => {
    if (node.kind === "terminal") return u.get(node.id)![h][k];
    const freq = profile.get(node.id)!, mine = node.player === 0 ? h : k;
    let v0 = 0, v1 = 0;
    node.children.forEach((child, a) => {
      const p = freq[a][mine];
      if (p === 0) return;
      const [c0, c1] = walk(child);
      v0 += p * c0; v1 += p * c1;
    });
    return [v0, v1];
  };
  return walk(game.tree.root);
}

export interface PreflopEvaluation {
  readonly grade: PreflopGrade;
  /** actionEv[nodeId][action][classPosition]: EV (bb, net) of the action for the actor's class vs the profile; null if unreachable. */
  readonly actionEv: ReadonlyMap<string, (number | null)[][]>;
}

/**
 * Value of `player` holding class position `h`, summed over opponent classes with deal weights
 * (a counterfactual value, not yet divided by the deal total). mode "best" maximises at the
 * player's own nodes; "profile" follows the profile and records per-action EVs.
 */
function classValue(
  game: PreflopGame, profile: PreflopProfile, player: PreflopPlayer, h: number, mode: "best" | "profile",
  record: Map<string, (number | null)[][]> | null,
): number {
  const n = game.n, u = utilities(game);
  const walk = (node: PreflopNode, opponentReach: number[]): number => {
    if (node.kind === "terminal") {
      const table = u.get(node.id)!;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const r = opponentReach[k];
        if (r === 0) continue;
        const d = player === 0 ? game.deal[h * n + k] : game.deal[k * n + h];
        sum += d * r * (player === 0 ? table[h][k][0] : table[k][h][1]);
      }
      return sum;
    }
    const freq = profile.get(node.id)!;
    if (node.player !== player) {
      let sum = 0;
      node.children.forEach((child, a) => {
        const reach = opponentReach.map((r, k) => r * freq[a][k]);
        sum += walk(child, reach);
      });
      return sum;
    }
    const values = node.children.map(child => walk(child, opponentReach));
    if (record) {
      let mass = 0;
      for (let k = 0; k < n; k++) mass += opponentReach[k] * (player === 0 ? game.deal[h * n + k] : game.deal[k * n + h]);
      const rows = record.get(node.id)!;
      values.forEach((v, a) => { rows[a][h] = mass > 0 ? v / mass : null; });
    }
    if (mode === "best") return Math.max(...values);
    return values.reduce((sum, v, a) => sum + freq[a][h] * v, 0);
  };
  return walk(game.tree.root, new Array<number>(n).fill(1));
}

export function evaluatePreflopProfile(game: PreflopGame, profile: PreflopProfile): PreflopEvaluation {
  validateProfile(game, profile);
  const n = game.n, z = game.dealTotal;
  let v0 = 0, v1 = 0;
  for (let h = 0; h < n; h++) for (let k = 0; k < n; k++) {
    const d = game.deal[h * n + k];
    const [a, b] = pairValue(game, profile, h, k);
    v0 += d * a; v1 += d * b;
  }
  const value: [number, number] = [v0 / z, v1 / z];

  const actionEv = new Map<string, (number | null)[][]>();
  for (const node of game.tree.decisions) actionEv.set(node.id, node.actions.map(() => new Array<number | null>(n).fill(null)));
  const best: [number, number] = [0, 0];
  const followed: [number, number] = [0, 0];
  for (const player of [0, 1] as const) {
    for (let h = 0; h < n; h++) {
      best[player] += classValue(game, profile, player, h, "best", null);
      followed[player] += classValue(game, profile, player, h, "profile", actionEv);
    }
  }
  const bestResponseValue: [number, number] = [best[0] / z, best[1] / z];
  // Consistency between the two independent value computations.
  for (const p of [0, 1] as const) {
    if (Math.abs(followed[p] / z - value[p]) > 1e-9) throw new Error(`grader: class-wise value ${followed[p] / z} ≠ pair-wise value ${value[p]} for player ${p}`);
  }
  const raw: [number, number] = [bestResponseValue[0] - value[0], bestResponseValue[1] - value[1]];
  if (raw[0] < -1e-9 || raw[1] < -1e-9) throw new Error(`grader: best response below profile value (${raw})`);
  const gains: [number, number] = [Math.max(0, raw[0]), Math.max(0, raw[1])];
  return {
    grade: { value, bestResponseValue, gains, exploitability: (gains[0] + gains[1]) / 2 },
    actionEv,
  };
}

export function gradePreflopProfile(game: PreflopGame, profile: PreflopProfile): PreflopGrade {
  return evaluatePreflopProfile(game, profile).grade;
}
