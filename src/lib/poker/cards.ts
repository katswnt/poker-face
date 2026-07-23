// Card constants, the deck, and small formatting helpers. No UI, no React.
import type { CardObj } from "./types";

export const SUITS = ["♠", "♥", "♦", "♣"];
export const SUIT_NAMES: Record<string, string> = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const RV: Record<string, number> = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
export const RN: Record<number, string> = { 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten", 11: "Jack", 12: "Queen", 13: "King", 14: "Ace" };
export const RNL: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "jack", 12: "queen", 13: "king", 14: "ace" };
export const RS: Record<number, string> = { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };

// Small/big blind — the only stakes in the game.
export const SB = 5, BB = 10;

export const makeDeck = (): CardObj[] => {
  const d: CardObj[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d;
};

// Fisher–Yates. Uses Math.random by default; the deal is not part of the deterministic
// simulation seam (only the Monte Carlo re-runs need to be reproducible — see equity.ts).
export const shuffle = (a: CardObj[], rng: () => number = Math.random): CardObj[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};

export const ck = (c: CardObj) => c.rank + c.suit;        // unique card key
export const cv = (c: CardObj) => RV[c.rank];             // numeric rank value
export const cardStr = (c: CardObj) => c.rank + " " + c.suit;
export const valName = (v: number) => RN[v] || String(v);
export const valNameL = (v: number) => RNL[v] || String(v);
export const valShort = (v: number) => RS[v] || String(v);
