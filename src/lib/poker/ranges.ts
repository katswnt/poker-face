// Preflop hand classification and position-based thresholds.
//
// IMPORTANT framing: this is a hand-tier heuristic, NOT a game-theory-optimal solver.
// It buckets 169 starting hands into 6 tiers and opens/defends by position. It is a
// reasonable, teachable approximation of a solver's *ranges* — it has no mixed
// strategies, no card removal, and no range-vs-range indifference. See README
// ("Is this GTO?") for the honest scope.
import type { TableStyle } from "./types";

// Hand tier 1 (premium) → 6 (garbage). Args are the high/low rank values (2–14).
export function preflopHandTier(hi: number, lo: number, suited: boolean): number {
  if (hi === lo) { if (hi >= 11) return 1; if (hi >= 7) return 2; if (hi >= 5) return 3; return 4; }
  if (hi === 14) {
    if (lo >= 13)         return 1;
    if (lo >= 10)         return suited ? 1 : 2;
    if (lo >= 7)          return suited ? 2 : 4;
                          return suited ? 3 : 5;
  }
  if (hi === 13) {
    if (lo >= 12)         return suited ? 1 : 2;
    if (lo >= 10)         return suited ? 2 : 3;
    if (lo >= 9)          return suited ? 3 : 4;
                          return suited ? 4 : 6;
  }
  if (hi === 12) {
    if (lo >= 11)         return suited ? 2 : 3;
    if (lo >= 9)          return suited ? 3 : 4;
                          return suited ? 4 : 6;
  }
  if (hi === 11) {
    if (lo >= 10)         return suited ? 2 : 3;
    if (lo >= 8)          return suited ? 3 : 5;
                          return suited ? 4 : 6;
  }
  if (hi === 10) {
    if (lo === 9)         return suited ? 2 : 3;
    if (lo === 8)         return suited ? 3 : 5;
                          return suited ? 4 : 6;
  }
  const gap = hi - lo;
  if (suited && gap <= 1) return 3;
  if (suited && gap <= 2) return 4;
  if (suited)             return 5;
  return 6;
}

// [raiseTier, callTier] — play a hand if its tier <= threshold.
// numRaisesAhead: 0 = opening, 1 = facing one raise (3-bet/call), 2+ = facing 4-bet+.
export function preflopThresholds(posShort: string, numRaisesAhead: number, style: TableStyle = "gto"): [number, number] {
  const cap = (n: number) => Math.min(n, 6) as number;
  if (numRaisesAhead >= 2) {
    // 4-bet war: only the nuts survive regardless of style.
    const b = style === "wild" ? 1 : 0;
    return [cap(1 + b), cap(1 + b)];
  }
  if (numRaisesAhead === 1) {
    // Facing a 3-bet: tighten significantly vs opening range.
    const b = style === "loose" ? 1 : style === "wild" ? 2 : 0;
    return [cap(2 + b), cap(3 + b)];
  }
  // Opening ranges — full style bonus applies.
  const b = style === "loose" ? 2 : style === "wild" ? 4 : 0;
  if (posShort === "UTG") return [cap(3 + b), cap(3 + b)];   // 4-handed UTG ≈ CO; raise-or-fold
  if (posShort === "BTN") return [cap(4 + b), cap(5 + b)];
  if (posShort === "SB")  return [cap(4 + b), cap(5 + b)];   // 4-handed SB opens wide
  if (posShort === "BB")  return [cap(2 + b), cap(5 + b)];   // BB re-raises premiums, defends wide
  return [cap(3 + b), cap(4 + b)];
}
