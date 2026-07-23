// The 169 canonical starting hands for heads-up preflop analysis.
//
// Every Texas Hold'em starting hand collapses, by suit isomorphism, into one of 169
// canonical classes: 13 pocket pairs, 78 suited hands, 78 offsuit hands. Each class is
// weighted by how many concrete 2-card combos it represents:
//   pair    → 6  (C(4,2) suit choices)
//   suited  → 4  (one per suit)
//   offsuit → 12 (4×3 ordered suit choices)
// The six-plus-four-times... totals: 13·6 + 78·4 + 78·12 = 78 + 312 + 936 = 1326 = C(52,2). ✔
//
// The canonical 13×13 grid layout (rows/cols indexed by rank, high→low):
//   diagonal      → pocket pairs
//   upper-right   → suited      (row rank > col rank)
//   lower-left    → offsuit     (row rank < col rank)
// HANDS is the grid flattened row-major, so HANDS[i*13 + j] === GRID[i][j], and that same
// order indexes the rows/cols of the equity matrix.
import type { CardObj } from "../poker/types";
import { valShort } from "../poker/cards";

// Ranks high→low. Values are the numeric ranks used everywhere else (A=14 … 2=2).
export const GRID_RANK_VALUES = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

// Label characters — poker shorthand uses "T" for ten (keeps labels two chars: "T9s").
const LABEL_CHAR: Record<number, string> = {
  14: "A", 13: "K", 12: "Q", 11: "J", 10: "T",
  9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2",
};

export type HandType = "pair" | "suited" | "offsuit";

export interface CanonicalHand {
  label: string;        // "AA", "AKs", "AKo", "72o"
  type: HandType;
  hi: number;           // higher rank value
  lo: number;           // lower rank value (== hi for pairs)
  weight: number;       // combo count: pair 6, suited 4, offsuit 12
  combo: CardObj[];     // a concrete representative 2-card combo
  row: number;          // grid row (0 = A)
  col: number;          // grid col (0 = A)
}

// Concrete representative combos. The specific suits are only a starting point —
// equityMatrix re-randomizes suits per Monte Carlo trial, so representation is unbiased —
// but they give each hand a valid, collision-free 2-card combo for display and sanity use.
function makeCombo(type: HandType, hi: number, lo: number): CardObj[] {
  const hiR = valShort(hi), loR = valShort(lo);
  if (type === "pair") return [{ rank: hiR, suit: "♠" }, { rank: loR, suit: "♥" }];
  if (type === "suited") return [{ rank: hiR, suit: "♠" }, { rank: loR, suit: "♠" }];
  return [{ rank: hiR, suit: "♠" }, { rank: loR, suit: "♥" }]; // offsuit
}

function buildHands(): CanonicalHand[] {
  const hands: CanonicalHand[] = [];
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const rRank = GRID_RANK_VALUES[row];
      const cRank = GRID_RANK_VALUES[col];
      let type: HandType, hi: number, lo: number, label: string, weight: number;
      if (row === col) {
        type = "pair"; hi = lo = rRank; weight = 6;
        label = LABEL_CHAR[hi] + LABEL_CHAR[lo];
      } else if (row < col) {
        // upper-right: suited. Row rank is the higher rank.
        type = "suited"; hi = rRank; lo = cRank; weight = 4;
        label = LABEL_CHAR[hi] + LABEL_CHAR[lo] + "s";
      } else {
        // lower-left: offsuit. Col rank is the higher rank.
        type = "offsuit"; hi = cRank; lo = rRank; weight = 12;
        label = LABEL_CHAR[hi] + LABEL_CHAR[lo] + "o";
      }
      hands.push({ label, type, hi, lo, weight, combo: makeCombo(type, hi, lo), row, col });
    }
  }
  return hands;
}

// The ordered list of all 169 canonical hands (grid row-major).
export const HANDS: CanonicalHand[] = buildHands();

// 13×13 grid of indices into HANDS. GRID[row][col] === row*13 + col.
export const GRID: number[][] = Array.from({ length: 13 }, (_, r) =>
  Array.from({ length: 13 }, (_, c) => r * 13 + c),
);

// label → index into HANDS, for lookups like indexOf("AA") / indexOf("72o").
const LABEL_INDEX: Record<string, number> = {};
HANDS.forEach((h, i) => { LABEL_INDEX[h.label] = i; });
export function handIndex(label: string): number {
  const i = LABEL_INDEX[label];
  if (i === undefined) throw new Error(`unknown hand label: ${label}`);
  return i;
}

export const TOTAL_COMBOS = HANDS.reduce((s, h) => s + h.weight, 0); // 1326
