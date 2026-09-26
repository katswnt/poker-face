// Realization tables R[position][potType][class] (spec §3.1) and the hand-class buckets used
// for shrinkage and sensitivity sweeps (spec §3.2, §3.3).
import defaults from "./realization-defaults.json";
import { NUM_CLASSES } from "../comboCounts";
import { HANDS } from "../hands";
import { POT_TYPES, PREFLOP_REALIZATION_FORMAT, validateRealizationTable, type PotType, type RealizationPosition, type RealizationTableV1 } from "./contract";

export const REALIZATION_DEFAULTS = defaults as {
  readonly format: "poker-face-preflop-realization-defaults";
  readonly version: 1;
  readonly source: string;
  readonly ip: Readonly<Record<PotType, number>>;
  readonly oop: Readonly<Record<PotType, number>>;
};

export function flatRealizationTable(
  flat: { readonly ip: Readonly<Record<PotType, number>>; readonly oop: Readonly<Record<PotType, number>> },
  source: string,
): RealizationTableV1 {
  const expand = (byPot: Readonly<Record<PotType, number>>) =>
    Object.fromEntries(POT_TYPES.map(pot => [pot, new Array<number>(NUM_CLASSES).fill(byPot[pot])])) as Record<PotType, number[]>;
  return validateRealizationTable({ format: PREFLOP_REALIZATION_FORMAT, version: 1, source, ip: expand(flat.ip), oop: expand(flat.oop) });
}

/** The spec §3.1 defaults expanded to all 169 classes. */
export function defaultRealizationTable(): RealizationTableV1 {
  return flatRealizationTable(REALIZATION_DEFAULTS, REALIZATION_DEFAULTS.source);
}

/** R = 1 everywhere: flop terminals then pay raw equity (used by tests). */
export function unitRealizationTable(source = "R = 1 everywhere (test table)"): RealizationTableV1 {
  const one = { srp: 1, "3bp": 1, "4bp": 1 };
  return flatRealizationTable({ ip: one, oop: one }, source);
}

export type HandBucket =
  | "pairs" | "suited-ax" | "suited-broadway" | "suited-connectors" | "suited-other"
  | "offsuit-broadway" | "offsuit-ax" | "offsuit-other";

export const HAND_BUCKETS: readonly HandBucket[] = [
  "pairs", "suited-ax", "suited-broadway", "suited-connectors", "suited-other",
  "offsuit-broadway", "offsuit-ax", "offsuit-other",
];

/**
 * Bucket of a class (precedence top to bottom): pairs; suited: A-high → suited Ax, both ≥ T →
 * suited broadway, rank gap ≤ 3 (connectors, one- and two-gappers) → suited connectors, else
 * other suited; offsuit: A-high → offsuit Ax, both ≥ T → offsuit broadway, else other offsuit.
 */
export function bucketOf(classIndex: number): HandBucket {
  const hand = HANDS[classIndex];
  if (hand.type === "pair") return "pairs";
  if (hand.type === "suited") {
    if (hand.hi === 14) return "suited-ax";
    if (hand.lo >= 10) return "suited-broadway";
    if (hand.hi - hand.lo <= 3) return "suited-connectors";
    return "suited-other";
  }
  if (hand.hi === 14) return "offsuit-ax";
  if (hand.lo >= 10) return "offsuit-broadway";
  return "offsuit-other";
}

export const CLASS_BUCKETS: readonly HandBucket[] = HANDS.map((_, i) => bucketOf(i));

/** Copy of `table` with `transform(position, pot, class, value)` applied to every cell. */
export function mapRealizationTable(
  table: RealizationTableV1,
  source: string,
  transform: (position: RealizationPosition, pot: PotType, classIndex: number, value: number) => number,
): RealizationTableV1 {
  const map = (position: RealizationPosition) => Object.fromEntries(POT_TYPES.map(pot =>
    [pot, table[position][pot].map((v, c) => transform(position, pot, c, v))])) as Record<PotType, number[]>;
  return validateRealizationTable({ format: PREFLOP_REALIZATION_FORMAT, version: 1, source, ip: map("ip"), oop: map("oop") });
}
