/** A fixed continuation policy's physical-pair payoffs, not a global poker solution. */
import { jointMeasure, type WeightedHand } from "./measure";
export interface ContinuationTableInput {
  readonly deckSize: number; readonly pot: number; readonly stack: number;
  readonly ranges: readonly [readonly WeightedHand[], readonly WeightedHand[]];
  readonly oopGross: readonly (readonly (number | null)[])[];
}
export function continuationTable(input: ContinuationTableInput) {
  const { pot, stack, deckSize } = input;
  if (![pot, stack].every(n => Number.isFinite(n) && n >= 0)) throw new Error("invalid pot/stack");
  const law = jointMeasure(deckSize, 0, input.ranges);
  const ranges = input.ranges.map(r => Object.freeze(r.map(h => Object.freeze({ cards: Object.freeze([...h.cards]) as readonly [number, number], weight: h.weight }))));
  if (input.oopGross.length !== ranges[0].length || input.oopGross.some(row => row.length !== ranges[1].length)) throw new Error("payoff table shape mismatch");
  const mass = ranges[0].map((a, h) => ranges[1].map((b, k) => {
    const compatible = !a.cards.some(c => b.cards.includes(c)), g = input.oopGross[h][k], p = law.jointMass(h, k, []);
    if (!compatible) { if (g !== null) throw new Error("incompatible pair must have a null payoff"); }
    else {
      if (!(p > 0)) throw new Error("compatible pair probability underflow");
      if (g === null || !Number.isFinite(g) || g < -stack || g > pot + stack) throw new Error("missing or unphysical continuation payoff");
    }
    return p;
  }));
  return Object.freeze({ format: "poker-face-continuation-table", version: 2, playerOrder: "OOP/IP", units: "from-now-chips",
    deckSize, pot, stack, partition: law.partition, ranges: Object.freeze(ranges),
    mass: Object.freeze(mass.map(row => Object.freeze(row))), oopGross: Object.freeze(input.oopGross.map(row => Object.freeze([...row]))) });
}
export type ContinuationTable = ReturnType<typeof continuationTable>;
export function tablePairValue(table: ContinuationTable, h: number, k: number): readonly [number, number] {
  if (!Number.isInteger(h) || !Number.isInteger(k) || h < 0 || k < 0 || h >= table.ranges[0].length || k >= table.ranges[1].length) throw new Error("invalid pair index");
  const oop = table.oopGross[h][k]; if (oop === null) throw new Error("incompatible pair has no payoff");
  return [oop, table.pot - oop];
}
export function expectedTableValue(table: ContinuationTable): readonly [number, number] {
  let oop = 0;
  for (let h = 0; h < table.ranges[0].length; h++) for (let k = 0; k < table.ranges[1].length; k++) {
    if (table.oopGross[h][k] !== null) oop += table.mass[h][k] * table.oopGross[h][k]!;
  }
  return [oop, table.pot - oop];
}
export function conditionalTableValues(table: ContinuationTable): readonly [readonly (number | null)[], readonly (number | null)[]] {
  const sums = table.ranges.map(r => r.map(() => 0)), masses = table.ranges.map(r => r.map(() => 0));
  for (let h = 0; h < table.ranges[0].length; h++) for (let k = 0; k < table.ranges[1].length; k++) {
    if (table.oopGross[h][k] === null) continue;
    const values = tablePairValue(table, h, k), mass = table.mass[h][k];
    sums[0][h] += mass * values[0]; sums[1][k] += mass * values[1]; masses[0][h] += mass; masses[1][k] += mass;
  }
  const result = sums.map((row, p) => row.map((v, i) => masses[p][i] > 0 ? v / masses[p][i] : null));
  return [result[0], result[1]];
}
