// Parsing and grading. Percent answers are in percentage points; tolerance is inclusive.
import type { AnswerKind, GradeResult, Question } from "./types";

export type Parsed = { readonly ok: true; readonly value: number } | { readonly ok: false };

const NUMBER = /^[+]?(\d+(\.\d*)?|\.\d+)$/;
/** Float slack so "exactly on the tolerance edge" survives binary rounding. */
export const GRADE_EPSILON = 1e-9;

/** Percent: `25`, `25.0`, `25 %`, or a fraction `1/4` (→ 25). Integer: `12` or `12.0`. */
export function parseAnswer(kind: Exclude<AnswerKind, "choice">, raw: string): Parsed {
  const text = raw.trim().replace(/,/g, "");
  if (kind === "percent") {
    const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
    if (fraction) {
      const den = Number(fraction[2]);
      if (den === 0) return { ok: false };
      return finite((Number(fraction[1]) / den) * 100);
    }
    const bare = text.replace(/\s*%$/, "");
    if (!NUMBER.test(bare)) return { ok: false };
    return finite(Number(bare));
  }
  if (!NUMBER.test(text)) return { ok: false };
  return finite(Number(text));
}

function finite(value: number): Parsed {
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/** Returns null for invalid input (blank, non-numeric, unknown option): ask again, don't grade. */
export function grade(question: Question, input: string, elapsedMs: number): GradeResult | null {
  const { answer } = question;
  let correct: boolean;
  let given: number | string;
  let error: number | undefined;
  if (answer.kind === "choice") {
    if (!answer.options.some(o => o.id === input)) return null;
    given = input;
    correct = input === answer.value;
  } else {
    const parsed = parseAnswer(answer.kind, input);
    if (!parsed.ok) return null;
    given = parsed.value;
    if (answer.kind === "percent") {
      error = Math.abs(parsed.value - answer.value);
      correct = error <= answer.tolerance + GRADE_EPSILON;
    } else {
      correct = parsed.value === answer.value;
    }
  }
  const fast = correct && elapsedMs <= question.speedTargetMs;
  const slow = elapsedMs > 2 * question.speedTargetMs;
  return { status: correct ? "correct" : "wrong", correct, given, error, elapsedMs, fast, slow };
}
