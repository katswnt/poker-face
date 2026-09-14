import { score7 } from "../../poker/score7";
import type { CardObj } from "../../poker/types";

export const RIVER_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const RIVER_SUITS = ["c", "d", "h", "s"] as const;
export type RiverRank = (typeof RIVER_RANKS)[number];
export type RiverSuit = (typeof RIVER_SUITS)[number];
export type RiverCard = `${RiverRank}${RiverSuit}`;
export type RiverCombo = readonly [RiverCard, RiverCard];

const SUIT_SYMBOL: Readonly<Record<RiverSuit, string>> = {
  c: "♣",
  d: "♦",
  h: "♥",
  s: "♠",
};

export const RIVER_DECK: readonly RiverCard[] = RIVER_RANKS.flatMap(rank =>
  RIVER_SUITS.map(suit => `${rank}${suit}` as RiverCard),
);

const CARD_INDEX = new Map(RIVER_DECK.map((card, index) => [card, index]));

export function isRiverCard(value: unknown): value is RiverCard {
  return typeof value === "string" && CARD_INDEX.has(value as RiverCard);
}

export function assertRiverCard(value: unknown): asserts value is RiverCard {
  if (!isRiverCard(value)) throw new Error(`Invalid river card ${String(value)}`);
}

export function canonicalRiverCombo(cards: readonly [RiverCard, RiverCard]): RiverCombo {
  assertRiverCard(cards[0]);
  assertRiverCard(cards[1]);
  if (cards[0] === cards[1]) throw new Error(`A river combo repeats ${cards[0]}`);
  return CARD_INDEX.get(cards[0])! > CARD_INDEX.get(cards[1])!
    ? [cards[0], cards[1]]
    : [cards[1], cards[0]];
}

export function parseRiverCombo(value: string): RiverCombo {
  if (value.length !== 4) throw new Error(`Invalid river combo ${value}`);
  const left = value.slice(0, 2);
  const right = value.slice(2, 4);
  assertRiverCard(left);
  assertRiverCard(right);
  return canonicalRiverCombo([left, right]);
}

export function riverComboKey(cards: RiverCombo): string {
  return canonicalRiverCombo(cards).join("");
}

export function riverCardObject(card: RiverCard): CardObj {
  assertRiverCard(card);
  const rank = card[0] === "T" ? "10" : card[0];
  const suit = card[1] as RiverSuit;
  return { rank, suit: SUIT_SYMBOL[suit] };
}

export function riverHandScore(combo: RiverCombo, board: readonly RiverCard[]): number {
  if (board.length !== 5) throw new Error(`A river board needs five cards; received ${board.length}`);
  return score7([...canonicalRiverCombo(combo), ...board].map(riverCardObject));
}

export function riverCombosOverlap(left: RiverCombo, right: RiverCombo): boolean {
  return left.some(card => right.includes(card));
}

export function assertDistinctRiverCards(cards: readonly RiverCard[], label: string): void {
  cards.forEach(assertRiverCard);
  if (new Set(cards).size !== cards.length) throw new Error(`${label} contains duplicate cards`);
}
