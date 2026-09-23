import type { ExtensiveFormGame, SolverPlayer, Utility, Weighted } from "../toy/game";
import {
  assertDistinctRiverCards, RIVER_DECK, riverComboKey, riverCombosOverlap, riverHandScore,
  type RiverCard, type RiverCombo,
} from "../river/cards";
import { parseConfigurableRiverRange } from "../river/configurable/range";

export const TURN_RULES_VERSION = 1;
export const TURN_LIMITS = Object.freeze({ rangeEntries: 8, compatibleDeals: 16, states: 25_000, iterations: 100_000 });
export type TurnAction = "check" | "bet" | "fold" | "call";
export type TurnHands = readonly [RiverCombo, RiverCombo];
export interface TurnRequest {
  readonly id: string;
  readonly board: readonly [RiverCard, RiverCard, RiverCard, RiverCard];
  readonly rangeText: readonly [string, string];
  /** The same amount already committed by EACH player, not the total pot. */
  readonly committedPerPlayer: number;
  readonly stackBehind: readonly [number, number];
  /** Additional opening bet chips on the turn and river, respectively. */
  readonly betSizes: readonly [number, number];
}
export type TurnChance = { readonly kind: "deal"; readonly hands: TurnHands }
  | { readonly kind: "river"; readonly card: RiverCard };
export interface TurnState {
  readonly hands: TurnHands | null;
  readonly phase: "deal" | "play" | "river-card" | "terminal";
  readonly street: 0 | 1;
  readonly river: RiverCard | null;
  readonly histories: readonly [readonly TurnAction[], readonly TurnAction[]];
  /** Gross chips added since the start of the turn; uncalled excess is returned at settlement. */
  readonly put: readonly [number, number];
  readonly actor: SolverPlayer | null;
  readonly folded: SolverPlayer | null;
}
export interface TurnCounts {
  readonly totalStates: number;
  readonly chanceNodes: number;
  readonly decisionNodes: number;
  readonly terminalNodes: number;
}
export interface TurnPreflight extends TurnCounts {
  readonly rangeEntries: readonly [number, number];
  readonly blockedCombos: readonly [number, number];
  readonly compatibleDeals: number;
  readonly legalRiversPerDeal: 44;
  readonly dealRiverPairs: number;
  readonly stateLimit: number;
}
export interface TurnSettlement {
  readonly contributions: readonly [number, number];
  readonly returnedUncalled: readonly [number, number];
  readonly contestablePot: number;
  readonly awards: readonly [number, number];
  readonly utility: Utility;
}
export interface TurnGame extends ExtensiveFormGame<TurnState, TurnAction, TurnChance> {
  readonly request: TurnRequest;
  readonly deals: readonly Weighted<Extract<TurnChance, { kind: "deal" }>>[];
  readonly preflight: TurnPreflight;
  settlement(state: TurnState): TurnSettlement;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const other = (player: SolverPlayer): SolverPlayer => player === 0 ? 1 : 0;
const dealKey = (hands: TurnHands) => hands.map(riverComboKey).join("/");

function whole(value: number, label: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1_000_000) {
    throw new Error(`${label} must be a ${allowZero ? "nonnegative" : "positive"} whole number no larger than 1000000`);
  }
}

/** A readable bounded reference: public chance is revealed AFTER turn actions. */
export function createTurnGame(input: TurnRequest, stateLimit: number = TURN_LIMITS.states): TurnGame {
  if (!Number.isSafeInteger(stateLimit) || stateLimit < 1 || stateLimit > TURN_LIMITS.states) {
    throw new Error(`Turn state limit must be between 1 and ${TURN_LIMITS.states}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.id)) throw new Error("Invalid turn game id");
  if (input.board.length !== 4) throw new Error("Turn board must have four cards");
  assertDistinctRiverCards(input.board, "Turn board");
  if (input.rangeText.length !== 2 || input.stackBehind.length !== 2 || input.betSizes.length !== 2) {
    throw new Error("Turn game needs two ranges, two stacks and two street bet sizes");
  }
  whole(input.committedPerPlayer, "Committed chips");
  input.stackBehind.forEach(value => whole(value, "Behind stack", true));
  input.betSizes.forEach(value => whole(value, "Bet size"));
  const request = freeze(structuredClone(input));
  const ranges = request.rangeText.map(text => {
    if (typeof text !== "string" || text.length > 2_000) throw new Error("Turn range text exceeds 2000 characters");
    const parsed = parseConfigurableRiverRange(text, request.board);
    if (parsed.entries.length > TURN_LIMITS.rangeEntries) throw new Error(`Turn range exceeds ${TURN_LIMITS.rangeEntries} combinations`);
    return parsed;
  });
  // Scale each range independently before products, avoiding overflow of relative weights.
  const maxima = ranges.map(range => Math.max(...range.entries.map(entry => entry.weight)));
  const raw = ranges[0].entries.flatMap(left => ranges[1].entries.flatMap(right => {
    if (riverCombosOverlap(left.cards, right.cards)) return [];
    const weight = (left.weight / maxima[0]) * (right.weight / maxima[1]);
    if (!(weight > 0)) throw new Error("Turn range weights underflow; use less extreme relative weights");
    return [{ hands: [left.cards, right.cards] as TurnHands, weight }];
  }));
  if (!raw.length) throw new Error("Turn ranges have no compatible private deals");
  if (raw.length > TURN_LIMITS.compatibleDeals) throw new Error(`Turn game exceeds ${TURN_LIMITS.compatibleDeals} compatible deals`);
  const total = raw.reduce((sum, deal) => sum + deal.weight, 0);
  const deals = freeze(raw.map(({ hands, weight }) => {
    const probability = weight / total;
    if (!(probability > 0)) throw new Error("Turn deal probability underflow; use less extreme relative weights");
    return { outcome: { kind: "deal" as const, hands }, probability };
  }));
  const byDeal = new Map(deals.map(deal => [dealKey(deal.outcome.hands), deal.outcome.hands]));
  const rivers = new Map(deals.map(({ outcome: { hands } }) => {
    const used = new Set([...request.board, ...hands.flat()]);
    return [dealKey(hands), freeze(RIVER_DECK.filter(card => !used.has(card)).map(card => ({
      outcome: { kind: "river" as const, card }, probability: 1 / 44,
    })))];
  }));
  const remaining = (state: TurnState, player: SolverPlayer) => request.stackBehind[player] - state.put[player];
  const allIn = (state: TurnState) => remaining(state, 0) === 0 || remaining(state, 1) === 0;
  const start: TurnState = freeze({ hands: null, phase: "deal", street: 0, river: null,
    histories: [[], []], put: [0, 0], actor: null, folded: null });
  const dealt = (hands: TurnHands): TurnState => ({ ...start, hands,
    phase: allIn(start) ? "river-card" : "play", actor: allIn(start) ? null : 0 });
  const reveal = (state: TurnState, card: RiverCard): TurnState => ({ ...state, street: 1, river: card,
    phase: allIn(state) ? "terminal" : "play", actor: allIn(state) ? null : 0 });
  const actions = (state: TurnState): readonly TurnAction[] => {
    if (state.phase !== "play" || state.actor === null) return [];
    return state.histories[state.street].includes("bet") ? ["fold", "call"] : ["check", "bet"];
  };
  const advance = (state: TurnState, action: TurnAction): TurnState => {
    if (state.actor === null || !actions(state).includes(action)) throw new Error(`Illegal turn action ${action}`);
    const player = state.actor;
    const opponent = other(player);
    const history = [...state.histories[state.street], action];
    const histories = [...state.histories] as [readonly TurnAction[], readonly TurnAction[]];
    histories[state.street] = history;
    const put: [number, number] = [...state.put];
    if (action === "bet") put[player] += Math.min(request.betSizes[state.street], remaining(state, player));
    if (action === "call") put[player] += Math.min(state.put[opponent] - state.put[player], remaining(state, player));
    const ends = action === "call" || (action === "check" && history.length === 2);
    return { ...state, histories, put,
      folded: action === "fold" ? player : null,
      phase: action === "fold" ? "terminal" : ends ? (state.street === 0 ? "river-card" : "terminal") : "play",
      actor: action === "fold" || ends ? null : opponent,
    };
  };
  // Count one public skeleton; all 44 river branches have identical betting structure.
  const count = (state: TurnState): TurnCounts => {
    let counts = { totalStates: 1, chanceNodes: 0, decisionNodes: 0, terminalNodes: 0 };
    const add = (child: TurnCounts, factor = 1) => {
      counts = { totalStates: counts.totalStates + factor * child.totalStates,
        chanceNodes: counts.chanceNodes + factor * child.chanceNodes,
        decisionNodes: counts.decisionNodes + factor * child.decisionNodes,
        terminalNodes: counts.terminalNodes + factor * child.terminalNodes };
    };
    if (state.phase === "terminal") counts.terminalNodes++;
    else if (state.phase === "river-card") {
      counts.chanceNodes++;
      add(count(reveal(state, rivers.get(dealKey(state.hands!))![0].outcome.card)), 44);
    } else {
      counts.decisionNodes++;
      actions(state).forEach(action => add(count(advance(state, action))));
    }
    return counts;
  };
  const perDeal = count(dealt(deals[0].outcome.hands));
  const preflight: TurnPreflight = freeze({
    rangeEntries: [ranges[0].entries.length, ranges[1].entries.length],
    blockedCombos: [ranges[0].blockedComboCount, ranges[1].blockedComboCount],
    compatibleDeals: deals.length, legalRiversPerDeal: 44, dealRiverPairs: deals.length * 44,
    totalStates: 1 + deals.length * perDeal.totalStates,
    chanceNodes: 1 + deals.length * perDeal.chanceNodes,
    decisionNodes: deals.length * perDeal.decisionNodes,
    terminalNodes: deals.length * perDeal.terminalNodes, stateLimit,
  });
  if (preflight.totalStates > stateLimit) throw new Error(`Turn game has ${preflight.totalStates} states; limit is ${stateLimit}`);
  const winnerCache = new Map<string, SolverPlayer | null>();
  const game: TurnGame = {
    id: request.id, request, deals, preflight,
    initialState: () => start,
    node(state) {
      if (state.phase === "deal") return { kind: "chance", outcomes: deals };
      if (state.phase === "river-card") {
        if (!state.hands) throw new Error("River chance requires private hands");
        return { kind: "chance", outcomes: rivers.get(dealKey(state.hands))! };
      }
      if (state.phase === "terminal") return { kind: "terminal", utility: game.settlement(state).utility };
      if (state.actor === null) throw new Error("Turn decision has no actor");
      return { kind: "player", player: state.actor, actions: actions(state) };
    },
    nextChance(state, outcome) {
      if (state.phase === "deal" && outcome.kind === "deal") {
        const hands = byDeal.get(dealKey(outcome.hands));
        if (!hands) throw new Error("Incompatible private deal");
        return dealt(hands);
      }
      if (state.phase === "river-card" && state.hands && outcome.kind === "river") {
        if (!rivers.get(dealKey(state.hands))!.some(child => child.outcome.card === outcome.card)) {
          throw new Error("Blocked or invalid river card");
        }
        return reveal(state, outcome.card);
      }
      throw new Error("Chance outcome does not match turn game phase");
    },
    nextAction: advance,
    informationSet(state, player) {
      if (state.phase !== "play" || !state.hands || state.actor !== player) throw new Error("Not this player's decision");
      return `turn-v1:p${player}:${riverComboKey(state.hands[player])}:board=${request.board.join("")}` +
        `:river=${state.street === 0 ? "hidden" : state.river}:street=${state.street}` +
        `:turn=${state.histories[0].join("-") || "start"}:river-actions=${state.histories[1].join("-") || "start"}`;
    },
    settlement(state) {
      if (state.phase !== "terminal" || !state.hands) throw new Error("Cannot settle unfinished turn game");
      const contributions: [number, number] = state.put.map(chips => chips + request.committedPerPlayer) as [number, number];
      const matched = Math.min(...contributions);
      const returnedUncalled: [number, number] = [contributions[0] - matched, contributions[1] - matched];
      let winner: SolverPlayer | null;
      if (state.folded !== null) winner = other(state.folded);
      else {
        if (!state.river) throw new Error("Showdown requires a river card");
        const key = `${dealKey(state.hands)}/${state.river}`;
        if (!winnerCache.has(key)) {
          const board = [...request.board, state.river];
          const a = riverHandScore(state.hands[0], board);
          const b = riverHandScore(state.hands[1], board);
          winnerCache.set(key, a === b ? null : a > b ? 0 : 1);
        }
        winner = winnerCache.get(key)!;
      }
      const contestablePot = 2 * matched;
      const awards: [number, number] = [0, 1].map(player => returnedUncalled[player] +
        (winner === null ? matched : winner === player ? contestablePot : 0)) as [number, number];
      return { contributions, returnedUncalled, contestablePot, awards,
        utility: [awards[0] - contributions[0], awards[1] - contributions[1]] };
    },
  };
  return Object.freeze(game);
}
