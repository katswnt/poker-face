import { RIVER_DECK, riverComboKey, riverCombosOverlap, riverHandScore, type RiverCard, type RiverCombo } from "../../river/cards";
import { parseConfigurableRiverRange } from "../../river/configurable/range";
import type { ExtensiveFormGame, Weighted } from "../../toy/game";
import { countFlopSkeleton, FLOP_REFERENCE_LIMITS, flopActions, flopInformationKey, initialFlopState,
  nextFlopAction, nextFlopCard, validateFlopRequest, type FlopAction, type FlopRequest, type FlopState } from "./rules";

export type FlopHands = readonly [RiverCombo, RiverCombo];
export type FlopChance = { readonly kind: "deal"; readonly hands: FlopHands } | { readonly kind: "card"; readonly card: RiverCard };
export interface FlopReferenceState { readonly public: FlopState; readonly hands: FlopHands | null }
const key = (hands: FlopHands) => hands.map(riverComboKey).join("/");

export function createFlopReference(input: FlopRequest, stateLimit: number = FLOP_REFERENCE_LIMITS.states) {
  const request = validateFlopRequest(input);
  if (!Number.isSafeInteger(stateLimit) || stateLimit < 1 || stateLimit > FLOP_REFERENCE_LIMITS.states) throw new Error("Invalid flop reference state limit");
  const ranges = request.rangeText.map(text => {
    if (text.length > 2000) throw new Error("Flop reference range exceeds 2000 characters");
    const range = parseConfigurableRiverRange(text, request.board);
    if (range.entries.length > FLOP_REFERENCE_LIMITS.hands) throw new Error("Flop reference exceeds 8 hands/player");
    return range;
  });
  const maxima = ranges.map(r => Math.max(...r.entries.map(e => e.weight)));
  const raw = ranges[0].entries.flatMap(a => ranges[1].entries.flatMap(b => {
    if (riverCombosOverlap(a.cards, b.cards)) return [];
    const weight = a.weight / maxima[0] * (b.weight / maxima[1]);
    if (!(weight > 0)) throw new Error("Flop weight underflow");
    return [{ hands: [a.cards, b.cards] as FlopHands, weight }];
  }));
  if (!raw.length || raw.length > FLOP_REFERENCE_LIMITS.deals) throw new Error("Flop reference needs 1..16 compatible deals");
  const total = raw.reduce((s, row) => s + row.weight, 0);
  const deals: readonly Weighted<Extract<FlopChance, { kind: "deal" }>>[] = Object.freeze(raw.map(({ hands, weight }) => {
    const probability = weight / total;
    if (!(probability > 0)) throw new Error("Flop probability underflow");
    return Object.freeze({ outcome: Object.freeze({ kind: "deal" as const, hands: Object.freeze(hands.map(h => Object.freeze([...h]))) as FlopHands }), probability });
  }));
  const skeleton = countFlopSkeleton(request);
  const preflight = Object.freeze({ compatibleDeals: deals.length, rangeEntries: ranges.map(r => r.entries.length),
    blockedCombos: ranges.map(r => r.blockedComboCount), legalTurnsPerDeal: 45, legalRiversPerTurn: 44,
    orderedRunoutsPerDeal: 1980, dealRunoutPairs: deals.length * 1980, stateLimit,
    totalStates: 1 + deals.length * skeleton.totalStates, chanceNodes: 1 + deals.length * skeleton.chanceNodes,
    decisionNodes: deals.length * skeleton.decisionNodes, terminalNodes: deals.length * skeleton.terminalNodes });
  if (preflight.totalStates > stateLimit) throw new Error(`Flop reference has ${preflight.totalStates} states; limit ${stateLimit}`);
  const byDeal = new Map(deals.map(d => [key(d.outcome.hands), d.outcome.hands]));
  const decks = new Map(deals.map(d => [key(d.outcome.hands), RIVER_DECK.filter(c => !request.board.includes(c) && !d.outcome.hands.some(h => h.includes(c)))]));
  const chanceCache = new Map<string, readonly Weighted<Extract<FlopChance, { kind: "card" }>>[]>();
  const chances = (hands: FlopHands, turn: RiverCard | null) => {
    const id = `${key(hands)}/${turn ?? "-"}`;
    if (!chanceCache.has(id)) chanceCache.set(id, Object.freeze(decks.get(key(hands))!.filter(c => c !== turn).map(card =>
      Object.freeze({ outcome: Object.freeze({ kind: "card" as const, card }), probability: 1 / (turn ? 44 : 45) }))));
    return chanceCache.get(id)!;
  };
  const winners = new Map<string, number>();
  const settlement = (state: FlopReferenceState) => {
    const p = state.public;
    if (!state.hands || p.phase !== "terminal") throw new Error("Cannot settle unfinished flop game");
    const contributions = p.put.map(n => request.committedPerPlayer + n) as [number, number];
    const matched = Math.min(...contributions), returnedUncalled = contributions.map(n => n - matched) as [number, number];
    let sign: number;
    if (p.folded !== null) sign = p.folded === 0 ? -1 : 1;
    else {
      if (!p.turn || !p.river) throw new Error("Flop showdown needs both future cards");
      const id = `${key(state.hands)}/${p.turn}/${p.river}`;
      if (!winners.has(id)) {
        const board = [...request.board, p.turn, p.river];
        winners.set(id, Math.sign(riverHandScore(state.hands[0], board) - riverHandScore(state.hands[1], board)));
      }
      sign = winners.get(id)!;
    }
    const value = sign * matched;
    const utility = [value === 0 ? 0 : value, value === 0 ? 0 : -value] as const;
    return { contributions, returnedUncalled, contestablePot: 2 * matched,
      awards: contributions.map((n, i) => n + utility[i]) as [number, number], utility };
  };
  const game: ExtensiveFormGame<FlopReferenceState, FlopAction, FlopChance> = {
    id: request.id, initialState: () => ({ public: initialFlopState(request), hands: null }),
    node(state) {
      if (!state.hands) return { kind: "chance", outcomes: deals };
      const p = state.public;
      if (p.phase === "card") return { kind: "chance", outcomes: chances(state.hands, p.turn) };
      if (p.phase === "terminal") return { kind: "terminal", utility: settlement(state).utility };
      return { kind: "player", player: p.actor!, actions: flopActions(p) };
    },
    nextChance(state, outcome) {
      if (!state.hands && outcome.kind === "deal") {
        const hands = byDeal.get(key(outcome.hands));
        if (hands) return { public: initialFlopState(request), hands };
      }
      if (state.hands && state.public.phase === "card" && outcome.kind === "card"
        && chances(state.hands, state.public.turn).some(c => c.outcome.card === outcome.card)) {
        return { hands: state.hands, public: nextFlopCard(request, state.public, outcome.card) };
      }
      throw new Error("Invalid or blocked flop chance outcome");
    },
    nextAction(state, action) {
      if (!state.hands) throw new Error("Deal private cards first");
      return { ...state, public: nextFlopAction(request, state.public, action) };
    },
    informationSet(state, player) {
      if (!state.hands) throw new Error("No flop private hand");
      return flopInformationKey(request, state.public, player, state.hands[player]);
    },
  };
  return Object.freeze({ ...game, request, preflight, deals, settlement });
}
export type FlopReference = ReturnType<typeof createFlopReference>;
