// Fast best-five-of-seven evaluator. This uses the same numeric encoding as `handScore`
// in eval.ts, but avoids building all 21 five-card subsets. The slow evaluator remains
// the independent reference used by the 100,000-hand equivalence test.
import type { CardObj } from "./types";
import { cv } from "./cards";

const SUIT_IDX: Record<string, number> = { "♠": 0, "♥": 1, "♦": 2, "♣": 3 };

function straightValues(present: boolean[]): number[] | null {
  for (let high = 14; high >= 5; high--) {
    if (present[high] && present[high - 1] && present[high - 2] && present[high - 3] && present[high - 4]) {
      return [high, high - 1, high - 2, high - 3, high - 4];
    }
  }
  if (present[14] && present[5] && present[4] && present[3] && present[2]) return [5, 4, 3, 2, 1];
  return null;
}

function encode(category: number, tieBreakers: number[]): number {
  let score = category * 100_000_000;
  for (let i = 0; i < tieBreakers.length; i++) score += tieBreakers[i] * 15 ** (5 - i);
  return score;
}

export function score7(cards: CardObj[]): number {
  if (cards.length !== 7) throw new Error(`score7 requires exactly seven cards; received ${cards.length}`);
  const rankCount = new Array(15).fill(0);
  const suitCount = [0, 0, 0, 0];
  const suitValues: number[][] = [[], [], [], []];
  const present = new Array(15).fill(false);
  for (const card of cards) {
    const value = cv(card);
    const suit = SUIT_IDX[card.suit];
    rankCount[value]++;
    present[value] = true;
    suitCount[suit]++;
    suitValues[suit].push(value);
  }

  let flushSuit = -1;
  for (let suit = 0; suit < 4; suit++) {
    if (suitCount[suit] >= 5) { flushSuit = suit; break; }
  }

  if (flushSuit >= 0) {
    const flushPresence = new Array(15).fill(false);
    for (const value of suitValues[flushSuit]) flushPresence[value] = true;
    const straightFlush = straightValues(flushPresence);
    if (straightFlush) return encode(8, straightFlush);
  }

  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let value = 14; value >= 2; value--) {
    const count = rankCount[value];
    if (count === 4) quads.push(value);
    else if (count === 3) trips.push(value);
    else if (count === 2) pairs.push(value);
  }

  if (quads.length) {
    const quad = quads[0];
    let kicker = 0;
    for (let value = 14; value >= 2; value--) {
      if (value !== quad && rankCount[value] > 0) { kicker = value; break; }
    }
    return encode(7, [quad, kicker]);
  }

  if (trips.length) {
    const trip = trips[0];
    let pair = -1;
    if (trips.length >= 2) pair = Math.max(pair, trips[1]);
    if (pairs.length) pair = Math.max(pair, pairs[0]);
    if (pair > 0) return encode(6, [trip, pair]);
  }

  if (flushSuit >= 0) {
    return encode(5, suitValues[flushSuit].slice().sort((a, b) => b - a).slice(0, 5));
  }

  const straight = straightValues(present);
  if (straight) return encode(4, straight);

  if (trips.length) {
    const trip = trips[0];
    const kickers: number[] = [];
    for (let value = 14; value >= 2 && kickers.length < 2; value--) {
      if (value !== trip && rankCount[value] > 0) kickers.push(value);
    }
    return encode(3, [trip, ...kickers]);
  }

  if (pairs.length >= 2) {
    const highPair = pairs[0];
    const lowPair = pairs[1];
    let kicker = 0;
    for (let value = 14; value >= 2; value--) {
      if (value !== highPair && value !== lowPair && rankCount[value] > 0) { kicker = value; break; }
    }
    return encode(2, [highPair, lowPair, kicker]);
  }

  if (pairs.length) {
    const pair = pairs[0];
    const kickers: number[] = [];
    for (let value = 14; value >= 2 && kickers.length < 3; value--) {
      if (value !== pair && rankCount[value] > 0) kickers.push(value);
    }
    return encode(1, [pair, ...kickers]);
  }

  const highCards: number[] = [];
  for (let value = 14; value >= 2 && highCards.length < 5; value--) {
    if (rankCount[value] > 0) highCards.push(value);
  }
  return encode(0, highCards);
}
