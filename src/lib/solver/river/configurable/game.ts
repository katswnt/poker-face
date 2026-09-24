import type {
  ExtensiveFormGame,
  GameNode,
  SolverPlayer,
  Utility,
  Weighted,
} from "../../toy/game";
import {
  assertDistinctRiverCards,
  canonicalRiverCombo,
  riverComboKey,
  riverCombosOverlap,
  riverHandScore,
  type RiverCard,
  type RiverCombo,
} from "../cards";
import type { ConfigurableRiverRangeEntry } from "./range";

export const CONFIGURABLE_RIVER_RULES_VERSION = 2;

export type ConfigurableRiverAction =
  | "check"
  | "fold"
  | "call"
  | `bet-to-${number}`
  | `raise-to-${number}`;

export interface ConfigurableRiverScenario {
  readonly id: string;
  readonly version: 2;
  readonly board: readonly [RiverCard, RiverCard, RiverCard, RiverCard, RiverCard];
  readonly ranges: readonly [
    readonly ConfigurableRiverRangeEntry[],
    readonly ConfigurableRiverRangeEntry[],
  ];
  readonly committed: readonly [number, number];
  readonly stackBehind: readonly [number, number];
  readonly positions: readonly ["out-of-position", "in-position"];
  readonly actionOrder: readonly [0, 1];
  readonly openingBetSizes: readonly number[];
  readonly raiseToSizes: readonly number[];
  readonly maxRaises: 1;
}

export interface ConfigurableRiverLimits {
  readonly maxRangeEntriesPerPlayer: number;
  readonly maxCompatibleDeals: number;
  readonly maxProjectedStates: number;
}

export const DEFAULT_CONFIGURABLE_RIVER_LIMITS: ConfigurableRiverLimits = {
  maxRangeEntriesPerPlayer: 128,
  maxCompatibleDeals: 500,
  maxProjectedStates: 50_000,
};

export interface ConfigurableRiverDeal {
  readonly hands: readonly [RiverCombo, RiverCombo];
}

export interface ConfigurableRiverPublicState {
  readonly actingPlayer: SolverPlayer | null;
  readonly streetContributions: readonly [number, number];
  readonly currentBet: number;
  readonly lastAggressor: SolverPlayer | null;
  readonly lastFullRaise: number;
  readonly raisesUsed: 0 | 1;
  readonly consecutiveChecks: 0 | 1;
  readonly terminal: "fold" | "showdown" | null;
  readonly foldedPlayer: SolverPlayer | null;
  readonly history: readonly ConfigurableRiverAction[];
}

export interface ConfigurableRiverState {
  readonly hands: readonly [RiverCombo, RiverCombo] | null;
  readonly public: ConfigurableRiverPublicState;
}

export interface ConfigurableRiverPreflight {
  readonly rangeEntries: readonly [number, number];
  readonly compatibleDeals: number;
  readonly publicStatesPerDeal: number;
  readonly publicTerminalStatesPerDeal: number;
  readonly projectedFullStates: number;
  readonly projectedTerminalStates: number;
  readonly roughTreeMemoryBytes: number;
  readonly limits: ConfigurableRiverLimits;
}

export interface ConfigurableRiverSettlement {
  readonly contributions: readonly [number, number];
  readonly returnedUncalled: readonly [number, number];
  readonly contestablePot: number;
  readonly winners: readonly SolverPlayer[];
  readonly awards: readonly [number, number];
  readonly utility: Utility;
}

export interface ConfigurableRiverGame extends ExtensiveFormGame<
  ConfigurableRiverState,
  ConfigurableRiverAction,
  ConfigurableRiverDeal
> {
  readonly scenario: ConfigurableRiverScenario;
  readonly deals: readonly Weighted<ConfigurableRiverDeal>[];
  readonly preflight: ConfigurableRiverPreflight;
  legalActions(publicState: ConfigurableRiverPublicState): readonly ConfigurableRiverAction[];
  totalContributions(state: ConfigurableRiverState): readonly [number, number];
  toCall(state: ConfigurableRiverState, player: SolverPlayer): number;
  showdownWinner(hands: readonly [RiverCombo, RiverCombo]): SolverPlayer | null;
  settlement(state: ConfigurableRiverState): ConfigurableRiverSettlement;
}

function assertPositiveWhole(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number of chips; received ${value}`);
  }
}

function sortedUniquePositive(values: readonly number[], label: string): readonly number[] {
  if (values.length === 0) throw new Error(`${label} cannot be empty`);
  values.forEach(value => assertPositiveWhole(value, label));
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate amounts`);
  return [...values].sort((left, right) => left - right);
}

function validateRange(
  range: readonly ConfigurableRiverRangeEntry[],
  board: readonly RiverCard[],
  player: SolverPlayer,
  limit: number,
): readonly ConfigurableRiverRangeEntry[] {
  if (range.length === 0) throw new Error(`Player ${player} range is empty`);
  const boardCards = new Set(board);
  const seen = new Set<string>();
  const valid: ConfigurableRiverRangeEntry[] = [];
  for (const entry of range) {
    const cards = canonicalRiverCombo(entry.cards);
    const key = riverComboKey(cards);
    if (seen.has(key)) throw new Error(`Player ${player} range repeats combo ${key}`);
    seen.add(key);
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      throw new Error(`Player ${player} range combo ${key} has invalid weight ${entry.weight}`);
    }
    if (cards.some(card => boardCards.has(card))) continue;
    valid.push({ cards, weight: entry.weight });
  }
  if (valid.length === 0) throw new Error(`Player ${player} range is empty after board blockers`);
  if (valid.length > limit) {
    throw new Error(`Player ${player} range has ${valid.length} entries; exact limit is ${limit}`);
  }
  return valid.sort((left, right) => riverComboKey(left.cards).localeCompare(riverComboKey(right.cards)));
}

function normalizeLimits(input: Partial<ConfigurableRiverLimits> = {}): ConfigurableRiverLimits {
  const limits = { ...DEFAULT_CONFIGURABLE_RIVER_LIMITS, ...input };
  Object.entries(limits).forEach(([label, value]) => assertPositiveWhole(value, label));
  return limits;
}

function validateScenario(
  input: ConfigurableRiverScenario,
  limits: ConfigurableRiverLimits,
): ConfigurableRiverScenario {
  if (!input.id || !/^[a-z0-9-]+$/.test(input.id)) throw new Error(`Invalid river scenario id ${input.id}`);
  if (input.version !== 2) throw new Error(`Unsupported configurable river version ${input.version}`);
  if (input.board.length !== 5) throw new Error(`A river board needs five cards; received ${input.board.length}`);
  assertDistinctRiverCards(input.board, "Configurable river board");
  input.committed.forEach((value, player) => assertPositiveWhole(value, `Player ${player} committed chips`));
  input.stackBehind.forEach((value, player) => assertPositiveWhole(value, `Player ${player} stack`));
  if (input.committed[0] !== input.committed[1]) {
    throw new Error("Configurable river requires equal chips committed before the closed river round");
  }
  if (input.positions.join(",") !== "out-of-position,in-position" || input.actionOrder.join(",") !== "0,1") {
    throw new Error("Configurable river requires player 0 out of position and player 1 in position");
  }
  if (input.maxRaises !== 1) throw new Error("Configurable river v2 allows exactly one raise");
  const openingBetSizes = sortedUniquePositive(input.openingBetSizes, "Opening bet sizes");
  const raiseToSizes = sortedUniquePositive(input.raiseToSizes, "Raise-to sizes");
  if (!openingBetSizes.some(size => input.stackBehind.some(stack => size <= stack))) {
    throw new Error("No configured opening bet fits either player's river stack");
  }
  return {
    ...input,
    board: [...input.board],
    ranges: [
      validateRange(input.ranges[0], input.board, 0, limits.maxRangeEntriesPerPlayer),
      validateRange(input.ranges[1], input.board, 1, limits.maxRangeEntriesPerPlayer),
    ],
    committed: [...input.committed],
    stackBehind: [...input.stackBehind],
    positions: [...input.positions],
    actionOrder: [...input.actionOrder],
    openingBetSizes,
    raiseToSizes,
  };
}

function buildDeals(scenario: ConfigurableRiverScenario): readonly Weighted<ConfigurableRiverDeal>[] {
  const compatible: { hands: readonly [RiverCombo, RiverCombo]; weight: number }[] = [];
  for (const left of scenario.ranges[0]) {
    for (const right of scenario.ranges[1]) {
      if (riverCombosOverlap(left.cards, right.cards)) continue;
      compatible.push({ hands: [left.cards, right.cards], weight: left.weight * right.weight });
    }
  }
  const total = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Configurable river ranges contain no compatible private-hand pairs");
  }
  return compatible.map(deal => ({
    outcome: { hands: deal.hands },
    probability: deal.weight / total,
  }));
}

function initialPublicState(): ConfigurableRiverPublicState {
  return {
    actingPlayer: 0,
    streetContributions: [0, 0],
    currentBet: 0,
    lastAggressor: null,
    lastFullRaise: 0,
    raisesUsed: 0,
    consecutiveChecks: 0,
    terminal: null,
    foldedPlayer: null,
    history: [],
  };
}

function amountFromAction(action: ConfigurableRiverAction, prefix: "bet-to-" | "raise-to-"): number {
  if (!action.startsWith(prefix)) throw new Error(`Action ${action} does not start with ${prefix}`);
  const amount = Number(action.slice(prefix.length));
  assertPositiveWhole(amount, `Action ${action}`);
  return amount;
}

function legalActionsFor(
  state: ConfigurableRiverPublicState,
  scenario: ConfigurableRiverScenario,
): readonly ConfigurableRiverAction[] {
  const player = state.actingPlayer;
  if (player === null || state.terminal) return [];
  const opponent = (1 - player) as SolverPlayer;
  const contribution = state.streetContributions[player];
  const stack = scenario.stackBehind[player];
  // Chips above what the opponent can ever match are returned uncalled, so any legal
  // target above the opponent's stack is payoff-identical to putting them all-in.
  // Collapse those targets into one effective all-in instead of duplicate actions.
  const opponentStack = scenario.stackBehind[opponent];
  if (state.currentBet === 0) {
    const bets = scenario.openingBetSizes
      .filter(amount => amount > 0 && amount <= stack)
      .map(amount => Math.min(amount, opponentStack));
    return ["check", ...[...new Set(bets)].map(amount => `bet-to-${amount}` as const)];
  }

  const actions: ConfigurableRiverAction[] = ["fold", "call"];
  const opponentCanAnswer = state.streetContributions[opponent] < opponentStack;
  if (state.raisesUsed === 0 && opponentCanAnswer) {
    for (const target of scenario.raiseToSizes) {
      if (target <= state.currentBet || target > stack || target <= contribution) continue;
      const increase = target - state.currentBet;
      const fullRaise = increase >= state.lastFullRaise;
      const shortAllIn = target === stack;
      const action = `raise-to-${Math.min(target, opponentStack)}` as const;
      if ((fullRaise || shortAllIn) && !actions.includes(action)) actions.push(action);
    }
  }
  return actions;
}

function advancePublicState(
  state: ConfigurableRiverPublicState,
  action: ConfigurableRiverAction,
  scenario: ConfigurableRiverScenario,
): ConfigurableRiverPublicState {
  const player = state.actingPlayer;
  if (player === null || state.terminal) throw new Error(`Cannot play ${action} after the river ended`);
  if (!legalActionsFor(state, scenario).includes(action)) {
    throw new Error(`Illegal river action ${action} after ${state.history.join("-") || "start"}`);
  }
  const opponent = (1 - player) as SolverPlayer;
  const contributions = [...state.streetContributions] as [number, number];
  const history = [...state.history, action];

  if (action === "check") {
    if (state.consecutiveChecks === 1) {
      return { ...state, actingPlayer: null, consecutiveChecks: 1, terminal: "showdown", history };
    }
    return { ...state, actingPlayer: opponent, consecutiveChecks: 1, history };
  }

  if (action.startsWith("bet-to-")) {
    const amount = amountFromAction(action, "bet-to-");
    contributions[player] = amount;
    return {
      ...state,
      actingPlayer: opponent,
      streetContributions: contributions,
      currentBet: amount,
      lastAggressor: player,
      lastFullRaise: amount,
      consecutiveChecks: 0,
      history,
    };
  }

  if (action === "fold") {
    return { ...state, actingPlayer: null, terminal: "fold", foldedPlayer: player, history };
  }

  if (action === "call") {
    contributions[player] = Math.min(state.currentBet, scenario.stackBehind[player]);
    return {
      ...state,
      actingPlayer: null,
      streetContributions: contributions,
      terminal: "showdown",
      history,
    };
  }

  const target = amountFromAction(action, "raise-to-");
  const increase = target - state.currentBet;
  contributions[player] = target;
  return {
    ...state,
    actingPlayer: opponent,
    streetContributions: contributions,
    currentBet: target,
    lastAggressor: player,
    lastFullRaise: increase >= state.lastFullRaise ? increase : state.lastFullRaise,
    raisesUsed: 1,
    consecutiveChecks: 0,
    history,
  };
}

function publicTreeCounts(scenario: ConfigurableRiverScenario): {
  readonly states: number;
  readonly terminals: number;
} {
  let states = 0;
  let terminals = 0;
  const visit = (state: ConfigurableRiverPublicState): void => {
    states += 1;
    if (state.terminal) {
      terminals += 1;
      return;
    }
    for (const action of legalActionsFor(state, scenario)) {
      visit(advancePublicState(state, action, scenario));
    }
  };
  visit(initialPublicState());
  return { states, terminals };
}

function createPreflight(
  scenario: ConfigurableRiverScenario,
  deals: readonly Weighted<ConfigurableRiverDeal>[],
  limits: ConfigurableRiverLimits,
): ConfigurableRiverPreflight {
  const publicTree = publicTreeCounts(scenario);
  const projectedFullStates = 1 + deals.length * publicTree.states;
  const projectedTerminalStates = deals.length * publicTree.terminals;
  const preflight: ConfigurableRiverPreflight = {
    rangeEntries: [scenario.ranges[0].length, scenario.ranges[1].length],
    compatibleDeals: deals.length,
    publicStatesPerDeal: publicTree.states,
    publicTerminalStatesPerDeal: publicTree.terminals,
    projectedFullStates,
    projectedTerminalStates,
    roughTreeMemoryBytes: projectedFullStates * 256,
    limits,
  };
  if (deals.length > limits.maxCompatibleDeals) {
    throw new Error(
      `Configurable river has ${deals.length} compatible deals; exact limit is ${limits.maxCompatibleDeals}`,
    );
  }
  if (projectedFullStates > limits.maxProjectedStates) {
    throw new Error(
      `Configurable river projects ${projectedFullStates} full states; exact limit is ${limits.maxProjectedStates}`,
    );
  }
  return preflight;
}

function dealKey(hands: readonly [RiverCombo, RiverCombo]): string {
  return `${riverComboKey(hands[0])}|${riverComboKey(hands[1])}`;
}

export function createConfigurableRiverGame(
  input: ConfigurableRiverScenario,
  limitOverrides: Partial<ConfigurableRiverLimits> = {},
): ConfigurableRiverGame {
  const limits = normalizeLimits(limitOverrides);
  const scenario = validateScenario(input, limits);
  const deals = buildDeals(scenario);
  const preflight = createPreflight(scenario, deals, limits);
  const dealKeys = new Set(deals.map(deal => dealKey(deal.outcome.hands)));

  const game: ConfigurableRiverGame = {
    id: scenario.id,
    scenario,
    deals,
    preflight,
    initialState: () => ({ hands: null, public: initialPublicState() }),
    node(state): GameNode<ConfigurableRiverAction, ConfigurableRiverDeal> {
      if (!state.hands) {
        if (state.public.history.length > 0) throw new Error("Undealt configurable river has actions");
        return { kind: "chance", outcomes: deals };
      }
      if (state.public.terminal) return { kind: "terminal", utility: game.settlement(state).utility };
      if (state.public.actingPlayer === null) throw new Error("Non-terminal configurable river has no actor");
      return {
        kind: "player",
        player: state.public.actingPlayer,
        actions: legalActionsFor(state.public, scenario),
      };
    },
    nextChance(state, outcome): ConfigurableRiverState {
      if (game.node(state).kind !== "chance") throw new Error("Cannot deal at a non-chance river node");
      const hands = [canonicalRiverCombo(outcome.hands[0]), canonicalRiverCombo(outcome.hands[1])] as const;
      if (!dealKeys.has(dealKey(hands))) throw new Error(`River deal ${dealKey(hands)} is outside the ranges`);
      return { hands, public: initialPublicState() };
    },
    nextAction(state, action): ConfigurableRiverState {
      const node = game.node(state);
      if (node.kind !== "player") throw new Error(`Cannot play ${action} at a ${node.kind} river node`);
      if (!node.actions.includes(action)) {
        throw new Error(`Illegal river action ${action} after ${state.public.history.join("-") || "start"}`);
      }
      return { hands: state.hands, public: advancePublicState(state.public, action, scenario) };
    },
    informationSet(state, player): string {
      const node = game.node(state);
      if (node.kind !== "player" || node.player !== player || !state.hands) {
        throw new Error(`Player ${player} does not act in this configurable river state`);
      }
      const view = state.public;
      return `${scenario.id}:v${scenario.version}:p${player}:hand=${riverComboKey(state.hands[player])}:` +
        `put=${view.streetContributions.join(",")}:bet=${view.currentBet}:last=${view.lastFullRaise}:` +
        `raises=${view.raisesUsed}:checks=${view.consecutiveChecks}:` +
        `history=${view.history.join("-") || "start"}`;
    },
    legalActions: state => legalActionsFor(state, scenario),
    totalContributions(state): readonly [number, number] {
      return [
        scenario.committed[0] + state.public.streetContributions[0],
        scenario.committed[1] + state.public.streetContributions[1],
      ];
    },
    toCall(state, player): number {
      return Math.max(0, state.public.currentBet - state.public.streetContributions[player]);
    },
    showdownWinner(hands): SolverPlayer | null {
      const left = riverHandScore(hands[0], scenario.board);
      const right = riverHandScore(hands[1], scenario.board);
      return left === right ? null : left > right ? 0 : 1;
    },
    settlement(state): ConfigurableRiverSettlement {
      if (!state.hands || !state.public.terminal) throw new Error("Cannot settle an unfinished river state");
      const contributions = game.totalContributions(state);
      const returned: [number, number] = [0, 0];
      if (contributions[0] > contributions[1]) returned[0] = contributions[0] - contributions[1];
      else if (contributions[1] > contributions[0]) returned[1] = contributions[1] - contributions[0];
      const contestablePot = contributions[0] + contributions[1] - returned[0] - returned[1];
      let winners: readonly SolverPlayer[];
      if (state.public.terminal === "fold") {
        if (state.public.foldedPlayer === null) throw new Error("Fold terminal has no folded player");
        winners = [(1 - state.public.foldedPlayer) as SolverPlayer];
      } else {
        const winner = game.showdownWinner(state.hands);
        winners = winner === null ? [0, 1] : [winner];
      }
      const share = contestablePot / winners.length;
      const awards: [number, number] = [
        returned[0] + (winners.includes(0) ? share : 0),
        returned[1] + (winners.includes(1) ? share : 0),
      ];
      const utility: Utility = [awards[0] - contributions[0], awards[1] - contributions[1]];
      return {
        contributions,
        returnedUncalled: returned,
        contestablePot,
        winners,
        awards,
        utility,
      };
    },
  };
  return game;
}

export function configurableRiverState(
  game: ConfigurableRiverGame,
  hands: readonly [RiverCombo, RiverCombo],
  history: readonly ConfigurableRiverAction[] = [],
): ConfigurableRiverState {
  let state = game.nextChance(game.initialState(), { hands });
  for (const action of history) state = game.nextAction(state, action);
  return state;
}
