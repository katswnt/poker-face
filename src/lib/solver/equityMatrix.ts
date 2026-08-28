// Heads-up all-in equity by Monte Carlo, plus the machinery to build the full 169×169
// canonical equity matrix.
//
// Why the shared fast evaluator (`score7`) instead of eval.ts's reference `handScore`?
// `handScore` allocates all C(7,5)=21 five-card subsets on every call (~30µs). The full
// 169×169 matrix needs ~57M showdown evaluations; at 30µs that is ~29 minutes. `score7`
// evaluates the best 5-of-7 directly with zero allocation (~1µs), turning the matrix build
// into a ~30–60s job. It is NOT an unverified second ranking: test/pushfold.test.ts asserts
// byte-identical scores over 100,000 deterministic random seven-card hands.
import type { CardObj } from "../poker/types";
import { cv, valShort } from "../poker/cards";
import { score7 } from "../poker/score7";

export { score7 } from "../poker/score7";

const SUITS = ["♠", "♥", "♦", "♣"];
// ── Suit-aware dealing ──────────────────────────────────────────────────────────────────
// A hand "shape" derived from a representative combo: which ranks, and whether the two
// cards must be same-suit (suited), different-suit (offsuit), or a pair (two distinct suits).
interface Shape { hi: number; lo: number; kind: "pair" | "suited" | "offsuit"; }

function shapeOf(hand: CardObj[]): Shape {
  const a = cv(hand[0]), b = cv(hand[1]);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (a === b) return { hi, lo, kind: "pair" };
  return { hi, lo, kind: hand[0].suit === hand[1].suit ? "suited" : "offsuit" };
}

// avail: for each value 2..14, a 4-bit mask of still-available suits.
function setBits(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) if (mask & (1 << i)) out.push(i);
  return out;
}

// Deal a hand of the given shape from `avail`, consuming the suits it uses. Returns the two
// concrete cards, or null if the shape can't be realized from what's left (rare exhaustion,
// e.g. AKs vs AKs when the required shared suit is gone). Randomizing suits every trial is
// how the shared-representative-card problem is handled: rather than skipping colliding
// matchups or fixing one arrangement, each trial draws a fresh, valid, collision-free suit
// assignment, so the estimate averages over all suit interactions between the two hands.
function dealShape(shape: Shape, avail: number[], rng: () => number): CardObj[] | null {
  const { hi, lo, kind } = shape;
  const pick = (arr: number[]) => arr[Math.floor(rng() * arr.length)];

  if (kind === "pair") {
    const suits = setBits(avail[hi]);
    if (suits.length < 2) return null;
    const s1 = pick(suits);
    const rest = suits.filter(s => s !== s1);
    const s2 = pick(rest);
    avail[hi] &= ~(1 << s1); avail[hi] &= ~(1 << s2);
    return [{ rank: valShort(hi), suit: SUITS[s1] }, { rank: valShort(lo), suit: SUITS[s2] }];
  }

  if (kind === "suited") {
    const common = setBits(avail[hi] & avail[lo]);
    if (common.length === 0) return null;
    const s = pick(common);
    avail[hi] &= ~(1 << s); avail[lo] &= ~(1 << s);
    return [{ rank: valShort(hi), suit: SUITS[s] }, { rank: valShort(lo), suit: SUITS[s] }];
  }

  // offsuit: different suits for hi and lo.
  const hiSuits = setBits(avail[hi]);
  if (hiSuits.length === 0) return null;
  const sh = pick(hiSuits);
  const loSuits = setBits(avail[lo] & ~(1 << sh));
  if (loSuits.length === 0) return null;
  const sl = pick(loSuits);
  avail[hi] &= ~(1 << sh); avail[lo] &= ~(1 << sl);
  return [{ rank: valShort(hi), suit: SUITS[sh] }, { rank: valShort(lo), suit: SUITS[sl] }];
}

// Heads-up all-in equity of handA vs handB: fraction of random 5-card boards (ties count
// half) on which A's best 7-card hand beats B's. Both hands' suits are re-randomized each
// trial (see dealShape), which both averages over suit interactions and cleanly resolves
// the case where the two representative combos would otherwise share a card.
export function headsUpEquity(
  handA: CardObj[],
  handB: CardObj[],
  sims: number,
  rng: () => number,
): number {
  const shapeA = shapeOf(handA), shapeB = shapeOf(handB);
  let wins = 0;
  const holeA = new Array(2), holeB = new Array(2), board = new Array(5);

  for (let s = 0; s < sims; s++) {
    // Fresh full deck: 4 suits available for every value.
    const avail = new Array(15).fill(0);
    for (let v = 2; v <= 14; v++) avail[v] = 0b1111;

    const a = dealShape(shapeA, avail, rng);
    if (!a) { wins += 0.5; continue; }
    const b = dealShape(shapeB, avail, rng);
    if (!b) { wins += 0.5; continue; }
    holeA[0] = a[0]; holeA[1] = a[1]; holeB[0] = b[0]; holeB[1] = b[1];

    // Remaining deck → pool, then draw 5 distinct board cards via partial Fisher–Yates.
    const pool: CardObj[] = [];
    for (let v = 2; v <= 14; v++) for (const si of setBits(avail[v])) pool.push({ rank: valShort(v), suit: SUITS[si] });
    for (let i = 0; i < 5; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      board[i] = pool[i];
    }

    const scoreA = score7([holeA[0], holeA[1], board[0], board[1], board[2], board[3], board[4]]);
    const scoreB = score7([holeB[0], holeB[1], board[0], board[1], board[2], board[3], board[4]]);
    if (scoreA > scoreB) wins += 1;
    else if (scoreA === scoreB) wins += 0.5;
  }
  return wins / sims;
}
