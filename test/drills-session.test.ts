import { test } from "node:test";
import assert from "node:assert/strict";
import { DRILL_TYPES } from "../src/lib/drills/generators";
import { BOX_GAPS, initialState } from "../src/lib/drills/scheduler";
import { advance, changeLevel, changeMode, startSession, submit, type Session } from "../src/lib/drills/session";
import type { Question } from "../src/lib/drills/types";

const rightAnswer = (q: Question): string =>
  q.answer.kind === "choice" ? q.answer.value : String(q.answer.value);
const wrongAnswer = (q: Question): string =>
  q.answer.kind === "choice" ? (q.answer.value === "call" ? "fold" : "call") : String(q.answer.value + 50);

test("the same session seed replays the same questions", () => {
  const run = () => {
    let s = startSession(initialState(), 1234, { kind: "mixed" }, "auto", 0);
    const ids: string[] = [];
    for (let i = 0; i < 15; i++) { ids.push(s.question!.id); s = advance(submit(s, rightAnswer(s.question!), 1000), 1000); }
    return ids;
  };
  assert.deepEqual(run(), run());
});

test("mixed mode reaches every drill type; a type mode stays on its type", () => {
  let s = startSession(initialState(), 99, { kind: "mixed" }, "auto", 0);
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) { seen.add(s.question!.type); s = advance(submit(s, rightAnswer(s.question!), 500), 500); }
  assert.deepEqual([...seen].sort(), [...DRILL_TYPES].sort());
  let t = changeMode(s, { kind: "type", type: "combos" }, 0);
  for (let i = 0; i < 10; i++) { assert.equal(t.question!.type, "combos"); t = advance(submit(t, rightAnswer(t.question!), 500), 500); }
});

test("invalid input neither grades nor advances the clock-tick", () => {
  const s = startSession(initialState(), 5, { kind: "type", type: "pot-odds" }, 1, 0);
  const after = submit(s, "banana", 2000);
  assert.equal(after.invalid, true);
  assert.equal(after.result, null);
  assert.equal(after.state.tick, 0);
  const graded = submit(after, rightAnswer(s.question!), 3000);
  assert.equal(graded.result?.correct, true);
  assert.equal(graded.result?.elapsedMs, 3000, "timer measured from when the question was shown");
  assert.equal(submit(graded, "1", 4000), graded, "a graded question can't be re-submitted");
});

test("a missed question comes back after the box-1 gap, flagged as review", () => {
  let s: Session = startSession(initialState(), 7, { kind: "type", type: "mdf" }, 2, 0);
  const missed = s.question!;
  s = advance(submit(s, wrongAnswer(missed), 1000), 1000);
  assert.equal(s.state.review.length, 1);
  for (let i = 0; i < BOX_GAPS[1]; i++) {
    assert.notEqual(s.question!.id, missed.id);
    s = advance(submit(s, rightAnswer(s.question!), 1000), 1000);
  }
  assert.equal(s.question!.id, missed.id);
  assert.equal(s.fromReview, true);
  assert.deepEqual(s.question, missed, "regenerated identically from (type, seed, level)");
});

test("review mode with an empty queue shows no question; pinned level is honoured", () => {
  const empty = startSession(initialState(), 1, { kind: "review" }, "auto", 0);
  assert.equal(empty.question, null);
  const pinned = changeLevel(changeMode(empty, { kind: "type", type: "outs-equity" }, 0), 3, 0);
  assert.equal(pinned.question!.level, 3);
});
