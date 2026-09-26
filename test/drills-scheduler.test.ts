import { test } from "node:test";
import assert from "node:assert/strict";
import { generateQuestion } from "../src/lib/drills/generators";
import {
  BOX_GAPS, REVIEW_CAP, applyResult, capReview, initialState, median, nextDueIn, pickNext,
  updateProgress, START_PROGRESS, type DrillState, type ReviewItem,
} from "../src/lib/drills/scheduler";
import { STORAGE_KEY, loadState, parseState, saveState } from "../src/lib/drills/storage";
import type { GradeResult, Question } from "../src/lib/drills/types";

const ok = (fast = true, elapsedMs = 1000): GradeResult =>
  ({ status: "correct", correct: true, given: 0, elapsedMs, fast, slow: false });
const bad = (): GradeResult => ({ status: "wrong", correct: false, given: 0, elapsedMs: 1000, fast: false, slow: false });
const slowRight = (): GradeResult => ({ status: "correct", correct: true, given: 0, elapsedMs: 99_000, fast: false, slow: true });

const q = (seed: number, type: Question["type"] = "pot-odds"): Question => generateQuestion(type, seed, 1);

/** Answer `n` unrelated fresh questions correctly (advances the tick). */
function filler(state: DrillState, n: number): DrillState {
  for (let i = 0; i < n; i++) state = applyResult(state, q(10_000 + i + state.tick), ok(), false).state;
  return state;
}

test("a miss enters box 1, due after the box-1 gap", () => {
  const { state, event } = applyResult(initialState(), q(1), bad(), false);
  assert.equal(event, "added");
  assert.equal(state.tick, 1);
  assert.deepEqual(state.review.map(i => [i.id, i.box, i.dueAt, i.lapses]), [[q(1).id, 1, 1 + BOX_GAPS[1], 1]]);
  assert.equal(pickNext(state, { kind: "mixed" }).source, "fresh", "not due yet");
  const later = filler(state, BOX_GAPS[1] - 1);
  assert.equal(later.tick, 1 + BOX_GAPS[1] - 1);
  assert.equal(pickNext(later, { kind: "mixed" }).source, "fresh", "still one short");
  const due = filler(later, 1);
  const pick = pickNext(due, { kind: "mixed" });
  assert.equal(pick.source, "review");
  if (pick.source === "review") assert.equal(pick.item.id, q(1).id);
});

test("a correct answer on a fresh question adds nothing; a slow correct answer counts as a miss", () => {
  assert.equal(applyResult(initialState(), q(2), ok(), false).state.review.length, 0);
  const { state, event } = applyResult(initialState(), q(2), slowRight(), false);
  assert.equal(event, "added");
  assert.equal(state.review.length, 1);
});

test("correct reviews climb the boxes and graduate out of box 4; a miss sends the item back to box 1", () => {
  let state = applyResult(initialState(), q(3), bad(), false).state;
  for (const expected of [2, 3, 4] as const) {
    const r = applyResult(state, q(3), ok(), true);
    assert.equal(r.event, "promoted");
    state = r.state;
    const item = state.review.find(i => i.id === q(3).id)!;
    assert.equal(item.box, expected);
    assert.equal(item.dueAt, state.tick + BOX_GAPS[expected]);
  }
  const relapse = applyResult(state, q(3), bad(), true);
  assert.equal(relapse.event, "relapsed");
  const item = relapse.state.review[0];
  assert.equal(item.box, 1);
  assert.equal(item.lapses, 2);
  // Back up to 4 and graduate.
  state = relapse.state;
  for (let i = 0; i < 3; i++) state = applyResult(state, q(3), ok(), true).state;
  const grad = applyResult(state, q(3), ok(), true);
  assert.equal(grad.event, "graduated");
  assert.equal(grad.state.review.length, 0);
});

test("due items are served earliest-due first, then lowest box, then id; type mode filters", () => {
  const items: ReviewItem[] = [
    { id: "mdf:1:5", type: "mdf", seed: 5, level: 1, box: 2, dueAt: 4, lapses: 1 },
    { id: "pot-odds:1:9", type: "pot-odds", seed: 9, level: 1, box: 3, dueAt: 2, lapses: 1 },
    { id: "pot-odds:1:1", type: "pot-odds", seed: 1, level: 1, box: 1, dueAt: 2, lapses: 1 },
    { id: "combos:1:7", type: "combos", seed: 7, level: 1, box: 1, dueAt: 50, lapses: 1 },
  ];
  const state: DrillState = { ...initialState(), tick: 10, review: items };
  const mixed = pickNext(state, { kind: "mixed" });
  assert.equal(mixed.source === "review" && mixed.item.id, "pot-odds:1:1");
  const onlyMdf = pickNext(state, { kind: "type", type: "mdf" });
  assert.equal(onlyMdf.source === "review" && onlyMdf.item.id, "mdf:1:5");
  assert.equal(pickNext(state, { kind: "type", type: "outs-count" }).source, "fresh");
  // The question just answered is never served twice in a row.
  const skip = pickNext(state, { kind: "mixed" }, "pot-odds:1:1");
  assert.ok(skip.source === "review" && skip.item.id === "pot-odds:1:9");
  // Review mode serves due items only; nothing due → empty (never early repeats).
  const review = pickNext(state, { kind: "review" });
  assert.ok(review.source === "review" && review.item.id === "pot-odds:1:1");
  const notDue: DrillState = { ...state, tick: 0 };
  assert.equal(pickNext(notDue, { kind: "review" }).source, "empty");
  assert.equal(pickNext(notDue, { kind: "mixed" }).source, "fresh");
  assert.equal(nextDueIn(notDue), 2);
  assert.equal(nextDueIn(state), 0);
  assert.equal(nextDueIn(initialState()), null);
  assert.equal(pickNext(initialState(), { kind: "review" }).source, "empty");
});

test("the queue is capped, dropping highest-box latest-due items first", () => {
  const many: ReviewItem[] = Array.from({ length: REVIEW_CAP + 3 }, (_, i) => ({
    id: `mdf:1:${i}`, type: "mdf", seed: i, level: 1, box: (i < 3 ? 4 : 1) as 1 | 4, dueAt: i, lapses: 1,
  }));
  const capped = capReview(many);
  assert.equal(capped.length, REVIEW_CAP);
  assert.ok(capped.every(i => i.box === 1), "the three box-4 items were dropped");
});

test("difficulty ramp: promote after 5 correct with 3 fast; demote after 2 misses; clamp to 1..3", () => {
  let p = START_PROGRESS;
  for (let i = 0; i < 4; i++) p = updateProgress(p, ok(true));
  assert.equal(p.level, 1);
  p = updateProgress(p, ok(false));
  assert.equal(p.level, 2, "five correct, four fast");
  let slowP = START_PROGRESS;
  for (let i = 0; i < 5; i++) slowP = updateProgress(slowP, ok(i < 2));
  assert.equal(slowP.level, 1, "only two fast → no promotion yet");
  p = updateProgress(p, bad());
  assert.equal(p.level, 2);
  p = updateProgress(p, bad());
  assert.equal(p.level, 1);
  p = updateProgress(updateProgress(p, bad()), bad());
  assert.equal(p.level, 1, "never below 1");
  let top = { ...START_PROGRESS, level: 3 as const };
  for (let i = 0; i < 10; i++) top = updateProgress(top, ok(true)) as typeof top;
  assert.equal(top.level, 3, "never above 3");
});

test("review answers do not move the ramp; stats, streaks and best streak update", () => {
  let state = initialState();
  state = applyResult(state, q(1), ok(true, 2000), false).state;
  state = applyResult(state, q(2), ok(true, 4000), false).state;
  state = applyResult(state, q(3), ok(false, 3000), true).state;
  assert.equal(state.progress["pot-odds"]?.streak, 2, "review answer ignored by the ramp");
  assert.equal(state.streak, 3);
  assert.equal(state.bestStreak, 3);
  state = applyResult(state, q(4), bad(), false).state;
  assert.equal(state.streak, 0);
  assert.equal(state.bestStreak, 3);
  const stats = state.stats["pot-odds"]!;
  assert.deepEqual([stats.attempts, stats.correct, stats.fast], [4, 3, 2]);
  assert.deepEqual(stats.recentMs, [2000, 4000, 3000]);
  assert.equal(median(stats.recentMs), 3000);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

// ---------------------------------------------------------------------------------------------
// Storage

class MemoryStore {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

test("state round-trips through storage without the session streak", () => {
  let state = applyResult(initialState(), q(1), bad(), false).state;
  state = applyResult(state, q(2), ok(), false).state;
  const store = new MemoryStore();
  assert.equal(saveState(store, state), true);
  assert.ok(store.data.has(STORAGE_KEY));
  const loaded = loadState(store);
  assert.deepEqual(loaded, { ...state, streak: 0 });
});

test("missing, corrupt or throwing storage yields a fresh state", () => {
  assert.deepEqual(loadState(null), initialState());
  assert.deepEqual(loadState(new MemoryStore()), initialState());
  const corrupt = new MemoryStore();
  corrupt.setItem(STORAGE_KEY, "{not json");
  assert.deepEqual(loadState(corrupt), initialState());
  const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
  assert.deepEqual(loadState(throwing), initialState());
  assert.equal(saveState(throwing, initialState()), false);
  assert.equal(saveState(null, initialState()), false);
  assert.deepEqual(parseState(JSON.stringify({ version: 2, tick: 5 })), initialState(), "unknown version");
});

test("malformed fields are dropped one by one", () => {
  const raw = JSON.stringify({
    version: 1, tick: 12, bestStreak: -1,
    review: [
      { type: "mdf", seed: 5, level: 1, box: 2, dueAt: 4, lapses: 1 },
      { type: "mdf", seed: 5, level: 1, box: 2, dueAt: 4, lapses: 1 }, // duplicate
      { type: "nope", seed: 5, level: 1, box: 2, dueAt: 4, lapses: 1 },
      { type: "mdf", seed: 6, level: 4, box: 2, dueAt: 4, lapses: 1 },
      { type: "mdf", seed: 7, level: 1, box: 9, dueAt: 4, lapses: 1 },
      "junk",
    ],
    stats: { mdf: { attempts: 3, correct: 2, fast: 1, recentMs: [100, 200] }, "pot-odds": { attempts: "x" }, bogus: {} },
    progress: { mdf: { level: 2, streak: 1, fastInStreak: 0, missRun: 0 }, combos: { level: 7 } },
  });
  const state = parseState(raw);
  assert.equal(state.tick, 12);
  assert.equal(state.bestStreak, 0);
  assert.deepEqual(state.review.map(i => i.id), ["mdf:1:5"]);
  assert.deepEqual(Object.keys(state.stats), ["mdf"]);
  assert.deepEqual(Object.keys(state.progress), ["mdf"]);
});
