// Number formatting and tiny combinatorics shared by the drill generators.
import type { CardObj } from "@/lib/poker/types";

/** Big-blind amount: whole numbers without decimals, otherwise one decimal. */
export function fmtBb(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** A percent value (already in points) with one decimal, e.g. `25.0%`. */
export function fmtPct(points: number, digits = 1): string {
  return `${points.toFixed(digits)}%`;
}

/** A difference in percentage points, e.g. `1.6 pts`. */
export function fmtPts(points: number): string {
  return `${points.toFixed(1)} pts`;
}

/** n choose 2. */
export function choose2(n: number): number {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}

/** Hand-notation rank letter (T for ten). */
export function rankLetter(value: number): string {
  return value === 10 ? "T" : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[value] ?? String(value);
}

const RANK_WORDS: Record<number, [string, string]> = {
  2: ["two", "twos"], 3: ["three", "threes"], 4: ["four", "fours"], 5: ["five", "fives"],
  6: ["six", "sixes"], 7: ["seven", "sevens"], 8: ["eight", "eights"], 9: ["nine", "nines"],
  10: ["ten", "tens"], 11: ["jack", "jacks"], 12: ["queen", "queens"], 13: ["king", "kings"], 14: ["ace", "aces"],
};

export function rankWord(value: number, count: number): string {
  const [one, many] = RANK_WORDS[value];
  return count === 1 ? one : many;
}

/** Compact card label such as `K♠` or `10♦` (matches the rest of the app). */
export function cardLabel(card: CardObj): string {
  return card.rank + card.suit;
}
