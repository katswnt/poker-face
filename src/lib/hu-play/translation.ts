/**
 * Pseudo-harmonic action translation (Ganzfried & Sandholm, IJCAI 2013; spec §1).
 * Sizes are bets as fractions of the pot, so the mapping is scale-invariant by construction:
 * multiplying pot and bets by any k leaves f unchanged. Pure and browser-safe.
 */

/** Probability of mapping an off-tree bet x onto the smaller neighbour A (else B), A ≤ x ≤ B. */
export function pseudoHarmonicProbabilityA(a: number, b: number, x: number): number {
  if (![a, b, x].every(Number.isFinite) || a < 0 || !(a < b)) throw new Error(`Need 0 ≤ A < B; received A=${a}, B=${b}`);
  if (x < a || x > b) throw new Error(`x=${x} is outside [A, B] = [${a}, ${b}]`);
  return ((b - x) * (1 + a)) / ((b - a) * (1 + x));
}

/** Same mapping in chips: bets and pot in any common unit. */
export function pseudoHarmonicProbabilityChips(pot: number, aChips: number, bChips: number, xChips: number): number {
  if (!(pot > 0)) throw new Error("pot must be positive");
  return pseudoHarmonicProbabilityA(aChips / pot, bChips / pot, xChips / pot);
}
