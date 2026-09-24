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

export type SidePotRiverAction =
  | "check"
  | "bet-30"
  | "bet-all-in"
  | "fold"
  | "call"
  | "raise-all-in";

export interface SidePotRiverScenario {
  readonly id: string;
  readonly version: 1;
  readonly board: readonly RiverCard[];
  readonly ranges: ThreePlayers<readonly MultiwayRiverRangeEntry[]>;
  readonly committed: ThreePlayers<number>;
  readonly stackBehind: ThreePlayers<number>;
  readonly positions: ThreePlayers<MultiwayRiverPosition>;
  readonly actionOrder: ThreePlayers<number>;
  readonly smallBet: 30;
  readonly allInBet: 60;
  readonly maxRaises: 1;
}

export interface SidePotRiverDeal {
  readonly hands: ThreePlayers<RiverCombo>;
}

export interface SidePotRiverPublicState {
  readonly active: ThreePlayers<boolean>;
  readonly streetContributions: ThreePlayers<number>;
  readonly actingPlayer: number | null;
  readonly currentBet: number;
  readonly lastAggressor: number | null;
  readonly raisesUsed: 0 | 1;
  readonly pendingResponders: readonly number[];
  readonly checkedCount: number;
  readonly terminal: "fold" | "showdown" | null;
  readonly history: readonly SidePotRiverAction[];
}

export interface SidePotRiverState {
  readonly hands: ThreePlayers<RiverCombo> | null;
  readonly public: SidePotRiverPublicState;
}

export interface SidePotLayer {
  readonly index: number;
  readonly contributionFloor: number;
  readonly contributionCeiling: number;
  readonly amount: number;
  readonly contributingPlayers: readonly number[];
  readonly eligiblePlayers: readonly number[];
  readonly winners: readonly number[];
  readonly awards: ThreePlayers<number>;
}

export interface SidePotRiverSettlement {
  readonly contributions: ThreePlayers<number>;
  readonly returnedUncalled: ThreePlayers<number>;
  readonly contestablePot: number;
  readonly potLayers: readonly SidePotLayer[];
  readonly totalAwards: ThreePlayers<number>;
  readonly utility: ThreePlayers<number>;
}

export interface SidePotRiverGame extends MultiwayExtensiveFormGame<
  SidePotRiverState,
  SidePotRiverAction,
  SidePotRiverDeal
> {
  readonly scenario: SidePotRiverScenario;
  readonly deals: readonly Weighted<SidePotRiverDeal>[];
  totalContributions(state: SidePotRiverState): ThreePlayers<number>;
  callCost(state: SidePotRiverState, player: number): number;
  settlement(state: SidePotRiverState): SidePotRiverSettlement;
}

const SHORT_UNOPENED_ACTIONS = ["check", "bet-30"] as const;
const DEEP_UNOPENED_ACTIONS = ["check", "bet-30", "bet-all-in"] as const;
const CALL_OR_FOLD = ["fold", "call"] as const;
const CALL_FOLD_OR_RAISE = ["fold", "call", "raise-all-in"] as const;

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

function validateScenario(input: SidePotRiverScenario): SidePotRiverScenario {
  if (!input.id || !/^[a-z0-9-]+$/.test(input.id)) throw new Error(`Invalid scenario id ${input.id}`);
  if (input.version !== 1) throw new Error(`Unsupported side-pot river version ${input.version}`);
  if (input.board.length !== 5) throw new Error(`A river board needs five cards; received ${input.board.length}`);
  assertDistinctRiverCards(input.board, "Side-pot river board");
  input.committed.forEach((value, player) => assertPositiveWhole(value, `Player ${player} commitment`));
  input.stackBehind.forEach((value, player) => assertPositiveWhole(value, `Player ${player} stack`));
  if (input.committed.some(value => value !== 30)) {
    throw new Error("Side-pot river v1 requires each player to have committed 30 chips");
  }
  if (input.stackBehind.join(",") !== "30,60,60") {
    throw new Error("Side-pot river v1 locks remaining stacks at 30,60,60");
  }
  if (input.smallBet !== 30 || input.allInBet !== 60) {
    throw new Error("Side-pot river v1 locks nominal wagers at 30 and 60 chips");
  }
  if (input.maxRaises !== 1) throw new Error("Side-pot river v1 allows exactly one raise");
  if (input.actionOrder.join(",") !== "0,1,2") throw new Error("Side-pot river action order must be 0,1,2");
  if (input.positions.join(",") !== "first,middle,last") {
    throw new Error("Side-pot river positions must match action order");
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

function buildDeals(scenario: SidePotRiverScenario): readonly Weighted<SidePotRiverDeal>[] {
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
    throw new Error("Side-pot river ranges contain no compatible private-hand tuples");
  }
  return compatible.map(deal => ({
    outcome: { hands: deal.hands },
    probability: deal.weight / totalWeight,
  }));
}

function dealKey(hands: ThreePlayers<RiverCombo>): string {
  return hands.map(riverComboKey).join("|");
}

function initialPublicState(): SidePotRiverPublicState {
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

function canStillAct(
  player: number,
  active: ThreePlayers<boolean>,
  contributions: ThreePlayers<number>,
  scenario: SidePotRiverScenario,
): boolean {
  return active[player] && contributions[player] < scenario.stackBehind[player];
}

function canRaiseAllIn(
  current: SidePotRiverPublicState,
  player: number,
  scenario: SidePotRiverScenario,
): boolean {
  if (
    current.currentBet !== scenario.smallBet ||
    current.raisesUsed !== 0 ||
    scenario.stackBehind[player] < scenario.allInBet ||
    current.streetContributions[player] >= scenario.allInBet
  ) return false;
  return seatsAfter(player).some(seat =>
    canStillAct(seat, current.active, current.streetContributions, scenario));
}

function advance(
  current: SidePotRiverPublicState,
  action: SidePotRiverAction,
  scenario: SidePotRiverScenario,
): SidePotRiverPublicState {
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
    if (action !== "bet-30" && action !== "bet-all-in") {
      throw new Error(`${action} is illegal when no bet is open`);
    }
    const amount = action === "bet-30" ? scenario.smallBet : scenario.allInBet;
    if (amount > scenario.stackBehind[player]) {
      throw new Error(`Player ${player} cannot bet ${amount} with ${scenario.stackBehind[player]} behind`);
    }
    contributions[player] = amount;
    const pendingResponders = seatsAfter(player).filter(seat =>
      canStillAct(seat, active, contributions, scenario));
    return {
      ...current,
      streetContributions: contributions,
      actingPlayer: pendingResponders[0] ?? null,
      currentBet: amount,
      lastAggressor: player,
      pendingResponders,
      terminal: pendingResponders.length === 0 ? "showdown" : null,
      history,
    };
  }

  if (current.pendingResponders[0] !== player) throw new Error(`Player ${player} is not next to respond`);
  if (action === "raise-all-in") {
    if (!canRaiseAllIn(current, player, scenario)) throw new Error("An all-in raise is unavailable here");
    contributions[player] = scenario.allInBet;
    const pendingResponders = seatsAfter(player).filter(seat =>
      canStillAct(seat, active, contributions, scenario));
    if (pendingResponders.length === 0) throw new Error("An all-in raise has no eligible responder");
    return {
      ...current,
      streetContributions: contributions,
      actingPlayer: pendingResponders[0],
      currentBet: scenario.allInBet,
      lastAggressor: player,
      raisesUsed: 1,
      pendingResponders,
      history,
    };
  }
  if (action !== "fold" && action !== "call") throw new Error(`${action} is illegal facing a bet`);
  if (action === "fold") {
    active[player] = false;
  } else {
    contributions[player] = Math.min(current.currentBet, scenario.stackBehind[player]);
  }
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

function winnersForLayer(
  state: SidePotRiverState,
  eligiblePlayers: readonly number[],
  board: readonly RiverCard[],
): readonly number[] {
  if (!state.hands) throw new Error("Cannot score an undealt side-pot river state");
  if (eligiblePlayers.length === 0) throw new Error("A contestable pot layer has no eligible player");
  if (eligiblePlayers.length === 1) return eligiblePlayers;
  const scores = eligiblePlayers.map(player => ({
    player,
    score: riverHandScore(state.hands![player], board),
  }));
  const best = Math.max(...scores.map(result => result.score));
  return scores.filter(result => result.score === best).map(result => result.player);
}

export function createSidePotRiverGame(input: SidePotRiverScenario): SidePotRiverGame {
  const scenario = validateScenario(input);
  const deals = buildDeals(scenario);
  const dealKeys = new Set(deals.map(deal => dealKey(deal.outcome.hands)));
  const game: SidePotRiverGame = {
    id: scenario.id,
    playerCount: 3,
    scenario,
    deals,
    initialState: () => ({ hands: null, public: initialPublicState() }),
    node(state): MultiwayGameNode<SidePotRiverAction, SidePotRiverDeal> {
      if (!state.hands) {
        if (state.public.history.length > 0) throw new Error("Undealt side-pot river state has actions");
        return { kind: "chance", outcomes: deals };
      }
      if (state.public.terminal) return { kind: "terminal", utility: game.settlement(state).utility };
      const player = state.public.actingPlayer;
      if (player === null) throw new Error("Non-terminal side-pot river has no actor");
      if (state.public.currentBet === 0) {
        return {
          kind: "player",
          player,
          actions: scenario.stackBehind[player] >= scenario.allInBet
            ? DEEP_UNOPENED_ACTIONS
            : SHORT_UNOPENED_ACTIONS,
        };
      }
      return {
        kind: "player",
        player,
        actions: canRaiseAllIn(state.public, player, scenario)
          ? CALL_FOLD_OR_RAISE
          : CALL_OR_FOLD,
      };
    },
    nextChance(state, outcome): SidePotRiverState {
      if (game.node(state).kind !== "chance") throw new Error("Cannot deal at a non-chance node");
      const hands = asThree(outcome.hands.map(canonicalRiverCombo), "Private hands");
      if (!dealKeys.has(dealKey(hands))) throw new Error(`Deal ${dealKey(hands)} is outside the ranges`);
      return { hands, public: initialPublicState() };
    },
    nextAction(state, action): SidePotRiverState {
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
      const allIn = view.streetContributions.map((amount, seat) =>
        Number(view.active[seat] && amount === scenario.stackBehind[seat]));
      return `${scenario.id}:board=${scenario.board.join("")}:p${player}:` +
        `hand=${riverComboKey(state.hands[player])}:active=${view.active.map(Number).join("")}:` +
        `allin=${allIn.join("")}:put=${view.streetContributions.join(",")}:` +
        `bet=${view.currentBet}:raises=${view.raisesUsed}:history=${view.history.join("-") || "start"}`;
    },
    totalContributions(state): ThreePlayers<number> {
      return asThree(
        scenario.committed.map((value, player) => value + state.public.streetContributions[player]),
        "Total contributions",
      );
    },
    callCost(state, player): number {
      if (state.public.currentBet === 0) return 0;
      const owed = state.public.currentBet - state.public.streetContributions[player];
      const remaining = scenario.stackBehind[player] - state.public.streetContributions[player];
      return Math.max(0, Math.min(owed, remaining));
    },
    settlement(state): SidePotRiverSettlement {
      if (!state.public.terminal) throw new Error("Cannot settle a non-terminal side-pot river state");
      const contributions = game.totalContributions(state);
      const ranked = contributions.map((value, player) => ({ player, value }))
        .sort((left, right) => right.value - left.value || left.player - right.player);
      const returned = [0, 0, 0];
      if (ranked[0].value > ranked[1].value) {
        returned[ranked[0].player] = ranked[0].value - ranked[1].value;
      }
      const returnedUncalled = asThree(returned, "Returned chips");
      const matched = asThree(
        contributions.map((value, player) => value - returnedUncalled[player]),
        "Matched contributions",
      );
      const levels = [...new Set(matched)].filter(value => value > 0).sort((left, right) => left - right);
      // One pot per distinct set of players who can win it. Chips a folder left at a lower
      // level join the pot above rather than forming a side pot with the same contenders;
      // merging such levels leaves every award unchanged.
      const slices: Omit<SidePotLayer, "index" | "winners" | "awards">[] = [];
      let floor = 0;
      for (const ceiling of levels) {
        const contributingPlayers = [0, 1, 2].filter(player => matched[player] >= ceiling);
        const amount = (ceiling - floor) * contributingPlayers.length;
        const eligiblePlayers = contributingPlayers.filter(player => state.public.active[player]);
        if (amount <= 0) throw new Error(`Side-pot layer ${slices.length} is empty`);
        const below = slices.at(-1);
        if (below && below.eligiblePlayers.join() === eligiblePlayers.join()) {
          slices[slices.length - 1] = { ...below, contributionCeiling: ceiling, amount: below.amount + amount };
        } else {
          slices.push({
            contributionFloor: floor,
            contributionCeiling: ceiling,
            amount,
            contributingPlayers,
            eligiblePlayers,
          });
        }
        floor = ceiling;
      }
      const potLayers: SidePotLayer[] = slices.map((slice, index) => {
        const winners = winnersForLayer(state, slice.eligiblePlayers, scenario.board);
        const awards = [0, 0, 0] as [number, number, number];
        for (const winner of winners) awards[winner] = slice.amount / winners.length;
        return { index, ...slice, winners, awards };
      });
      const totalAwards = asThree([0, 1, 2].map(player =>
        potLayers.reduce((sum, layer) => sum + layer.awards[player], 0)), "Total awards");
      const contestablePot = potLayers.reduce((sum, layer) => sum + layer.amount, 0);
      const utility = asThree(contributions.map((contribution, player) =>
        returnedUncalled[player] + totalAwards[player] - contribution), "Utility");
      return { contributions, returnedUncalled, contestablePot, potLayers, totalAwards, utility };
    },
  };
  return game;
}

export function sidePotRiverState(
  game: SidePotRiverGame,
  hands: ThreePlayers<RiverCombo>,
  history: readonly SidePotRiverAction[] = [],
): SidePotRiverState {
  let state = game.nextChance(game.initialState(), { hands });
  for (const action of history) state = game.nextAction(state, action);
  return state;
}
