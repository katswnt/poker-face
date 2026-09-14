import type {
  ExtensiveFormGame,
  GameNode,
  SolverPlayer,
  Utility,
  Weighted,
} from "../toy/game";
import {
  assertDistinctRiverCards,
  canonicalRiverCombo,
  riverComboKey,
  riverCombosOverlap,
  riverHandScore,
  type RiverCard,
  type RiverCombo,
} from "./cards";

export type RiverAction = "check" | "bet-half" | "bet-pot" | "fold" | "call" | "raise-all-in";

export interface RiverRangeEntry {
  readonly cards: RiverCombo;
  readonly weight: number;
}

export interface RiverScenario {
  readonly id: string;
  readonly version: 1;
  readonly board: readonly [RiverCard, RiverCard, RiverCard, RiverCard, RiverCard];
  readonly ranges: readonly [readonly RiverRangeEntry[], readonly RiverRangeEntry[]];
  readonly committed: readonly [number, number];
  readonly stackBehind: readonly [number, number];
  readonly positions: readonly ["out-of-position", "in-position"];
  readonly betSizes: {
    readonly halfPot: number;
    readonly pot: number;
  };
  readonly maxRaises: 1;
}

export interface RiverDeal {
  readonly hands: readonly [RiverCombo, RiverCombo];
}

export interface RiverState {
  readonly hands: readonly [RiverCombo, RiverCombo] | null;
  readonly history: readonly RiverAction[];
}

type RiverRoundState =
  | { readonly kind: "decision"; readonly player: SolverPlayer; readonly actions: readonly RiverAction[] }
  | { readonly kind: "showdown" }
  | { readonly kind: "fold"; readonly foldedPlayer: SolverPlayer };

export interface RiverGame extends ExtensiveFormGame<RiverState, RiverAction, RiverDeal> {
  readonly scenario: RiverScenario;
  readonly deals: readonly Weighted<RiverDeal>[];
  riverInvestments(state: RiverState): readonly [number, number];
  totalContributions(state: RiverState): readonly [number, number];
  showdownWinner(hands: readonly [RiverCombo, RiverCombo]): SolverPlayer | null;
}

const OPEN_ACTIONS = ["check", "bet-half", "bet-pot"] as const;
const HALF_BET_RESPONSES = ["fold", "call", "raise-all-in"] as const;
const ALL_IN_RESPONSES = ["fold", "call"] as const;

function historyLabel(history: readonly RiverAction[]): string {
  return history.length === 0 ? "start" : history.join("-");
}

function roundState(history: readonly RiverAction[]): RiverRoundState {
  switch (historyLabel(history)) {
    case "start":
      return { kind: "decision", player: 0, actions: OPEN_ACTIONS };
    case "check":
      return { kind: "decision", player: 1, actions: OPEN_ACTIONS };
    case "bet-half":
      return { kind: "decision", player: 1, actions: HALF_BET_RESPONSES };
    case "bet-pot":
      return { kind: "decision", player: 1, actions: ALL_IN_RESPONSES };
    case "check-bet-half":
      return { kind: "decision", player: 0, actions: HALF_BET_RESPONSES };
    case "check-bet-pot":
      return { kind: "decision", player: 0, actions: ALL_IN_RESPONSES };
    case "bet-half-raise-all-in":
      return { kind: "decision", player: 0, actions: ALL_IN_RESPONSES };
    case "check-bet-half-raise-all-in":
      return { kind: "decision", player: 1, actions: ALL_IN_RESPONSES };
    case "check-check":
    case "bet-half-call":
    case "bet-pot-call":
    case "check-bet-half-call":
    case "check-bet-pot-call":
    case "bet-half-raise-all-in-call":
    case "check-bet-half-raise-all-in-call":
      return { kind: "showdown" };
    case "bet-half-fold":
    case "bet-pot-fold":
    case "check-bet-half-raise-all-in-fold":
      return { kind: "fold", foldedPlayer: 1 };
    case "check-bet-half-fold":
    case "check-bet-pot-fold":
    case "bet-half-raise-all-in-fold":
      return { kind: "fold", foldedPlayer: 0 };
    default:
      throw new Error(`Illegal river history ${historyLabel(history)}`);
  }
}

function assertWholePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number of chips; received ${value}`);
  }
}

function validateRange(
  range: readonly RiverRangeEntry[],
  board: readonly RiverCard[],
  player: SolverPlayer,
): readonly RiverRangeEntry[] {
  if (range.length === 0) throw new Error(`Player ${player} range is empty`);
  const boardCards = new Set(board);
  const seen = new Set<string>();
  return range.map(entry => {
    const cards = canonicalRiverCombo(entry.cards);
    if (cards.some(card => boardCards.has(card))) {
      throw new Error(`Player ${player} range combo ${riverComboKey(cards)} collides with the board`);
    }
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      throw new Error(`Player ${player} range combo ${riverComboKey(cards)} has invalid weight ${entry.weight}`);
    }
    const key = riverComboKey(cards);
    if (seen.has(key)) throw new Error(`Player ${player} range repeats combo ${key}`);
    seen.add(key);
    return { cards, weight: entry.weight };
  });
}

function validateScenario(input: RiverScenario): RiverScenario {
  if (!input.id || !/^[a-z0-9-]+$/.test(input.id)) throw new Error(`Invalid river scenario id ${input.id}`);
  if (input.version !== 1) throw new Error(`Unsupported river scenario version ${input.version}`);
  if (input.board.length !== 5) throw new Error(`River v1 requires five board cards; received ${input.board.length}`);
  assertDistinctRiverCards(input.board, "River board");
  input.committed.forEach((value, player) => assertWholePositive(value, `Player ${player} committed chips`));
  input.stackBehind.forEach((value, player) => assertWholePositive(value, `Player ${player} stack`));
  if (input.committed[0] !== input.committed[1]) {
    throw new Error("River v1 requires equal prior pot contributions");
  }
  if (input.stackBehind[0] !== input.stackBehind[1]) {
    throw new Error("River v1 requires equal effective stacks");
  }
  const startingPot = input.committed[0] + input.committed[1];
  if (input.betSizes.halfPot * 2 !== startingPot) {
    throw new Error("River v1 half-pot size must be exactly half the starting pot");
  }
  if (input.betSizes.pot !== startingPot || input.betSizes.pot !== input.stackBehind[0]) {
    throw new Error("River v1 pot bet must equal both the starting pot and each stack");
  }
  if (input.maxRaises !== 1) throw new Error("River v1 allows exactly one raise");
  if (input.positions[0] !== "out-of-position" || input.positions[1] !== "in-position") {
    throw new Error("River v1 requires player 0 out of position and player 1 in position");
  }
  const ranges: RiverScenario["ranges"] = [
    validateRange(input.ranges[0], input.board, 0),
    validateRange(input.ranges[1], input.board, 1),
  ];
  return {
    ...input,
    board: [...input.board],
    ranges,
    committed: [...input.committed],
    stackBehind: [...input.stackBehind],
    positions: [...input.positions],
    betSizes: { ...input.betSizes },
  };
}

function buildDeals(scenario: RiverScenario): readonly Weighted<RiverDeal>[] {
  const weighted = scenario.ranges[0].flatMap(left => scenario.ranges[1]
    .filter(right => !riverCombosOverlap(left.cards, right.cards))
    .map(right => ({ hands: [left.cards, right.cards] as const, weight: left.weight * right.weight })));
  const totalWeight = weighted.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error("River ranges contain no compatible private-hand pairs");
  }
  return weighted.map(deal => ({
    outcome: { hands: deal.hands },
    probability: deal.weight / totalWeight,
  }));
}

function investmentsFor(
  scenario: RiverScenario,
  history: readonly RiverAction[],
): readonly [number, number] {
  const invested = [0, 0];
  const prefix: RiverAction[] = [];
  for (const action of history) {
    const current = roundState(prefix);
    if (current.kind !== "decision" || !current.actions.some(legal => legal === action)) {
      throw new Error(`Illegal river action ${action} after ${historyLabel(prefix)}`);
    }
    const player = current.player;
    if (action === "bet-half") invested[player] += scenario.betSizes.halfPot;
    else if (action === "bet-pot") invested[player] += scenario.betSizes.pot;
    else if (action === "call") invested[player] = Math.max(...invested);
    else if (action === "raise-all-in") invested[player] = scenario.stackBehind[player];
    if (invested[player] > scenario.stackBehind[player]) {
      throw new Error(`Player ${player} invested more than their river stack`);
    }
    prefix.push(action);
  }
  return invested as [number, number];
}

function winnerUtility(
  winner: SolverPlayer,
  contributions: readonly [number, number],
): Utility {
  const pot = contributions[0] + contributions[1];
  return winner === 0
    ? [pot - contributions[0], -contributions[1]]
    : [-contributions[0], pot - contributions[1]];
}

export function createRiverGame(input: RiverScenario): RiverGame {
  const scenario = validateScenario(input);
  const deals = buildDeals(scenario);
  const dealKeys = new Set(deals.map(({ outcome }) =>
    `${riverComboKey(outcome.hands[0])}|${riverComboKey(outcome.hands[1])}`,
  ));

  const game: RiverGame = {
    id: scenario.id,
    scenario,
    deals,

    initialState(): RiverState {
      return { hands: null, history: [] };
    },

    node(state): GameNode<RiverAction, RiverDeal> {
      if (!state.hands) {
        if (state.history.length > 0) throw new Error("Undealt river state contains actions");
        return { kind: "chance", outcomes: deals };
      }
      const current = roundState(state.history);
      if (current.kind === "decision") {
        return { kind: "player", player: current.player, actions: current.actions };
      }
      const contributions = game.totalContributions(state);
      if (current.kind === "fold") {
        const winner = (1 - current.foldedPlayer) as SolverPlayer;
        return { kind: "terminal", utility: winnerUtility(winner, contributions) };
      }
      const winner = game.showdownWinner(state.hands);
      if (winner !== null) return { kind: "terminal", utility: winnerUtility(winner, contributions) };
      const pot = contributions[0] + contributions[1];
      return {
        kind: "terminal",
        utility: [pot / 2 - contributions[0], pot / 2 - contributions[1]],
      };
    },

    nextChance(state, outcome): RiverState {
      const node = game.node(state);
      if (node.kind !== "chance") throw new Error("Cannot deal hands at a non-chance river node");
      const hands = [canonicalRiverCombo(outcome.hands[0]), canonicalRiverCombo(outcome.hands[1])] as const;
      const key = `${riverComboKey(hands[0])}|${riverComboKey(hands[1])}`;
      if (!dealKeys.has(key)) throw new Error(`River deal ${key} is outside the configured ranges`);
      return { hands, history: [] };
    },

    nextAction(state, action): RiverState {
      const node = game.node(state);
      if (node.kind !== "player") throw new Error(`Cannot play ${action} at a ${node.kind} river node`);
      if (!node.actions.some(legal => legal === action)) {
        throw new Error(`Illegal river action ${action} after ${historyLabel(state.history)}`);
      }
      return { hands: state.hands, history: [...state.history, action] };
    },

    informationSet(state, player): string {
      const node = game.node(state);
      if (node.kind !== "player" || node.player !== player || !state.hands) {
        throw new Error(`Player ${player} does not act after ${historyLabel(state.history)}`);
      }
      return `${scenario.id}:p${player}:hand=${riverComboKey(state.hands[player])}:` +
        `history=${historyLabel(state.history)}`;
    },

    riverInvestments(state): readonly [number, number] {
      return investmentsFor(scenario, state.history);
    },

    totalContributions(state): readonly [number, number] {
      const invested = investmentsFor(scenario, state.history);
      return [scenario.committed[0] + invested[0], scenario.committed[1] + invested[1]];
    },

    showdownWinner(hands): SolverPlayer | null {
      const left = riverHandScore(hands[0], scenario.board);
      const right = riverHandScore(hands[1], scenario.board);
      return left === right ? null : left > right ? 0 : 1;
    },
  };

  return game;
}

export function riverState(
  game: RiverGame,
  hands: readonly [RiverCombo, RiverCombo],
  history: readonly RiverAction[] = [],
): RiverState {
  let state = game.nextChance(game.initialState(), { hands });
  for (const action of history) state = game.nextAction(state, action);
  return state;
}
