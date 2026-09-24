// Concrete two-card combos and the card-removal weights between canonical hand classes.
//
// Every one of the C(52,2) = 1,326 concrete starting hands belongs to exactly one of the 169
// canonical classes in hands.ts. When two players are dealt from the same deck, their hands
// cannot share a card, so the joint distribution of (player-1 class, player-2 class) is NOT
// weight[A]·weight[B]: it is the number of ORDERED, card-disjoint combo pairs (a ∈ A, b ∈ B).
// That count matrix is what the push/fold solver weights ranges by, and it is the same
// averaging measure the exact equity matrix uses (uniform over disjoint combo pairs).
//
// Σ over all cells = 1,326 · 1,225 = 1,624,350 ordered disjoint pairs (the second hand is
// dealt from the 50 remaining cards: C(50,2) = 1,225).
import type { CardObj } from "../poker/types";
import { valShort } from "../poker/cards";

const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"];

/** Card index 0..51: (value − 2)·4 + suit, value 2..14, suit 0..3. */
export const cardValue = (card: number) => (card >> 2) + 2;
export const cardSuit = (card: number) => card & 3;

/** The 52 cards as CardObj, indexed by card index (for score7). */
export const CARD_OBJECTS: CardObj[] = Array.from({ length: 52 }, (_, c) => ({
  rank: valShort(cardValue(c)),
  suit: SUIT_SYMBOLS[cardSuit(c)],
}));

/** Canonical class index (row-major 13×13 grid, same order as HANDS) of two card indices. */
export function classOfCards(c1: number, c2: number): number {
  const v1 = cardValue(c1), v2 = cardValue(c2);
  const hi = Math.max(v1, v2), lo = Math.min(v1, v2);
  const rHi = 14 - hi, rLo = 14 - lo; // grid row/col: 0 = A … 12 = 2
  if (hi === lo) return rHi * 13 + rHi;
  if (cardSuit(c1) === cardSuit(c2)) return rHi * 13 + rLo; // suited: upper-right
  return rLo * 13 + rHi;                                     // offsuit: lower-left
}

export interface Combo { c1: number; c2: number; cls: number; }

/** All 1,326 combos, c1 < c2, in lexicographic card-index order. */
export const COMBOS: Combo[] = (() => {
  const out: Combo[] = [];
  for (let c1 = 0; c1 < 52; c1++) for (let c2 = c1 + 1; c2 < 52; c2++) out.push({ c1, c2, cls: classOfCards(c1, c2) });
  return out;
})();

export const NUM_CLASSES = 169;
export const ORDERED_DISJOINT_PAIRS = 1326 * 1225; // 1,624,350

/**
 * DISJOINT[a][b] = number of ordered pairs (combo in class a, combo in class b) that share no
 * card. Symmetric; each row sums to weight[a] · 1,225.
 */
export const DISJOINT: number[][] = (() => {
  const m = Array.from({ length: NUM_CLASSES }, () => new Array<number>(NUM_CLASSES).fill(0));
  for (const x of COMBOS) {
    for (const y of COMBOS) {
      if (x.c1 === y.c1 || x.c1 === y.c2 || x.c2 === y.c1 || x.c2 === y.c2) continue;
      m[x.cls][y.cls]++;
    }
  }
  return m;
})();
