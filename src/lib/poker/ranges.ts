// Preflop hand classification and position-based thresholds.
//
// IMPORTANT framing: this is a hand-tier heuristic, NOT a game-theory-optimal solver.
// It buckets 169 starting hands into 6 tiers and opens/defends by position. It is a
// teachable starting-hand chart — it has no mixed strategies, no card removal,
// and no range-vs-range indifference. See README ("Is this GTO?") for the
// honest scope.
import type { TableStyle } from "./types";

// Hand group 1 (strongest) → 6 (weakest). Args are the high/low rank values (2–14).
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

// Exact combo coverage for each cumulative hand group. Computing this from the classifier
// keeps every percentage shown in the product tied to the code that actually makes the
// decision. There are 1,326 equally likely two-card starting combinations: 6 per pair,
// 4 per suited non-pair hand, and 12 per offsuit non-pair hand.
const TOTAL_STARTING_COMBOS = 1326;
const COMBOS_BY_TIER = (() => {
  const counts = new Array(7).fill(0);
  for (let hi = 2; hi <= 14; hi++) {
    for (let lo = 2; lo <= hi; lo++) {
      if (hi === lo) counts[preflopHandTier(hi, lo, false)] += 6;
      else {
        counts[preflopHandTier(hi, lo, true)] += 4;
        counts[preflopHandTier(hi, lo, false)] += 12;
      }
    }
  }
  return counts;
})();

export function preflopRangePercent(maxTier: number): number {
  const cap = Math.max(0, Math.min(6, Math.floor(maxTier)));
  return COMBOS_BY_TIER.slice(1, cap + 1).reduce((sum, count) => sum + count, 0)
    / TOTAL_STARTING_COMBOS * 100;
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
  if (posShort === "BB")  return [cap(2 + b), cap(5 + b)];   // BB re-raises its strongest groups, defends wide
  return [cap(3 + b), cap(4 + b)];
}
