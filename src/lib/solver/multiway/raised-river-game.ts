import {
  assertDistinctRiverCards,
  canonicalRiverCombo,
  riverComboKey,
  riverCombosOverlap,
  riverHandScore,
  type RiverCard,
  type RiverCombo,
} from "../river/cards";
import type { MultiwayExtensiveFormGame, MultiwayGameNode, Weighted } from "./game";
import type { MultiwayRiverPosition, MultiwayRiverRangeEntry, ThreePlayers } from "./river-game";

export type RaisedRiverAction = "check" | "bet" | "fold" | "call" | "raise-all-in";

export interface RaisedRiverScenario {
  readonly id: string;
  readonly version: 1;
  readonly board: readonly RiverCard[];
  readonly ranges: ThreePlayers<readonly MultiwayRiverRangeEntry[]>;
  readonly committed: ThreePlayers<number>;
  readonly stackBehind: ThreePlayers<number>;
  readonly positions: ThreePlayers<MultiwayRiverPosition>;
  readonly actionOrder: ThreePlayers<number>;
  readonly betSize: number;
  readonly raiseTo: number;
  readonly maxRaises: 1;
}

export interface RaisedRiverDeal {
  readonly hands: ThreePlayers<RiverCombo>;
}

export interface RaisedRiverPublicState {
  readonly active: ThreePlayers<boolean>;
  readonly streetContributions: ThreePlayers<number>;
  readonly actingPlayer: number | null;
  readonly currentBet: number;
  readonly lastAggressor: number | null;
  readonly raisesUsed: 0 | 1;
  readonly pendingResponders: readonly number[];
  readonly checkedCount: number;
  readonly terminal: "fold" | "showdown" | null;
  readonly history: readonly RaisedRiverAction[];
}

export interface RaisedRiverState {
  readonly hands: ThreePlayers<RiverCombo> | null;
  readonly public: RaisedRiverPublicState;
}

export interface RaisedRiverSettlement {
  readonly contributions: ThreePlayers<number>;
  readonly returnedUncalled: ThreePlayers<number>;
  readonly contestablePot: number;
  readonly winners: readonly number[];
  readonly utility: ThreePlayers<number>;
}

export interface RaisedRiverGame extends MultiwayExtensiveFormGame<
  RaisedRiverState,
  RaisedRiverAction,
  RaisedRiverDeal
> {
  readonly scenario: RaisedRiverScenario;
  readonly deals: readonly Weighted<RaisedRiverDeal>[];
  totalContributions(state: RaisedRiverState): ThreePlayers<number>;
  showdownWinners(state: RaisedRiverState): readonly number[];
  settlement(state: RaisedRiverState): RaisedRiverSettlement;
}

const UNOPENED_ACTIONS = ["check", "bet"] as const;
const OPEN_BET_RESPONSES = ["fold", "call", "raise-all-in"] as const;
const RAISE_RESPONSES = ["fold", "call"] as const;

function asThree<T>(values: readonly T[], label: string): ThreePlayers<T> {
  if (values.length !== 3) throw new Error(`${label} must contain exactly three values`);
  return [values[0], values[1], values[2]];
}

function assertPositiveWhole(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number; received ${value}`);
  }
}

function validateRange(
  range: readonly MultiwayRiverRangeEntry[],
  board: readonly RiverCard[],
  player: number,
): readonly MultiwayRiverRangeEntry[] {
  if (range.length === 0) throw new Error(`Player ${player} range is empty`);
  const boardCards = new Set(board);
  const seen = new Set<string>();
  return range.map(entry => {
    const cards = canonicalRiverCombo(entry.cards);
    const key = riverComboKey(cards);
    if (cards.some(card => boardCards.has(card))) {
      throw new Error(`Player ${player} range combo ${key} collides with the board`);
    }
    if (seen.has(key)) throw new Error(`Player ${player} range repeats combo ${key}`);
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      throw new Error(`Player ${player} range combo ${key} has invalid weight ${entry.weight}`);
    }
    seen.add(key);
    return { cards, weight: entry.weight };
  });
}

function validateScenario(input: RaisedRiverScenario): RaisedRiverScenario {
  if (!input.id || !/^[a-z0-9-]+$/.test(input.id)) throw new Error(`Invalid scenario id ${input.id}`);
  if (input.version !== 1) throw new Error(`Unsupported raised river version ${input.version}`);
  if (input.board.length !== 5) throw new Error(`A river board needs five cards; received ${input.board.length}`);
  assertDistinctRiverCards(input.board, "Raised river board");
  input.committed.forEach((value, player) => assertPositiveWhole(value, `Player ${player} commitment`));
  input.stackBehind.forEach((value, player) => assertPositiveWhole(value, `Player ${player} stack`));
  assertPositiveWhole(input.betSize, "Bet size");
  assertPositiveWhole(input.raiseTo, "All-in raise target");
  if (new Set(input.committed).size !== 1) throw new Error("Raised river v1 requires equal commitments");
  if (new Set(input.stackBehind).size !== 1) throw new Error("Raised river v1 requires equal stacks");
  if (input.raiseTo !== input.stackBehind[0]) throw new Error("Raised river v1 raise target must be all-in");
  if (input.betSize >= input.raiseTo) throw new Error("Opening bet must be smaller than the raise target");
  if (input.maxRaises !== 1) throw new Error("Raised river v1 allows exactly one raise");
  if (input.actionOrder.join(",") !== "0,1,2") throw new Error("Raised river action order must be 0,1,2");
  if (input.positions.join(",") !== "first,middle,last") {
    throw new Error("Raised river positions must match action order");
  }
  return {
    ...input,
    board: [...input.board],
    ranges: asThree(
      input.ranges.map((range, player) => validateRange(range, input.board, player)),
      "Ranges",
    ),
    committed: asThree(input.committed, "Commitments"),
    stackBehind: asThree(input.stackBehind, "Stacks"),
    positions: asThree(input.positions, "Positions"),
    actionOrder: asThree(input.actionOrder, "Action order"),
  };
}

function buildDeals(scenario: RaisedRiverScenario): readonly Weighted<RaisedRiverDeal>[] {
  const compatible: { hands: ThreePlayers<RiverCombo>; weight: number }[] = [];
  for (const first of scenario.ranges[0]) {
    for (const second of scenario.ranges[1]) {
      if (riverCombosOverlap(first.cards, second.cards)) continue;
      for (const third of scenario.ranges[2]) {
        if (
          riverCombosOverlap(first.cards, third.cards) ||
          riverCombosOverlap(second.cards, third.cards)
        ) continue;
        compatible.push({
          hands: [first.cards, second.cards, third.cards],
          weight: first.weight * second.weight * third.weight,
        });
      }
    }
  }
  const totalWeight = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error("Raised river ranges contain no compatible private-hand tuples");
  }
  return compatible.map(deal => ({
    outcome: { hands: deal.hands },
    probability: deal.weight / totalWeight,
  }));
}

function dealKey(hands: ThreePlayers<RiverCombo>): string {
  return hands.map(riverComboKey).join("|");
}

function initialPublicState(): RaisedRiverPublicState {
  return {
    active: [true, true, true],
    streetContributions: [0, 0, 0],
    actingPlayer: 0,
    currentBet: 0,
    lastAggressor: null,
    raisesUsed: 0,
    pendingResponders: [],
    checkedCount: 0,
    terminal: null,
    history: [],
  };
}

function seatsAfter(player: number): readonly number[] {
  return [1, 2].map(offset => (player + offset) % 3);
}

function activeCount(active: ThreePlayers<boolean>): number {
  return active.filter(Boolean).length;
}

function advance(
  current: RaisedRiverPublicState,
  action: RaisedRiverAction,
  scenario: RaisedRiverScenario,
): RaisedRiverPublicState {
  const player = current.actingPlayer;
  if (player === null || current.terminal) throw new Error(`Cannot play ${action} after the hand ended`);
  const active = [...current.active] as [boolean, boolean, boolean];
  const contributions = [...current.streetContributions] as [number, number, number];
  const history = [...current.history, action];

  if (current.currentBet === 0) {
    if (action === "check") {
      const checkedCount = current.checkedCount + 1;
      return checkedCount === activeCount(active)
        ? { ...current, actingPlayer: null, checkedCount, terminal: "showdown", history }
        : {
            ...current,
            actingPlayer: seatsAfter(player).find(seat => active[seat]) ?? null,
            checkedCount,
            history,
          };
    }
    if (action !== "bet") throw new Error(`${action} is illegal when no bet is open`);
    contributions[player] = scenario.betSize;
    const pendingResponders = seatsAfter(player).filter(seat => active[seat]);
    return {
      ...current,
      streetContributions: contributions,
      actingPlayer: pendingResponders[0] ?? null,
      currentBet: scenario.betSize,
      lastAggressor: player,
      pendingResponders,
      history,
    };
  }

  if (current.pendingResponders[0] !== player) throw new Error(`Player ${player} is not next to respond`);
  if (action === "raise-all-in") {
    if (current.raisesUsed !== 0 || current.currentBet !== scenario.betSize) {
      throw new Error("The single all-in raise has already been used");
    }
    contributions[player] = scenario.raiseTo;
    const pendingResponders = seatsAfter(player)
      .filter(seat => active[seat] && contributions[seat] < scenario.raiseTo);
    if (pendingResponders.length === 0) throw new Error("An all-in raise has no eligible responder");
    return {
      ...current,
      streetContributions: contributions,
      actingPlayer: pendingResponders[0],
      currentBet: scenario.raiseTo,
      lastAggressor: player,
      raisesUsed: 1,
      pendingResponders,
      history,
    };
  }
  if (action !== "fold" && action !== "call") throw new Error(`${action} is illegal facing a bet`);
  if (action === "fold") active[player] = false;
  else contributions[player] = current.currentBet;
  const pendingResponders = current.pendingResponders.slice(1);
  const onlyOneActive = activeCount(active) === 1;
  const finished = onlyOneActive || pendingResponders.length === 0;
  return {
    ...current,
    active,
    streetContributions: contributions,
    actingPlayer: finished ? null : pendingResponders[0],
    pendingResponders,
    terminal: finished ? (onlyOneActive ? "fold" : "showdown") : null,
    history,
  };
}

export function createRaisedRiverGame(input: RaisedRiverScenario): RaisedRiverGame {
  const scenario = validateScenario(input);
  const deals = buildDeals(scenario);
  const dealKeys = new Set(deals.map(deal => dealKey(deal.outcome.hands)));
  const game: RaisedRiverGame = {
    id: scenario.id,
    playerCount: 3,
    scenario,
    deals,
    initialState: () => ({ hands: null, public: initialPublicState() }),
    node(state): MultiwayGameNode<RaisedRiverAction, RaisedRiverDeal> {
      if (!state.hands) {
        if (state.public.history.length > 0) throw new Error("Undealt raised river state has actions");
        return { kind: "chance", outcomes: deals };
      }
      if (state.public.terminal) return { kind: "terminal", utility: game.settlement(state).utility };
      if (state.public.actingPlayer === null) throw new Error("Non-terminal raised river has no actor");
      const actions = state.public.currentBet === 0
        ? UNOPENED_ACTIONS
        : state.public.raisesUsed === 0 ? OPEN_BET_RESPONSES : RAISE_RESPONSES;
      return { kind: "player", player: state.public.actingPlayer, actions };
    },
    nextChance(state, outcome): RaisedRiverState {
      if (game.node(state).kind !== "chance") throw new Error("Cannot deal at a non-chance node");
      const hands = asThree(outcome.hands.map(canonicalRiverCombo), "Private hands");
      if (!dealKeys.has(dealKey(hands))) throw new Error(`Deal ${dealKey(hands)} is outside the ranges`);
      return { hands, public: initialPublicState() };
    },
    nextAction(state, action): RaisedRiverState {
      const node = game.node(state);
      if (node.kind !== "player") throw new Error(`Cannot play ${action} at a ${node.kind} node`);
      if (!node.actions.includes(action)) {
        throw new Error(`Illegal ${action} after ${state.public.history.join("-") || "start"}`);
      }
      return { hands: state.hands, public: advance(state.public, action, scenario) };
    },
    informationSet(state, player): string {
      const node = game.node(state);
      if (node.kind !== "player" || node.player !== player || !state.hands) {
        throw new Error(`Player ${player} does not act in this state`);
      }
      const view = state.public;
      return `${scenario.id}:board=${scenario.board.join("")}:p${player}:` +
        `hand=${riverComboKey(state.hands[player])}:active=${view.active.map(Number).join("")}:` +
        `put=${view.streetContributions.join(",")}:bet=${view.currentBet}:raises=${view.raisesUsed}:` +
        `history=${view.history.join("-") || "start"}`;
    },
    totalContributions(state): ThreePlayers<number> {
      return asThree(
        scenario.committed.map((value, player) => value + state.public.streetContributions[player]),
        "Total contributions",
      );
    },
    showdownWinners(state): readonly number[] {
      if (!state.hands) throw new Error("Cannot score an undealt raised river state");
      const active = state.public.active.map((isActive, player) => isActive ? player : null)
        .filter((player): player is number => player !== null);
      if (active.length === 0) throw new Error("A raised river state cannot have zero active players");
      if (active.length === 1) return active;
      const scores = active.map(player => ({
        player,
        score: riverHandScore(state.hands![player], scenario.board),
      }));
      const best = Math.max(...scores.map(result => result.score));
      return scores.filter(result => result.score === best).map(result => result.player);
    },
    settlement(state): RaisedRiverSettlement {
      if (!state.public.terminal) throw new Error("Cannot settle a non-terminal raised river state");
      const contributions = game.totalContributions(state);
      const sorted = contributions.map((value, player) => ({ player, value }))
        .sort((left, right) => right.value - left.value || left.player - right.player);
      const returned = [0, 0, 0];
      if (sorted[0].value > sorted[1].value) {
        returned[sorted[0].player] = sorted[0].value - sorted[1].value;
      }
      const returnedUncalled = asThree(returned, "Returned chips");
      const totalPot = contributions.reduce((sum, value) => sum + value, 0);
      const totalReturned = returnedUncalled.reduce((sum, value) => sum + value, 0);
      const contestablePot = totalPot - totalReturned;
      const winners = game.showdownWinners(state);
      const share = contestablePot / winners.length;
      const utility = asThree(contributions.map((contribution, player) =>
        returnedUncalled[player] + (winners.includes(player) ? share : 0) - contribution), "Utility");
      return { contributions, returnedUncalled, contestablePot, winners, utility };
    },
  };
  return game;
}

export function raisedRiverState(
  game: RaisedRiverGame,
  hands: ThreePlayers<RiverCombo>,
  history: readonly RaisedRiverAction[] = [],
): RaisedRiverState {
  let state = game.nextChance(game.initialState(), { hands });
  for (const action of history) state = game.nextAction(state, action);
  return state;
}
