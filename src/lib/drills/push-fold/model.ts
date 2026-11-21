/** Saved values in big blinds, relative to folding at this decision. No React or I/O. */
export type Seat = "sb" | "bb";
export interface PushFoldRow {
  readonly hand: number;
  readonly frequency: number;
  readonly evBb: number;
  readonly equity: number | null;
  readonly foldProbability: number | null;
  readonly reachProbability: number;
}
export interface PushFoldDepth {
  readonly version: 1;
  readonly stack: number;
  readonly sb: readonly PushFoldRow[];
  readonly bb: readonly (PushFoldRow | null)[];
  readonly sbGainBb: number;
  readonly bbGainBb: number;
  /** Sum, not half, of the two unilateral gains in the full fixed-matrix game. */
  readonly nashGapBb: number;
}
export interface PushFoldGrade {
  readonly evBb: number;
  readonly lossBb: number;
  readonly frequency: number;
  readonly correct: boolean;
}
export interface PushFoldDetail {
  readonly datasetId: string;
  readonly stack: number;
  readonly seat: Seat;
  readonly hand: string;
  readonly equity: number | null;
  readonly foldProbability: number | null;
  readonly requiredEquity: number | null;
  readonly nashGapBb: number;
  readonly gapBb: number;
  readonly actions: readonly {id: string; label: string; grade: PushFoldGrade}[];
}
export const MAX_DEPTH_BYTES = 200 * 1024;
export const PRACTICE_TOLERANCE_BB = 0.01;
export const PROFILE_GAP_LIMIT_BB = 0.0005;
export const isDepth = (s: unknown): s is number => typeof s === "number" && s >= 2 && s <= 20 && Number.isInteger(s * 2);

/** Hash validation is separate; schema checks also guard implementation/version mistakes. */
export function validateDepth(value: unknown, stack: number): PushFoldDepth {
  if (!value || typeof value !== "object") throw new Error("Invalid push/fold data.");
  const d = value as PushFoldDepth;
  const probability = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  const gain = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= -1e-12 && n <= PROFILE_GAP_LIMIT_BB;
  if (d.version !== 1 || d.stack !== stack || !isDepth(stack) || !Array.isArray(d.sb) || !Array.isArray(d.bb) || d.sb.length !== 169 || d.bb.length !== 169 || !gain(d.sbGainBb) || !gain(d.bbGainBb) || !gain(d.nashGapBb) || Math.abs(d.nashGapBb - d.sbGainBb - d.bbGainBb) > 1e-12) throw new Error("Invalid push/fold profile.");
  for (const seat of ["sb", "bb"] as const) d[seat].forEach((row, hand) => {
    if (seat === "bb" && row === null) return;
    if (!row || row.hand !== hand || !probability(row.frequency) || !Number.isFinite(row.evBb) || Math.abs(row.evBb) > 2 * stack || !probability(row.reachProbability) || row.reachProbability <= 0 || (row.equity !== null && !probability(row.equity)) || (seat === "sb" ? !probability(row.foldProbability) : row.foldProbability !== null || row.equity === null)) throw new Error("Invalid push/fold decision.");
    if (seat === "sb" && (row.foldProbability === 1) !== (row.equity === null)) throw new Error("Invalid push/fold conditional equity.");
  });
  return d;
}
