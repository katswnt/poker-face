// 5- and 7-card hand evaluation.
//
// Previously the app carried TWO evaluators: `evalHand` (named result, used at showdown)
// and `handScore` (numeric, used in the Monte Carlo hot loop). They encoded the same
// ranking twice and had already silently drifted. Both now derive from a single
// `rankCards` core, so they cannot disagree — the property test in test/eval.test.ts
// asserts that ordering is identical for random hands.
import type { CardObj, HandResult } from "./types";
import { cv } from "./cards";

// All C(n,k) subsets — used to pick the best 5 of 7.
export function getCombos(arr: CardObj[], k: number): CardObj[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [f, ...r] = arr;
  return [...getCombos(r, k - 1).map((c: CardObj[]) => [f, ...c]), ...getCombos(r, k)];
}

// Returns the 5 straight values high→low, or false. Handles the wheel (A-2-3-4-5).
export function checkStr(vals: number[]): number[] | false {
  const u = [...new Set(vals)].sort((a, b) => b - a);
  if (u.length < 5) return false;
  for (let i = 0; i <= u.length - 5; i++) { if (u[i] - u[i + 4] === 4) { const s = u.slice(i, i + 5); if (new Set(s).size === 5) return s; } }
  if (u.includes(14) && u.includes(5) && u.includes(4) && u.includes(3) && u.includes(2)) return [5, 4, 3, 2, 1];
  return false;
}

// The single source of truth for hand strength.
//   cat: 0 (high card) … 8 (straight flush / royal)
//   tb:  tiebreak values, most-significant first — compared lexicographically
//   name: display name (the only place royal is distinguished from straight flush)
export function rankCards(cards: CardObj[]): { cat: number; tb: number[]; name: string } {
  const vals = cards.map(cv).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  const counts: Record<number, number> = {};
  vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const groups = Object.entries(counts).map(([v, c]) => ({ val: +v, count: c })).sort((a, b) => b.count - a.count || b.val - a.val);
  const gv = groups.map(g => g.val);
  const isStraight = checkStr(vals);

  if (isFlush && isStraight) {
    const royal = vals.includes(14) && vals.includes(13);
    return { cat: 8, tb: isStraight, name: royal ? "Royal Flush" : "Straight Flush" };
  }
  if (groups[0].count === 4) return { cat: 7, tb: [gv[0], gv[1]], name: "Four of a Kind" };
  if (groups[0].count === 3 && groups[1]?.count === 2) return { cat: 6, tb: [gv[0], gv[1]], name: "Full House" };
  if (isFlush) return { cat: 5, tb: vals, name: "Flush" };
  if (isStraight) return { cat: 4, tb: isStraight, name: "Straight" };
  if (groups[0].count === 3) return { cat: 3, tb: gv, name: "Three of a Kind" };
  if (groups[0].count === 2 && groups[1]?.count === 2) return { cat: 2, tb: [gv[0], gv[1], gv[2]], name: "Two Pair" };
  if (groups[0].count === 2) return { cat: 1, tb: gv, name: "Pair" };
  return { cat: 0, tb: vals, name: "High Card" };
}

export function evalHand(cards: CardObj[]): HandResult {
  const { cat, tb, name } = rankCards(cards);
  // Preserve the historical rank scale where Royal Flush is its own value (9).
  const rank = name === "Royal Flush" ? 9 : cat;
  return { rank, name, kickers: tb };
}

// Numeric score for the head-to-head hot loop. Category dominates; tiebreaks fill lower
// digits. Derived from the same rankCards core as evalHand, so the two never disagree.
export function scoreCards(cards: CardObj[]): number {
  const { cat, tb } = rankCards(cards);
  let score = cat * 100_000_000;
  tb.forEach((t, i) => { score += t * (15 ** (5 - i)); });
  return score;
}

export function cmpK(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}

export function bestHand(hole: CardObj[], board: CardObj[]): HandResult {
  const all = [...hole, ...board];
  if (all.length < 5) return { rank: 0, name: "Incomplete", kickers: [] };
  const combos = getCombos(all, 5);
  let best: HandResult | null = null;
  for (const c of combos) { const e = evalHand(c); if (!best || e.rank > best.rank || (e.rank === best.rank && cmpK(e.kickers, best.kickers) > 0)) { best = e; best.cards = c; } }
  return best!;
}

// Best numeric score over all 5-of-7 combos. Higher = better.
export function handScore(hole: CardObj[], board: CardObj[]): number {
  const all = [...hole, ...board];
  if (all.length < 5) return 0;
  let best = -1;
  for (const c of getCombos(all, 5)) { const s = scoreCards(c); if (s > best) best = s; }
  return best;
}
