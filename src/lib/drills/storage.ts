// localStorage persistence for the drills. Every access is wrapped in try/catch; a missing,
// corrupt or throwing store yields a fresh in-memory state and the page keeps working.
import { isDrillType } from "./generators";
import { initialState, type Box, type DrillState, type Progress, type ReviewItem, type TypeStats } from "./scheduler";
import type { DrillType, Level } from "./types";

export const STORAGE_KEY = "poker-face:drills:v1";

type StoreLike = Pick<Storage, "getItem" | "setItem">;

export function browserStorage(): StoreLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNat = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isLevel = (v: unknown): v is Level => v === 1 || v === 2 || v === 3;
const isBox = (v: unknown): v is Box => v === 1 || v === 2 || v === 3 || v === 4;

function readItem(v: unknown): ReviewItem | null {
  if (!isObj(v)) return null;
  const { type, seed, level, box, dueAt, lapses } = v;
  if (!isDrillType(type) || !isNat(seed) || seed > 0xffffffff || !isLevel(level) || !isBox(box) || !isNat(dueAt) || !isNat(lapses)) return null;
  return { id: `${type}:${level}:${seed}`, type, seed, level, box, dueAt, lapses };
}

function readStats(v: unknown): TypeStats | null {
  if (!isObj(v)) return null;
  const { attempts, correct, fast, recentMs } = v;
  if (!isNat(attempts) || !isNat(correct) || !isNat(fast) || !Array.isArray(recentMs) || !recentMs.every(isNat)) return null;
  return { attempts, correct, fast, recentMs: recentMs.slice(-20) };
}

function readProgress(v: unknown): Progress | null {
  if (!isObj(v)) return null;
  const { level, streak, fastInStreak, missRun } = v;
  if (!isLevel(level) || !isNat(streak) || !isNat(fastInStreak) || !isNat(missRun)) return null;
  return { level, streak, fastInStreak, missRun };
}

/** Parse a stored JSON string; anything malformed is dropped field by field. */
export function parseState(raw: string | null): DrillState {
  const fresh = initialState();
  if (!raw) return fresh;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (!isObj(data) || data.version !== 1) return fresh;
  const seen = new Set<string>();
  const review: ReviewItem[] = [];
  for (const entry of Array.isArray(data.review) ? data.review : []) {
    const item = readItem(entry);
    if (item && !seen.has(item.id)) { seen.add(item.id); review.push(item); }
  }
  const stats: Partial<Record<DrillType, TypeStats>> = {};
  const progress: Partial<Record<DrillType, Progress>> = {};
  if (isObj(data.stats)) for (const [k, v] of Object.entries(data.stats)) { const s = readStats(v); if (isDrillType(k) && s) stats[k] = s; }
  if (isObj(data.progress)) for (const [k, v] of Object.entries(data.progress)) { const p = readProgress(v); if (isDrillType(k) && p) progress[k] = p; }
  return {
    ...fresh,
    tick: isNat(data.tick) ? data.tick : 0,
    review,
    stats,
    progress,
    bestStreak: isNat(data.bestStreak) ? data.bestStreak : 0,
  };
}

export function loadState(store: StoreLike | null): DrillState {
  if (!store) return initialState();
  try {
    return parseState(store.getItem(STORAGE_KEY));
  } catch {
    return initialState();
  }
}

/** Returns false when the write failed (quota, privacy mode); the caller keeps its in-memory state. */
export function saveState(store: StoreLike | null, state: DrillState): boolean {
  if (!store) return false;
  const { streak: _streak, ...persisted } = state;
  void _streak;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(persisted));
    return true;
  } catch {
    return false;
  }
}
