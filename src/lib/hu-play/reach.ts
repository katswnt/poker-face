/**
 * Reach-vector bookkeeping (spec §1): π(h | s) = w(h) · Π σ(a' | h, s') over the player's own
 * decisions on the path. The AI's vector is exact (it multiplies in the strategy it actually
 * played, per combo); the human's is a model (the solver's strategy for the human's seat).
 *
 * Card removal: a dealt board card zeroes the combos it blocks. The human's hole cards are never
 * removed from the AI's vector (or vice versa): neither side's range may depend on private cards.
 * Pure and browser-safe.
 */
import { compareBridgeCombos, parseBridgeCombo, type BridgeRange } from "../solver/bridge/contract";
import type { RiverCard } from "../solver/river/cards";
import type { HuRange } from "./types";

export function rangeFromBridge(range: BridgeRange, source = range.source): HuRange {
  return { source, entries: range.combos.map(e => ({ combo: e.combo, weight: e.weight })) };
}

/** Multiply each combo's weight by `probability(combo)` (σ of the action taken at this node). */
export function applyStrategy(range: HuRange, probability: (combo: string) => number): HuRange {
  return {
    source: range.source,
    entries: range.entries.map(e => {
      const p = probability(e.combo);
      if (!(p >= 0 && p <= 1)) throw new Error(`Strategy probability ${p} for ${e.combo} is outside [0, 1]`);
      return { combo: e.combo, weight: e.weight * p };
    }),
  };
}

/** Remove combos blocked by a newly dealt board card. */
export function removeCard(range: HuRange, card: RiverCard): HuRange {
  return { source: range.source, entries: range.entries.filter(e => !parseBridgeCombo(e.combo).includes(card)) };
}

export function reachOf(range: HuRange, combo: string): number {
  return range.entries.find(e => e.combo === combo)?.weight ?? 0;
}

export function assertSortedRange(range: HuRange): void {
  for (let i = 1; i < range.entries.length; i++) {
    if (compareBridgeCombos(range.entries[i - 1].combo, range.entries[i].combo) >= 0) throw new Error("Range entries must be sorted and unique");
  }
}
