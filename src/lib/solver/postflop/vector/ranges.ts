import { RIVER_DECK, riverComboKey, riverHandScore, type RiverCard, type RiverCombo } from "../../river/cards";
import { parseConfigurableRiverRange } from "../../river/configurable/range";
import type { TurnRequest } from "../../turn/game";

export const VECTOR_RANGE_LIMIT = 64;
export interface VectorRange {
  readonly hands: readonly RiverCombo[];
  readonly weights: Float64Array;
  readonly card0: Uint8Array;
  readonly card1: Uint8Array;
  readonly sameOpponent: Int32Array;
  /** Row zero = turn; rows 1..48 = public river. Counts, not strategy reach. */
  readonly compatibleCounts: Uint16Array;
  readonly ranks: Float64Array;
  readonly rankOrders: readonly Int32Array[];
}
export interface VectorRanges {
  readonly players: readonly [VectorRange, VectorRange];
  readonly rivers: readonly RiverCard[];
  readonly riverCardIds: Uint8Array;
  readonly blockedCombos: readonly [number, number];
  readonly compatibleDeals: number;
}

/** O(public cards × hands), with no private-pair or private-pair/runout table. */
export function compileVectorRanges(request: TurnRequest): VectorRanges {
  if (!Array.isArray(request.rangeText) || request.rangeText.length !== 2) throw new Error("Two vector ranges are required");
  const parsed = request.rangeText.map(text => {
    if (typeof text !== "string" || text.length > 16384) throw new Error("Vector range text exceeds 16384 characters");
    const range = parseConfigurableRiverRange(text, request.board);
    if (range.entries.length > VECTOR_RANGE_LIMIT) throw new Error(`Vector range exceeds ${VECTOR_RANGE_LIMIT} combinations`);
    return range;
  });
  const rivers = Object.freeze(RIVER_DECK.filter(card => !request.board.includes(card)));
  const riverCardIds = Uint8Array.from(rivers.map(card => RIVER_DECK.indexOf(card)));
  const players = parsed.map(range => {
    const maximum = Math.max(...range.entries.map(entry => entry.weight));
    const weights = Float64Array.from(range.entries.map(entry => entry.weight / maximum));
    if ([...weights].some(weight => !Number.isFinite(weight) || weight < 1e-12)) {
      throw new Error("Vector relative weights must be at least 1e-12 of the player's largest weight");
    }
    const hands = Object.freeze(range.entries.map(entry => Object.freeze([...entry.cards]) as RiverCombo));
    return { hands, weights, card0: Uint8Array.from(hands.map(hand => RIVER_DECK.indexOf(hand[0]))),
      card1: Uint8Array.from(hands.map(hand => RIVER_DECK.indexOf(hand[1]))),
      sameOpponent: new Int32Array(hands.length).fill(-1), compatibleCounts: new Uint16Array(49 * hands.length),
      ranks: new Float64Array(48 * hands.length), rankOrders: [] as Int32Array[] };
  }) as [VectorRange & { rankOrders: Int32Array[] }, VectorRange & { rankOrders: Int32Array[] }];
  for (const p of [0, 1] as const) {
    const own = players[p], opponent = players[1 - p];
    const byKey = new Map(opponent.hands.map((hand, i) => [riverComboKey(hand), i]));
    own.hands.forEach((hand, i) => { own.sameOpponent[i] = byKey.get(riverComboKey(hand)) ?? -1; });
    for (let river = -1; river < 48; river++) {
      const card = river < 0 ? -1 : riverCardIds[river];
      const countByCard = new Uint16Array(52);
      let total = 0;
      for (let j = 0; j < opponent.hands.length; j++) {
        if (opponent.card0[j] === card || opponent.card1[j] === card) continue;
        total++; countByCard[opponent.card0[j]]++; countByCard[opponent.card1[j]]++;
      }
      const order: number[] = [];
      for (let i = 0; i < own.hands.length; i++) {
        if (own.card0[i] === card || own.card1[i] === card) continue;
        own.compatibleCounts[(river + 1) * own.hands.length + i] = total
          - countByCard[own.card0[i]] - countByCard[own.card1[i]] + (own.sameOpponent[i] >= 0 ? 1 : 0);
        if (river >= 0) {
          own.ranks[river * own.hands.length + i] = riverHandScore(own.hands[i], [...request.board, rivers[river]]);
          order.push(i);
        }
      }
      if (river >= 0) own.rankOrders.push(Int32Array.from(order.sort((a, b) =>
        own.ranks[river * own.hands.length + a] - own.ranks[river * own.hands.length + b] || a - b)));
    }
    Object.freeze(own.rankOrders); Object.freeze(own);
  }
  const compatibleDeals = players[0].compatibleCounts.subarray(0, players[0].hands.length).reduce((a, b) => a + b, 0);
  if (!compatibleDeals) throw new Error("Vector ranges have no compatible private deals");
  const otherCount = players[1].compatibleCounts.subarray(0, players[1].hands.length).reduce((a, b) => a + b, 0);
  if (compatibleDeals !== otherCount) throw new Error("Vector compatible counts disagree");
  return Object.freeze({ players: Object.freeze(players), rivers, riverCardIds,
    blockedCombos: Object.freeze(parsed.map(range => range.blockedComboCount)) as readonly [number, number], compatibleDeals });
}

export function vectorHandIsLive(ranges: VectorRanges, player: 0 | 1, river: number, hand: number): boolean {
  const own = ranges.players[player];
  return own.compatibleCounts[(river + 1) * own.hands.length + hand] > 0;
}
