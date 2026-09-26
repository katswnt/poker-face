/** Quantize bridge slice nodes into library nodes (see model.ts for the units). */
import type { BridgeSliceNode } from "../contract";
import { EQUITY_SCALE, EV_SCALE, REACH_SCALE, STRATEGY_SCALE, type BridgeLibraryNode } from "./model";

/** Largest-remainder rounding: non-negative integers summing exactly to `scale`. */
export function quantizeDistribution(probabilities: readonly number[], scale = STRATEGY_SCALE): number[] {
  const total = probabilities.reduce((s, p) => s + Math.max(0, p), 0);
  if (!(total > 0)) throw new Error("Cannot quantize an empty distribution");
  const exact = probabilities.map(p => Math.max(0, p) / total * scale);
  const floor = exact.map(Math.floor);
  let missing = scale - floor.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => [x - floor[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (missing <= 0) break; floor[i] += 1; missing -= 1; }
  return floor;
}

const quantize = (value: number | null, scale: number) => value === null ? null : Math.round(value * scale);

export function encodeSliceNode(node: BridgeSliceNode): BridgeLibraryNode {
  const reachMax = ([0, 1] as const).map(p => Number(Math.max(...node.reach[p]).toPrecision(6)));
  const units = (p: 0 | 1, r: number) => reachMax[p] > 0 ? Math.round(r / reachMax[p] * REACH_SCALE) : 0;
  const live = ([0, 1] as const).map(p => node.reach[p].map((_, h) => h).filter(h => units(p, node.reach[p][h]) > 0));
  const omitted = ([0, 1] as const).map(p => node.reach[p].reduce((s, r) => units(p, r) > 0 ? s : s + r, 0));
  const actor = node.player;
  const strategyColumns = live[actor].map(h => {
    const column = node.strategy.map(row => row[h]);
    if (column.some(p => p === null)) throw new Error(`Slice ${node.path.join(" ")} has no strategy for live hand ${h}`);
    return quantizeDistribution(column as number[]);
  });
  const equity = node.equity;
  if (!equity) throw new Error("Library slices need equity");
  return {
    path: node.path.join(" "), street: node.street, board: node.board, player: actor, committed: node.committed,
    actions: node.actions.map(a => a.token),
    live: [live[0], live[1]], reachMax: [reachMax[0], reachMax[1]],
    omittedReach: [Number(omitted[0].toPrecision(6)), Number(omitted[1].toPrecision(6))],
    reach: [live[0].map(h => Math.min(REACH_SCALE, units(0, node.reach[0][h]))), live[1].map(h => Math.min(REACH_SCALE, units(1, node.reach[1][h])))],
    ev: [live[0].map(h => quantize(node.ev[0][h], EV_SCALE)), live[1].map(h => quantize(node.ev[1][h], EV_SCALE))],
    equity: [live[0].map(h => quantize(equity[0][h], EQUITY_SCALE)), live[1].map(h => quantize(equity[1][h], EQUITY_SCALE))],
    strategy: node.actions.map((_, a) => strategyColumns.map(column => column[a])),
    actionEv: node.actionEv.map(row => live[actor].map(h => quantize(row[h], EV_SCALE))),
  };
}
