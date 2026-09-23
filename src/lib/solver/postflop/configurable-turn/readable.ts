import { RIVER_DECK, riverComboKey, riverHandScore, type RiverCombo, type RiverCard } from "../../river/cards";
import type { ExtensiveFormGame, Weighted } from "../../toy/game";
import { compileVectorRanges } from "../vector/ranges";
import { preflightTurnV2 } from "./game";
import { initialTurnV2State, nextTurnV2Action, nextTurnV2River, turnV2Actions, turnV2InformationKey,
  validateTurnV2Request, type TurnV2Action, type TurnV2State } from "./rules";

type Hands = readonly [RiverCombo, RiverCombo];
type Chance = { readonly kind: "deal"; readonly hands: Hands } | { readonly kind: "river"; readonly card: RiverCard };
export type ReadableTurnV2State = { readonly public: TurnV2State; readonly hands: Hands | null };
/** Small repeated-state adapter, not the production compiler or a second money oracle. */
export function createReadableTurnV2(input: unknown) {
  const request = validateTurnV2Request(input), preflight = preflightTurnV2(request);
  if (preflight.rangeEntries.some(n => n > 8) || preflight.compatibleDeals > 16 || preflight.totalStates > 100_000) {
    throw new Error("Readable turn v2 exceeds 8 combinations/player, 16 deals or 100,000 states");
  }
  const ranges = compileVectorRanges(request), raw: { hands: Hands; weight: number }[] = [];
  for (const [i, a] of ranges.players[0].hands.entries()) for (const [j, b] of ranges.players[1].hands.entries()) {
    if (!a.some(card => b.includes(card))) raw.push({ hands: [a, b], weight: ranges.players[0].weights[i] * ranges.players[1].weights[j] });
  }
  const total = raw.reduce((sum, deal) => sum + deal.weight, 0);
  const deals: readonly Weighted<Extract<Chance, { kind: "deal" }>>[] = raw.map(({ hands, weight }) =>
    ({ outcome: { kind: "deal", hands }, probability: weight / total }));
  const key = (hands: Hands) => hands.map(riverComboKey).join("/");
  const byDeal = new Map(raw.map(deal => [key(deal.hands), deal.hands]));
  const rivers = new Map(raw.map(({ hands }) => [key(hands), RIVER_DECK.filter(card =>
    !request.board.includes(card) && !hands.some(hand => hand.includes(card))).map(card => ({
    outcome: { kind: "river" as const, card }, probability: 1 / 44 }))]));
  const scoreCache = new Map<string, number>();
  const sign = (hands: Hands, river: RiverCard) => {
    const id = `${key(hands)}/${river}`;
    if (!scoreCache.has(id)) scoreCache.set(id, Math.sign(riverHandScore(hands[0], [...request.board, river]) - riverHandScore(hands[1], [...request.board, river])));
    return scoreCache.get(id)!;
  };
  const game: ExtensiveFormGame<ReadableTurnV2State, TurnV2Action, Chance> = {
    id: request.id, initialState: () => ({ public: initialTurnV2State(request), hands: null }),
    node(state) {
      if (!state.hands) return { kind: "chance", outcomes: deals };
      const p = state.public;
      if (p.phase === "river-card") return { kind: "chance", outcomes: rivers.get(key(state.hands))! };
      if (p.phase === "play") return { kind: "player", player: p.actor!, actions: turnV2Actions(request, p) };
      const winner = p.folded !== null ? p.folded === 0 ? -1 : 1 : sign(state.hands, p.river!);
      const value = winner * (request.committedPerPlayer + p.carried);
      return { kind: "terminal", utility: [value, -value] };
    },
    nextChance(state, outcome) {
      if (!state.hands && outcome.kind === "deal") {
        const hands = byDeal.get(key(outcome.hands));
        if (hands) return { public: initialTurnV2State(request), hands };
      }
      if (state.hands && state.public.phase === "river-card" && outcome.kind === "river"
        && rivers.get(key(state.hands))!.some(row => row.outcome.card === outcome.card)) {
        return { ...state, public: nextTurnV2River(request, state.public, outcome.card) };
      }
      throw new Error("Invalid readable turn v2 chance outcome");
    },
    nextAction(state, action) {
      if (!state.hands) throw new Error("Deal private cards before acting");
      return { ...state, public: nextTurnV2Action(request, state.public, action) };
    },
    informationSet(state, player) {
      if (!state.hands || state.public.phase !== "play" || state.public.actor !== player) throw new Error("Not this player's decision");
      return turnV2InformationKey(request, state.public, player, state.hands[player]);
    },
  };
  return Object.freeze({ ...game, request, preflight, deals });
}
