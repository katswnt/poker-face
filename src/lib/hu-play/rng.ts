/**
 * Seeded deal and draw helpers (spec 2.6). Pure and browser-safe.
 *
 * - The deal is a function of the hand seed alone: (aiHand, humanHand) drawn jointly with
 *   probability ∝ w_AI(h) · w_H(g) over non-conflicting combos, then the turn and river from a
 *   seeded Fisher–Yates shuffle of the remaining deck.
 * - The k-th AI draw is u_k = mulberry32(fnv1a(handSeed, k, nodePath))(), so a draw never depends
 *   on the order solves finish or on how many random numbers anything else consumed.
 */
import { mulberry32 } from "../poker/equity";
import { parseBridgeCombo, type BridgeAction, type BridgeRange } from "../solver/bridge/contract";
import { RIVER_DECK, type RiverCard } from "../solver/river/cards";
import type { ActionDistribution, PrivateDeal } from "./types";

/** FNV-1a, 32-bit. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function decisionDraw(handSeed: number, index: number, path: readonly string[]): number {
  return mulberry32(fnv1a(`hu-draw|${handSeed >>> 0}|${index}|${path.join(",")}`))();
}

function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, u: number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  if (!(total > 0)) throw new Error("Cannot draw from an empty weighted set");
  let target = u * total;
  for (const item of items) {
    target -= weight(item);
    if (target < 0) return item;
  }
  // Floating-point slack: return the last item with positive weight.
  for (let i = items.length - 1; i >= 0; i--) if (weight(items[i]) > 0) return items[i];
  throw new Error("unreachable");
}

/**
 * Deal a hand from a seed. `ranges` are indexed by bridge player (0 = OOP, 1 = IP); the AI gets
 * ranges[aiSeat]. Both ranges must already exclude the flop (BridgeRange does).
 */
export function dealFromSeed(handSeed: number, flop: readonly RiverCard[], ranges: readonly [BridgeRange, BridgeRange],
  aiSeat: 0 | 1): PrivateDeal {
  const rng = mulberry32(fnv1a(`hu-deal|${handSeed >>> 0}`));
  const ai = ranges[aiSeat].combos.map(e => ({ combo: e.combo, cards: parseBridgeCombo(e.combo), weight: e.weight }));
  const human = ranges[1 - aiSeat].combos.map(e => ({ combo: e.combo, cards: parseBridgeCombo(e.combo), weight: e.weight }));
  const overlaps = (a: readonly RiverCard[], b: readonly RiverCard[]) => a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1];
  // Marginal of the AI hand: w_AI(h) × total human weight compatible with h.
  const aiHand = pickWeighted(ai, h => h.weight * human.reduce((s, g) => s + (overlaps(h.cards, g.cards) ? 0 : g.weight), 0), rng());
  const humanHand = pickWeighted(human, g => (overlaps(aiHand.cards, g.cards) ? 0 : g.weight), rng());
  const dead = new Set<RiverCard>([...flop, ...aiHand.cards, ...humanHand.cards]);
  const deck = RIVER_DECK.filter(c => !dead.has(c));
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return { aiHand: aiHand.combo, humanHand: humanHand.combo, runout: [deck[0], deck[1]] };
}

/** Sample an action with the draw u (inverse CDF in the listed order). */
export function sampleAction(strategy: ActionDistribution, u: number): { action: BridgeAction; boundaryDistance: number } {
  if (!(u >= 0 && u < 1)) throw new Error(`Draw ${u} is outside [0, 1)`);
  const total = strategy.reduce((s, e) => s + e.probability, 0);
  if (strategy.length === 0 || strategy.some(e => !(e.probability >= 0)) || Math.abs(total - 1) > 1e-9) {
    throw new Error("Strategy must be a probability distribution");
  }
  let cdf = 0, chosen: BridgeAction | null = null, distance = Infinity;
  for (let i = 0; i < strategy.length; i++) {
    const next = cdf + strategy[i].probability;
    if (i < strategy.length - 1) distance = Math.min(distance, Math.abs(u - next));
    if (chosen === null && strategy[i].probability > 0 && (u < next || i === strategy.length - 1)) chosen = strategy[i].action;
    cdf = next;
  }
  if (chosen === null) chosen = [...strategy].reverse().find(e => e.probability > 0)!.action;
  return { action: chosen, boundaryDistance: distance };
}
