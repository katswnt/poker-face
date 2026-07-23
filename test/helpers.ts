// Test helpers: build cards from compact notation like "As" "Th" "5c".
import type { CardObj } from "../src/lib/poker/types";

const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RANK: Record<string, string> = { T: "10", J: "J", Q: "Q", K: "K", A: "A" };

// "As" → {rank:"A",suit:"♠"}, "Th" → {rank:"10",suit:"♥"}, "10s" also accepted.
export function card(s: string): CardObj {
  const suitCh = s.slice(-1);
  const rankCh = s.slice(0, -1);
  const rank = RANK[rankCh] ?? rankCh;
  return { rank, suit: SUIT[suitCh] ?? suitCh };
}

export const cards = (...ss: string[]): CardObj[] => ss.map(card);

// A full 52-card deck in compact form, for random sampling in property tests.
export function deckStrings(): string[] {
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const suits = ["s", "h", "d", "c"];
  const out: string[] = [];
  for (const r of ranks) for (const su of suits) out.push(r + su);
  return out;
}
