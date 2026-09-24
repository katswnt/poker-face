import { POSTFLOP_M2_PROBE } from "../fixtures";
import { validateTurnV2Request, type TurnV2Menu, type TurnV2Request } from "./rules";

const street = (openingTargets: number[], raiseTargets: number[], includeAllIn = false): TurnV2Menu =>
  ({ openingTargets, raiseTargets, raiseLimit: 1, includeAllIn });
const base = { version: 2 as const, committedPerPlayer: 50 };
/** Locked before the first M3 solve; handcrafted capacity/teaching inputs, not preflop advice. */
export const TURN_V2_CORPUS: readonly TurnV2Request[] = Object.freeze([
  { ...base, id: "turn-v2-wide-64", board: POSTFLOP_M2_PROBE.board, rangeText: POSTFLOP_M2_PROBE.rangeText,
    stackBehind: [100, 100], streets: [street([25, 50], [100]), street([10, 25], [50])] },
  { ...base, id: "turn-v2-dry-value", board: ["As", "7d", "4h", "2c"], rangeText: ["AcAd AhKd QcQd", "7c7h 6s5s AhQh"],
    stackBehind: [100, 100], streets: [street([25, 50], [100]), street([10, 25], [50])] },
  { ...base, id: "turn-v2-paired-short", board: ["Kh", "Kd", "7s", "2c"], rangeText: ["AcAd QcQd KsJs", "7c7h AhQh JcTc"],
    stackBehind: [90, 60], streets: [street([20, 40], [60], true), street([10, 20], [40], true)] },
  { ...base, id: "turn-v2-two-tone", board: ["Ks", "8s", "4d", "2c"], rangeText: ["AsQs KdKh AcAd", "QsJs 9h9d 7s6s"],
    stackBehind: [120, 120], streets: [street([30, 60], [120]), street([20, 40], [80])] },
  { ...base, id: "turn-v2-connected", board: ["Jh", "Th", "9c", "2c"], rangeText: ["AsKs QhKh JcJd", "Qc8c 9h9d AcQc"],
    stackBehind: [80, 130], streets: [street([20, 40], [80], true), street([10, 20], [40], true)] },
].map(validateTurnV2Request));

/**
 * Per-spot solve floor (iterations before a policy may be accepted); others accept at the
 * first qualifying grade. 2026-09-24: after the uncallable-target collapse, paired-short
 * graded 0.125 chip at 256 iterations (inside the 0.25 gate, outside the 0.10 preferred
 * bar the artifact test enforces; 256 is rounding-noisy there), so it runs to 512.
 */
export const TURN_V2_MINIMUM_ITERATIONS: Readonly<Record<string, number>> = Object.freeze({ "turn-v2-paired-short": 512 });

/** Held-out rule cases fixed before acceptance tuning. */
export const TURN_V2_HELD_OUT: readonly TurnV2Request[] = Object.freeze([
  { ...TURN_V2_CORPUS[1], id: "turn-v2-held-short", rangeText: ["AcAd:0.2 AhKd", "AcAd 6s5s:0.7"],
    stackBehind: [17, 5], streets: [street([3, 5, 20], [5, 8, 17], true), street([1, 3, 9], [2, 5, 17], true)] },
  { ...TURN_V2_CORPUS[3], id: "turn-v2-held-asymmetric", rangeText: ["AsQs:0.3 KdKh", "QsJs 9h9d:0.2"],
    stackBehind: [37, 61], streets: [street([7, 37, 80], [10, 14, 61]), street([3, 10, 70], [6, 20, 37])] },
  { ...TURN_V2_CORPUS[2], id: "turn-v2-held-zero", board: ["Kh", "Kd", "7s", "7c"], rangeText: ["AcQd AdQc", "AsJd AhJc"],
    stackBehind: [0, 20], streets: [street([1], [2], true), street([1], [2], true)] },
].map(validateTurnV2Request));
