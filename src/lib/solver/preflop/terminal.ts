// Terminal valuation rules (spec §3) and the dealt-hands model shared by the solver and grader.
//
// Utility = chip EV in bb, net from the start of the hand. With dead money the game is
// constant-sum: u0 + u1 = dead − rake at every terminal (rake is 0 in v1 solves).
//
// - Fold: the folder loses what it put in; the other player takes the pot.
// - All-in called (showdown): pot × eq(h, k) from the exact matrix (R = 1 by definition).
// - See flop (SRP / 3BP / 4BP): normalized shares
//     a = eq·R_IP(t, h_IP), b = (1 − eq)·R_OOP(t, h_OOP), share_IP = a / (a + b)
//   so shares stay in [0, 1] and sum to the pot. Player 0 (BTN) is in position postflop.
import equityData from "../equity-matrix.json";
import { DISJOINT, ORDERED_DISJOINT_PAIRS } from "../comboCounts";
import { HANDS } from "../hands";
import { spotClasses, validatePreflopSpot, type PreflopRake, type PreflopSpotV1, type PotType, type RealizationTableV1 } from "./contract";
import { buildPreflopTree, type PreflopTerminalNode, type PreflopTree } from "./tree";

/** EQ[h][k] = all-in equity of class h vs class k (exact, card-disjoint measure). */
export const EQ: readonly (readonly number[])[] = equityData.equity;

export function rakeAmount(pot: number, rake: PreflopRake): number {
  return Math.min(rake.pct * pot, rake.capBb);
}

/** Fold terminal: [u0, u1]. */
export function foldUtility(contrib: readonly [number, number], dead: number, folder: 0 | 1): [number, number] {
  const u: [number, number] = [0, 0];
  const winner = 1 - folder;
  u[folder] = -contrib[folder];
  u[winner] = contrib[folder] + dead; // the pot minus the winner's own chips (no flop, no drop)
  return u;
}

/** Player 0's share of the pot when player 0 holds equity `eq` and both players are in position IP (p0) / OOP (p1). */
export function flopShareIp(eq: number, rIp: number, rOop: number): number {
  const a = eq * rIp, b = (1 - eq) * rOop;
  const total = a + b;
  return total > 0 ? a / total : 0.5;
}

/** Pot-share terminal (showdown or flop) given player 0's share of the (raked) pot. */
export function shareUtility(contrib: readonly [number, number], pot: number, rake: PreflopRake, share0: number): [number, number] {
  const net = pot - rakeAmount(pot, rake);
  return [net * share0 - contrib[0], net * (1 - share0) - contrib[1]];
}

export interface PreflopGame {
  readonly spot: PreflopSpotV1;
  readonly tree: PreflopTree;
  /** Class indices (into HANDS) in the game, ascending. Positions 0..n−1 index every vector. */
  readonly classes: readonly number[];
  readonly n: number;
  /** D[i·n + j] = DISJOINT[classes[i]][classes[j]] (ordered disjoint combo pairs). */
  readonly deal: Float64Array;
  /** Σ D over the game's classes (= 1,624,350 when all 169 classes are in). */
  readonly dealTotal: number;
  /** Combo count of each class (6 / 4 / 12). */
  readonly comboWeight: readonly number[];
}

export function buildPreflopGame(spotInput: PreflopSpotV1): PreflopGame {
  const spot = validatePreflopSpot(spotInput);
  const classes = spotClasses(spot);
  const n = classes.length;
  const deal = new Float64Array(n * n);
  let total = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const d = DISJOINT[classes[i]][classes[j]];
    deal[i * n + j] = d;
    total += d;
  }
  if (spot.classes === "all" && total !== ORDERED_DISJOINT_PAIRS) throw new Error(`deal total ${total} ≠ ${ORDERED_DISJOINT_PAIRS}`);
  return { spot, tree: buildPreflopTree(spot), classes, n, deal, dealTotal: total, comboWeight: classes.map(c => HANDS[c].weight) };
}

function realization(table: RealizationTableV1, potType: PotType, h0: number, h1: number): [number, number] {
  return [table.ip[potType][h0], table.oop[potType][h1]];
}

/**
 * Utility [u0, u1] at a terminal when player 0 holds class `h0` and player 1 holds `h1`
 * (indices into HANDS). The single source of the game's payoff rules.
 */
export function terminalUtility(spot: PreflopSpotV1, node: PreflopTerminalNode, h0: number, h1: number): [number, number] {
  if (node.terminal === "fold") return foldUtility(node.contrib, spot.structure.dead, node.folder!);
  const eq = EQ[h0][h1];
  if (node.terminal === "showdown") return shareUtility(node.contrib, node.pot, spot.rake, eq);
  const [rIp, rOop] = realization(spot.realization, node.potType!, h0, h1);
  return shareUtility(node.contrib, node.pot, spot.rake, flopShareIp(eq, rIp, rOop));
}
