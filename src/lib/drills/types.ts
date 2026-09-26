// Shared types for the instant poker math drills. Pure data — no React, no storage.
// Conventions and formulas: tasks/drills-spec.md.
import type { CardObj } from "@/lib/poker/types";

export type DrillType =
  | "pot-odds"
  | "mdf"
  | "bluff-share"
  | "outs-equity"
  | "outs-count"
  | "combos"
  | "call-or-fold";

export type Level = 1 | 2 | 3;
export const LEVELS: readonly Level[] = [1, 2, 3];

export interface ChoiceOption { readonly id: string; readonly label: string; }

export type Answer =
  | { readonly kind: "percent"; readonly value: number; readonly tolerance: number }
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "choice"; readonly value: string; readonly options: readonly ChoiceOption[] };

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
  /** `type:level:seed` — also the review-queue id. */
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
}

/** A pluggable question source. The built-in generators implement it synchronously; a
 *  later solver-backed source would add an async `load()` (see tasks/drills-spec.md). */
export interface DrillSource {
  readonly type: DrillType;
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
}
