// Validation, structural checks and range comparisons for preflop results (spec §6, §3.3).
// Published aggregates are sanity bands for a *model comparison*: R is never tuned to hit them.
import { HANDS } from "../hands";
import type { PreflopResultV1 } from "./contract";

export interface ValidationRow {
  readonly metric: string;
  readonly model: number | null;
  readonly band: string;
  readonly source: string;
  readonly status: "inside band" | "outside band (flag)" | "report only" | "pass" | "FAIL";
  readonly note: string;
}

const RESEARCH = "tasks/preflop-ranges-research.md §3 (secondary sources, partly undocumented assumptions)";

export function validationTable(result: PreflopResultV1): ValidationRow[] {
  const s = result.stats;
  const band = (v: number | undefined, lo: number, hi: number) =>
    v === undefined ? "report only" : v >= lo && v <= hi ? "inside band" : "outside band (flag)";
  return [
    {
      metric: "BTN RFI %", model: s.btnOpenPct ?? null, band: "published ~43% (2.5bb, raked, SB can 3-bet); flag outside 38–65%",
      source: `${RESEARCH}: preflopwizard.app/blog/6-max-preflop-charts, beyondgto.com/ranges`,
      status: band(s.btnOpenPct, 38, 65), note: "Our SB always folds and rake = 0, so wider than the published raked figure is expected.",
    },
    {
      metric: "BB defend % vs 2.5x (call + 3-bet)", model: s.bbDefendPct ?? null, band: "~52–58% raked; research band 55–70% for no rake",
      source: `${RESEARCH}: vip-grinders.com/poker-strategy/big-blind-defense, preflopwizard.app/blog/big-blind-defense`,
      status: band(s.bbDefendPct, 55, 70), note: "No rake and dead SB money widen defence; R for classes outside the library's ranges is extrapolated from buckets.",
    },
    {
      metric: "BB defend ≥ MDF-style bound", model: s.bbDefendPct ?? null, band: "≥ 37.5% (1.5 / 4.0)",
      source: RESEARCH, status: s.bbDefendPct === undefined ? "report only" : s.bbDefendPct >= 37.5 ? "pass" : "FAIL", note: "Hard check.",
    },
    { metric: "BB 3-bet % vs BTN", model: s.bb3betPct ?? null, band: "no citable figure found", source: RESEARCH, status: "report only", note: "" },
    { metric: "BTN 4-bet % of opens (vs 3-bet)", model: s.btn4betOfOpenPct ?? null, band: "no citable figure found", source: RESEARCH, status: "report only", note: "" },
  ];
}

/** Classes that fold AA or KK at any node they reach (must be empty). */
export function premiumFolds(result: PreflopResultV1): string[] {
  const out: string[] = [];
  for (const label of ["AA", "KK"]) {
    const h = result.classes.indexOf(label);
    if (h < 0) continue;
    for (const [id, node] of Object.entries(result.strategy)) {
      const fold = node.actions.indexOf("fold");
      if (fold >= 0 && node.freq[fold][h] > 1e-6) out.push(`${label} folds ${node.freq[fold][h]} at "${id}"`);
    }
  }
  return out;
}

/** Combo-weighted L1 distance (in combos, out of 1,326) between two results' frequencies of one action at one node. */
export function rangeL1(a: PreflopResultV1, b: PreflopResultV1, nodeId: string, action: string): number {
  const na = a.strategy[nodeId], nb = b.strategy[nodeId];
  const ia = na.actions.indexOf(action), ib = nb.actions.indexOf(action);
  let sum = 0;
  a.classes.forEach((label, h) => {
    const k = b.classes.indexOf(label);
    sum += HANDS[HANDS.findIndex(x => x.label === label)].weight * Math.abs(na.freq[ia][h] - nb.freq[ib][k]);
  });
  return sum;
}

/**
 * Monotonicity report for one action at one node: within pairs (by rank) and within each
 * suited/offsuit row (same high card, kicker descending), count steps where a weaker hand's
 * frequency exceeds the next stronger one's by more than 0.05.
 */
export function monotonicityViolations(result: PreflopResultV1, nodeId: string, action: string): string[] {
  const node = result.strategy[nodeId], a = node.actions.indexOf(action);
  const freq = (label: string) => node.freq[a][result.classes.indexOf(label)];
  const R = "AKQJT98765432";
  const out: string[] = [];
  for (let i = 1; i < 13; i++) {
    const strong = R[i - 1] + R[i - 1], weak = R[i] + R[i];
    if (freq(weak) > freq(strong) + 0.05) out.push(`${weak} ${freq(weak).toFixed(3)} > ${strong} ${freq(strong).toFixed(3)}`);
  }
  for (const suffix of ["s", "o"]) for (let hi = 0; hi < 12; hi++) for (let lo = hi + 2; lo < 13; lo++) {
    const strong = R[hi] + R[lo - 1] + suffix, weak = R[hi] + R[lo] + suffix;
    if (freq(weak) > freq(strong) + 0.05) out.push(`${weak} ${freq(weak).toFixed(3)} > ${strong} ${freq(strong).toFixed(3)}`);
  }
  return out;
}
