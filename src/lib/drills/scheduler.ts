// Leitner review queue, per-type stats and the automatic difficulty ramp. All pure: every
// function returns a new state. Time is counted in answered questions ("ticks"), not days.
import type { DrillType, GradeResult, Level, Question } from "./types";

export type Box = 1 | 2 | 3 | 4;
/** Questions until an item in each box is due again. */
export const BOX_GAPS: Readonly<Record<Box, number>> = { 1: 3, 2: 8, 3: 20, 4: 50 };
export const REVIEW_CAP = 200;
export const RECENT_TIMES = 20;
export const PROMOTE_STREAK = 5;
export const PROMOTE_FAST = 3;
export const DEMOTE_MISSES = 2;

export interface ReviewItem {
  readonly id: string;
  readonly type: DrillType;
  readonly seed: number;
  readonly level: Level;
  readonly box: Box;
  readonly dueAt: number;
  readonly lapses: number;
}

export interface TypeStats {
  readonly attempts: number;
  readonly correct: number;
  readonly fast: number;
  /** Most recent correct response times in ms, oldest first. */
  readonly recentMs: readonly number[];
}

export interface Progress {
  readonly level: Level;
  readonly streak: number;
  readonly fastInStreak: number;
  readonly missRun: number;
}

export interface DrillState {
  readonly version: 1;
  readonly tick: number;
  readonly review: readonly ReviewItem[];
  readonly stats: Readonly<Partial<Record<DrillType, TypeStats>>>;
  readonly progress: Readonly<Partial<Record<DrillType, Progress>>>;
  /** Session streak — not persisted. */
  readonly streak: number;
  readonly bestStreak: number;
}

export function initialState(): DrillState {
  return { version: 1, tick: 0, review: [], stats: {}, progress: {}, streak: 0, bestStreak: 0 };
}

export const EMPTY_STATS: TypeStats = { attempts: 0, correct: 0, fast: 0, recentMs: [] };
export const START_PROGRESS: Progress = { level: 1, streak: 0, fastInStreak: 0, missRun: 0 };

export type ReviewEvent = "added" | "relapsed" | "promoted" | "graduated" | "none";

/** A result is a miss for the review queue when it is wrong or slower than twice the target. */
export const isMiss = (result: GradeResult): boolean => !result.correct || result.slow;

export function updateReview(review: readonly ReviewItem[], tick: number, question: Question, result: GradeResult): { review: ReviewItem[]; event: ReviewEvent } {
  const miss = isMiss(result);
  const index = review.findIndex(item => item.id === question.id);
  const next = [...review];
  let event: ReviewEvent = "none";
  if (index >= 0) {
    const item = next[index];
    if (miss) {
      next[index] = { ...item, box: 1, dueAt: tick + BOX_GAPS[1], lapses: item.lapses + 1 };
      event = "relapsed";
    } else if (item.box === 4) {
      next.splice(index, 1);
      event = "graduated";
    } else {
      const box = (item.box + 1) as Box;
      next[index] = { ...item, box, dueAt: tick + BOX_GAPS[box] };
      event = "promoted";
    }
  } else if (miss) {
    next.push({ id: question.id, type: question.type, seed: question.seed, level: question.level, box: 1, dueAt: tick + BOX_GAPS[1], lapses: 1 });
    event = "added";
  }
  return { review: capReview(next), event };
}

/** Drop the highest-box, latest-due items first. */
export function capReview(review: ReviewItem[], cap = REVIEW_CAP): ReviewItem[] {
  if (review.length <= cap) return review;
  const drop = new Set(
    [...review].sort((x, y) => y.box - x.box || y.dueAt - x.dueAt || (x.id < y.id ? 1 : -1))
      .slice(0, review.length - cap).map(item => item.id),
  );
  return review.filter(item => !drop.has(item.id));
}

export function updateStats(stats: TypeStats, result: GradeResult): TypeStats {
  const recentMs = result.correct ? [...stats.recentMs, result.elapsedMs].slice(-RECENT_TIMES) : stats.recentMs;
  return {
    attempts: stats.attempts + 1,
    correct: stats.correct + (result.correct ? 1 : 0),
    fast: stats.fast + (result.fast ? 1 : 0),
    recentMs,
  };
}

export function updateProgress(progress: Progress, result: GradeResult): Progress {
  if (result.correct) {
    const streak = progress.streak + 1;
    const fastInStreak = progress.fastInStreak + (result.fast ? 1 : 0);
    if (streak >= PROMOTE_STREAK && fastInStreak >= PROMOTE_FAST && progress.level < 3) {
      return { level: (progress.level + 1) as Level, streak: 0, fastInStreak: 0, missRun: 0 };
    }
    return { ...progress, streak, fastInStreak, missRun: 0 };
  }
  const missRun = progress.missRun + 1;
  if (missRun >= DEMOTE_MISSES && progress.level > 1) {
    return { level: (progress.level - 1) as Level, streak: 0, fastInStreak: 0, missRun: 0 };
  }
  return { ...progress, streak: 0, fastInStreak: 0, missRun };
}

/** Apply one graded answer. Review questions do not move the difficulty ramp. */
export function applyResult(state: DrillState, question: Question, result: GradeResult, fromReview: boolean): { state: DrillState; event: ReviewEvent } {
  const tick = state.tick + 1;
  const { review, event } = updateReview(state.review, tick, question, result);
  const stats = { ...state.stats, [question.type]: updateStats(state.stats[question.type] ?? EMPTY_STATS, result) };
  const progress = fromReview
    ? state.progress
    : { ...state.progress, [question.type]: updateProgress(state.progress[question.type] ?? START_PROGRESS, result) };
  const streak = result.correct ? state.streak + 1 : 0;
  return {
    state: { ...state, tick, review, stats, progress, streak, bestStreak: Math.max(state.bestStreak, streak) },
    event,
  };
}

export type DrillMode = { readonly kind: "type"; readonly type: DrillType } | { readonly kind: "mixed" } | { readonly kind: "review" };

export type NextPick =
  | { readonly source: "review"; readonly item: ReviewItem }
  | { readonly source: "fresh" }
  | { readonly source: "empty" };

const byDue = (x: ReviewItem, y: ReviewItem) => x.dueAt - y.dueAt || x.box - y.box || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/** Earliest-due matching review item if one is due; otherwise a fresh question. Review mode
 *  serves only due items and is "empty" otherwise, so an item can't be promoted by repeating
 *  it back to back. `lastId` (the question just answered) is never served twice in a row. */
export function pickNext(state: DrillState, mode: DrillMode, lastId?: string): NextPick {
  const due = state.review
    .filter(item => (mode.kind !== "type" || item.type === mode.type) && item.id !== lastId && item.dueAt <= state.tick)
    .sort(byDue);
  if (due.length > 0) return { source: "review", item: due[0] };
  return mode.kind === "review" ? { source: "empty" } : { source: "fresh" };
}

/** Questions until the next review item is due (0 when one is due now), or null when empty. */
export function nextDueIn(state: DrillState): number | null {
  if (state.review.length === 0) return null;
  return Math.max(0, Math.min(...state.review.map(item => item.dueAt)) - state.tick);
}

export function dueCount(state: DrillState): number {
  return state.review.filter(item => item.dueAt <= state.tick).length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
