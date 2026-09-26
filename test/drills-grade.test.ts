import { test } from "node:test";
import assert from "node:assert/strict";
import { generateQuestion } from "../src/lib/drills/generators";
import { grade, parseAnswer } from "../src/lib/drills/grade";
import type { Question } from "../src/lib/drills/types";

/** A percent question with a known answer (pot 100, bet 50 → 25%). */
function percentQuestion(value = 25, tolerance = 1, speedTargetMs = 6000): Question {
  const base = generateQuestion("pot-odds", 1, 1);
  return { ...base, answer: { kind: "percent", value, tolerance }, speedTargetMs };
}

test("parses percent answers: plain, decimal, percent sign, fraction", () => {
  assert.deepEqual(parseAnswer("percent", "25"), { ok: true, value: 25 });
  assert.deepEqual(parseAnswer("percent", " 25.5 "), { ok: true, value: 25.5 });
  assert.deepEqual(parseAnswer("percent", "25%"), { ok: true, value: 25 });
  assert.deepEqual(parseAnswer("percent", "25 %"), { ok: true, value: 25 });
  assert.deepEqual(parseAnswer("percent", ".5"), { ok: true, value: 0.5 });
  assert.deepEqual(parseAnswer("percent", "1/4"), { ok: true, value: 25 });
  const third = parseAnswer("percent", "1 / 3");
  assert.ok(third.ok && Math.abs(third.value - 100 / 3) < 1e-12);
});

test("rejects invalid input instead of grading it", () => {
  for (const raw of ["", "  ", "abc", "1/0", "-5", "25%%", "2..5", "1e3", "Infinity", "25 pts"]) {
    assert.deepEqual(parseAnswer("percent", raw), { ok: false }, raw);
  }
  for (const raw of ["", "x", "3/4", "12%"]) assert.deepEqual(parseAnswer("integer", raw), { ok: false }, raw);
  assert.equal(grade(percentQuestion(), "", 1000), null);
  assert.equal(grade(generateQuestion("call-or-fold", 1, 1), "raise", 1000), null);
});

test("percent tolerance is inclusive at exactly ±tolerance and exclusive just outside", () => {
  const q = percentQuestion(25, 1);
  assert.equal(grade(q, "26", 1000)?.correct, true, "+1.0 on the edge");
  assert.equal(grade(q, "24", 1000)?.correct, true, "−1.0 on the edge");
  assert.equal(grade(q, "26.01", 1000)?.correct, false, "just outside above");
  assert.equal(grade(q, "23.99", 1000)?.correct, false, "just outside below");
  // Binary-rounding edge: 2.2 − 1.2 = 1.0000000000000002 in floating point; still on the edge.
  const edge = percentQuestion(1.2, 1);
  assert.ok(2.2 - 1.2 > 1, "the float difference really does exceed 1");
  assert.equal(grade(edge, "2.2", 1000)?.correct, true);
  assert.equal(grade(percentQuestion(100 / 3, 1), "1/3", 1000)?.correct, true, "fraction input");
  const result = grade(q, "25.4", 1000)!;
  assert.ok(Math.abs(result.error! - 0.4) < 1e-12);
});

test("outs-equity uses the wider ±2 pt tolerance", () => {
  const q = generateQuestion("outs-equity", 3, 1);
  assert.equal(q.answer.kind, "percent");
  if (q.answer.kind !== "percent") return;
  assert.equal(q.answer.tolerance, 2);
  assert.equal(grade(q, String(q.answer.value + 2), 1000)?.correct, true);
  assert.equal(grade(q, String(q.answer.value + 2.05), 1000)?.correct, false);
});

test("integer answers must match exactly", () => {
  const q = generateQuestion("combos", 5, 1);
  assert.equal(q.answer.kind, "integer");
  const exact = q.answer.value as number;
  assert.equal(grade(q, String(exact), 1000)?.correct, true);
  assert.equal(grade(q, `${exact}.0`, 1000)?.correct, true);
  assert.equal(grade(q, String(exact + 1), 1000)?.correct, false);
  assert.equal(grade(q, `${exact}.5`, 1000)?.correct, false);
});

test("choice answers grade by option id", () => {
  const q = generateQuestion("call-or-fold", 9, 2);
  assert.equal(q.answer.kind, "choice");
  const right = q.answer.value as string;
  const wrong = right === "call" ? "fold" : "call";
  assert.equal(grade(q, right, 1000)?.correct, true);
  assert.equal(grade(q, wrong, 1000)?.correct, false);
});

test("fast needs correct and within target; slow is beyond twice the target", () => {
  const q = percentQuestion(25, 1, 6000);
  assert.equal(grade(q, "25", 6000)?.fast, true, "exactly on target counts as fast");
  assert.equal(grade(q, "25", 6001)?.fast, false);
  assert.equal(grade(q, "40", 100)?.fast, false, "a fast wrong answer is not fast");
  assert.equal(grade(q, "25", 12000)?.slow, false);
  assert.equal(grade(q, "25", 12001)?.slow, true);
});
