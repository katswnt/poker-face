// Shared types for the instant poker math drills. Pure data — no React, no storage.
// Conventions and formulas: tasks/drills-spec.md.
import type { CardObj } from "@/lib/poker/types";

/** The synchronous, exact-arithmetic drills (generated from `(type, seed, level)`). */
export type MathDrillType =
  | "pot-odds"
  | "mdf"
  | "bluff-share"
  | "outs-equity"
  | "outs-count"
  | "combos"
  | "call-or-fold";

/** `solver`: decisions read from the postflop-solver bridge library (async, lazy-loaded). */
export type DrillType = MathDrillType | "solver";

export type Level = 1 | 2 | 3;
export const LEVELS: readonly Level[] = [1, 2, 3];

export interface ChoiceOption { readonly id: string; readonly label: string; }

/** EV-loss bands for solver decisions (thresholds in tasks/drills-spec.md). */
export type DecisionBand = "best" | "mixed" | "inaccuracy" | "mistake" | "blunder";

export interface DecisionGrade {
  readonly band: DecisionBand;
  readonly correct: boolean;
  /** Solver frequency of this action for this hand, 0..1. */
  readonly frequency: number;
  /** From-now EV of the action, chips (null only if the library has none). */
  readonly evChips: number;
  /** EV(best action) − EV(this action), chips, after the quantization tie rule (≥ 0). */
  readonly evLossChips: number;
  /** evLossChips as a percentage of the pot at the node. */
  readonly evLossPctPot: number;
}

export type Answer =
  | { readonly kind: "percent"; readonly value: number; readonly tolerance: number }
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "choice"; readonly value: string; readonly options: readonly ChoiceOption[] }
  /** `value` is the highest-EV action; every option has a grade (correct may be several). */
  | { readonly kind: "decision"; readonly value: string; readonly options: readonly ChoiceOption[];
      readonly grades: Readonly<Record<string, DecisionGrade>> };

export type AnswerKind = Answer["kind"];

export interface Explanation {
  /** The exact formula in words/symbols. */
  readonly formula: string;
  /** The same formula with this question's numbers substituted. */
  readonly plugged: string;
  /** The exact result, formatted. */
  readonly result: string;
  /** The at-table shortcut. */
  readonly shortcut: string;
  /** True when the shortcut is an approximation (always labelled as such in the UI). */
  readonly shortcutApproximate: boolean;
  readonly note?: string;
}

export interface Fact { readonly label: string; readonly value: string; }

export interface Question {
  /** `type:level:seed` (solver: `solver:<review key>`) — also the review-queue id. */
  readonly id: string;
  readonly type: DrillType;
  readonly level: Level;
  readonly seed: number;
  readonly prompt: string;
  readonly facts: readonly Fact[];
  readonly hole?: readonly CardObj[];
  readonly board?: readonly CardObj[];
  readonly answer: Answer;
  readonly speedTargetMs: number;
  readonly explanation: Explanation;
  /** Raw generator parameters, for tests and debugging. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Solver questions: `spotId|path|combo`, stored in the review queue and replayed from it. */
  readonly reviewKey?: string;
  /** Solver questions: structured context and explanation (rendered by the drills page). */
  readonly solver?: SolverDetail;
}

export interface SolverActionRow {
  readonly id: string;
  readonly label: string;
  readonly grade: DecisionGrade;
}

export interface RangeGroup { readonly label: string; readonly share: number; }

export interface PriceRow {
  /** e.g. "Facing 8.42 bb into 12.76 bb" or "If you bet 3.63 bb". */
  readonly label: string;
  readonly potBefore: number;
  readonly bet: number;
  /** bet ÷ (potBefore + 2·bet), 0..1: caller's break-even equity = polar bluff share. */
  readonly potOdds: number;
  /** potBefore ÷ (potBefore + bet), 0..1. */
  readonly mdf: number;
  readonly plugged: string;
}

export interface SolverDetail {
  readonly spotId: string;
  readonly path: string;
  readonly combo: string;
  readonly heroName: string;
  readonly villainName: string;
  readonly street: "flop" | "turn" | "river";
  readonly history: readonly string[];
  readonly potChips: number;
  readonly toCallChips: number;
  readonly stacksChips: readonly [number, number];
  /** Hero's all-in equity against the opponent's reach at this node, 0..1. */
  readonly equity: number | null;
  readonly actions: readonly SolverActionRow[];
  /** Price math: the bet faced, or each bet/raise the hero could make. */
  readonly price: readonly PriceRow[];
  readonly facingBet: boolean;
  /** Opponent's reach-weighted range at the node, hero's cards removed. */
  readonly villainRange: readonly RangeGroup[];
  readonly nodeFrequency: number;
  readonly provenance: string;
}

/** A synchronous question source (the built-in math drills). The solver source is async and
 *  lives in `./solver` (see tasks/drills-spec.md, "Solver-backed decisions"). */
export interface DrillSource {
  readonly type: MathDrillType;
  readonly label: string;
  readonly short: string;
  readonly answerKind: AnswerKind;
  generate(seed: number, level: Level): Question;
}

export interface GradeResult {
  readonly status: "correct" | "wrong";
  readonly correct: boolean;
  /** Parsed user value (percent points / integer) or the chosen option id. */
  readonly given: number | string;
  /** |given − exact| in points, percent answers only. */
  readonly error?: number;
  readonly elapsedMs: number;
  readonly fast: boolean;
  /** Slower than twice the target: treated as a miss by the review queue. */
  readonly slow: boolean;
  /** Decision answers: the band of the chosen action. */
  readonly band?: DecisionBand;
}
