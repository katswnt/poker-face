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
import type { ConfigurableRiverAction } from "../configurable/game";
import type { ConfigurableRiverRangeEntry } from "../configurable/range";

export const CONFIGURABLE_RIVER_V3_RULES_VERSION = 3;

export interface ConfigurableRiverV3Scenario {
  readonly id: string;
  readonly version: 3;
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
  readonly maxRaises: 0 | 1 | 2;
}

export interface ConfigurableRiverV3Limits {
  readonly maxRangeEntriesPerPlayer: number;
  readonly maxCompatibleDeals: number;
  readonly maxProjectedStates: number;
  readonly maxOpeningBetSizes: number;
  readonly maxRaiseToSizes: number;
  readonly maxRaises: number;
}

export const DEFAULT_CONFIGURABLE_RIVER_V3_LIMITS: ConfigurableRiverV3Limits = {
  maxRangeEntriesPerPlayer: 128,
  maxCompatibleDeals: 15_000,
  maxProjectedStates: 1_000_000,
  maxOpeningBetSizes: 5,
  maxRaiseToSizes: 5,
  maxRaises: 2,
};

export interface ConfigurableRiverV3Deal {
  readonly hands: readonly [RiverCombo, RiverCombo];
}

export interface ConfigurableRiverV3PublicState {
  readonly actingPlayer: SolverPlayer | null;
  readonly streetContributions: readonly [number, number];
  readonly currentBet: number;
  readonly lastAggressor: SolverPlayer | null;
  readonly lastFullRaise: number;
  readonly raisesUsed: number;
  readonly consecutiveChecks: 0 | 1;
  readonly terminal: "fold" | "showdown" | null;
  readonly foldedPlayer: SolverPlayer | null;
  readonly history: readonly ConfigurableRiverAction[];
}

export interface ConfigurableRiverV3State {
  readonly hands: readonly [RiverCombo, RiverCombo] | null;
  readonly public: ConfigurableRiverV3PublicState;
}

export interface ConfigurableRiverV3Preflight {
  readonly rangeEntries: readonly [number, number];
  readonly compatibleDeals: number;
  readonly publicStatesPerDeal: number;
  readonly publicDecisionStatesPerDeal: number;
  readonly publicTerminalStatesPerDeal: number;
  readonly projectedFullStates: number;
  readonly projectedDecisionStates: number;
  readonly projectedTerminalStates: number;
  readonly roughRepeatedTreeMemoryBytes: number;
  readonly limits: ConfigurableRiverV3Limits;
}

export interface ConfigurableRiverV3Settlement {
  readonly contributions: readonly [number, number];
  readonly returnedUncalled: readonly [number, number];
  readonly contestablePot: number;
  readonly winners: readonly SolverPlayer[];
  readonly awards: readonly [number, number];
  readonly utility: Utility;
}

export interface ConfigurableRiverV3Game extends ExtensiveFormGame<
  ConfigurableRiverV3State,
  ConfigurableRiverAction,
  ConfigurableRiverV3Deal
> {
  readonly scenario: ConfigurableRiverV3Scenario;
  readonly deals: readonly Weighted<ConfigurableRiverV3Deal>[];
  readonly preflight: ConfigurableRiverV3Preflight;
  legalActions(publicState: ConfigurableRiverV3PublicState): readonly ConfigurableRiverAction[];
  totalContributions(state: ConfigurableRiverV3State): readonly [number, number];
  toCall(state: ConfigurableRiverV3State, player: SolverPlayer): number;
  showdownWinner(hands: readonly [RiverCombo, RiverCombo]): SolverPlayer | null;
  settlement(state: ConfigurableRiverV3State): ConfigurableRiverV3Settlement;
}

function assertPositiveWhole(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number; received ${value}`);
  }
}

function sortedUniquePositive(
  values: readonly number[],
  label: string,
  maximumCount: number,
): readonly number[] {
  if (values.length === 0) throw new Error(`${label} cannot be empty`);
  if (values.length > maximumCount) {
    throw new Error(`${label} has ${values.length} amounts; v3 limit is ${maximumCount}`);
  }
  values.forEach(value => assertPositiveWhole(value, label));
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate amounts`);
  return [...values].sort((left, right) => left - right);
}

function normalizeLimits(
  input: Partial<ConfigurableRiverV3Limits> = {},
): ConfigurableRiverV3Limits {
  const limits = { ...DEFAULT_CONFIGURABLE_RIVER_V3_LIMITS, ...input };
  Object.entries(limits).forEach(([label, value]) => assertPositiveWhole(value, label));
  if (limits.maxRaises > 2) throw new Error(`v3 maxRaises limit cannot exceed 2; received ${limits.maxRaises}`);
  return limits;
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
    throw new Error(`Player ${player} range has ${valid.length} entries; v3 limit is ${limit}`);
  }
  return valid.sort((left, right) => riverComboKey(left.cards).localeCompare(riverComboKey(right.cards)));
}

function validateScenario(
  input: ConfigurableRiverV3Scenario,
  limits: ConfigurableRiverV3Limits,
): ConfigurableRiverV3Scenario {
  if (!input.id || !/^[a-z0-9-]+$/.test(input.id)) throw new Error(`Invalid river v3 id ${input.id}`);
  if (input.version !== 3) throw new Error(`Unsupported configurable river version ${input.version}`);
  if (input.board.length !== 5) throw new Error(`A river board needs five cards; got ${input.board.length}`);
  assertDistinctRiverCards(input.board, "Configurable river v3 board");
  input.committed.forEach((value, player) => assertPositiveWhole(value, `Player ${player} committed chips`));
  input.stackBehind.forEach((value, player) => assertPositiveWhole(value, `Player ${player} river stack`));
  if (input.committed[0] !== input.committed[1]) {
    throw new Error("Configurable river v3 requires equal chips committed before the river round");
  }
  if (input.positions.join(",") !== "out-of-position,in-position" || input.actionOrder.join(",") !== "0,1") {
    throw new Error("Configurable river v3 requires player 0 out of position and player 1 in position");
  }
  if (!Number.isSafeInteger(input.maxRaises) || input.maxRaises < 0 || input.maxRaises > limits.maxRaises) {
    throw new Error(`River v3 maxRaises ${input.maxRaises} exceeds the limit ${limits.maxRaises}`);
  }
  const openingBetSizes = sortedUniquePositive(
    input.openingBetSizes,
    "Opening bet sizes",
    limits.maxOpeningBetSizes,
  );
  const raiseToSizes = sortedUniquePositive(
    input.raiseToSizes,
    "Raise-to sizes",
    limits.maxRaiseToSizes,
  );
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

function buildDeals(
  scenario: ConfigurableRiverV3Scenario,
): readonly Weighted<ConfigurableRiverV3Deal>[] {
  const compatible: { hands: readonly [RiverCombo, RiverCombo]; weight: number }[] = [];
  for (const left of scenario.ranges[0]) {
    for (const right of scenario.ranges[1]) {
      if (riverCombosOverlap(left.cards, right.cards)) continue;
      compatible.push({ hands: [left.cards, right.cards], weight: left.weight * right.weight });
    }
  }
  const total = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Configurable river v3 ranges have no compatible private-hand pairs");
  }
  return compatible.map(deal => ({
    outcome: { hands: deal.hands },
    probability: deal.weight / total,
  }));
}

function initialPublicState(): ConfigurableRiverV3PublicState {
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
  state: ConfigurableRiverV3PublicState,
  scenario: ConfigurableRiverV3Scenario,
): readonly ConfigurableRiverAction[] {
  const player = state.actingPlayer;
  if (player === null || state.terminal) return [];
  const opponent = (1 - player) as SolverPlayer;
  const contribution = state.streetContributions[player];
  const stack = scenario.stackBehind[player];
  if (state.currentBet === 0) {
    return [
      "check",
      ...scenario.openingBetSizes
        .filter(amount => amount <= stack)
        .map(amount => `bet-to-${amount}` as const),
    ];
  }

  const actions: ConfigurableRiverAction[] = ["fold", "call"];
  const opponentCanAnswer = state.streetContributions[opponent] < scenario.stackBehind[opponent];
  if (state.raisesUsed >= scenario.maxRaises || !opponentCanAnswer) return actions;
  for (const target of scenario.raiseToSizes) {
    if (target <= state.currentBet || target > stack || target <= contribution) continue;
    const increase = target - state.currentBet;
    const fullRaise = increase >= state.lastFullRaise;
    const shortAllIn = target === stack;
    if (fullRaise || shortAllIn) actions.push(`raise-to-${target}`);
  }
  return actions;
}

function advancePublicState(
  state: ConfigurableRiverV3PublicState,
  action: ConfigurableRiverAction,
  scenario: ConfigurableRiverV3Scenario,
): ConfigurableRiverV3PublicState {
  const player = state.actingPlayer;
  if (player === null || state.terminal) throw new Error(`Cannot play ${action} after the river ended`);
  if (!legalActionsFor(state, scenario).includes(action)) {
    throw new Error(`Illegal river v3 action ${action} after ${state.history.join("-") || "start"}`);
  }
  const opponent = (1 - player) as SolverPlayer;
  const contributions = [...state.streetContributions] as [number, number];
  const history = [...state.history, action];

  if (action === "check") {
    if (state.consecutiveChecks === 1) {
      return { ...state, actingPlayer: null, terminal: "showdown", history };
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
    raisesUsed: state.raisesUsed + 1,
    consecutiveChecks: 0,
    history,
  };
}

function publicTreeCounts(scenario: ConfigurableRiverV3Scenario) {
  let states = 0;
  let decisions = 0;
  let terminals = 0;
  const visit = (state: ConfigurableRiverV3PublicState): void => {
    states += 1;
    if (state.terminal) {
      terminals += 1;
      return;
    }
    decisions += 1;
    for (const action of legalActionsFor(state, scenario)) {
      visit(advancePublicState(state, action, scenario));
    }
  };
  visit(initialPublicState());
  return { states, decisions, terminals };
}

function createPreflight(
  scenario: ConfigurableRiverV3Scenario,
  deals: readonly Weighted<ConfigurableRiverV3Deal>[],
  limits: ConfigurableRiverV3Limits,
): ConfigurableRiverV3Preflight {
  if (deals.length > limits.maxCompatibleDeals) {
    throw new Error(`River v3 has ${deals.length} compatible deals; limit is ${limits.maxCompatibleDeals}`);
  }
  const publicTree = publicTreeCounts(scenario);
  const projectedFullStates = 1 + deals.length * publicTree.states;
  const projectedDecisionStates = deals.length * publicTree.decisions;
  const projectedTerminalStates = deals.length * publicTree.terminals;
  if (projectedFullStates > limits.maxProjectedStates) {
    throw new Error(
      `River v3 projects ${projectedFullStates} repeated states; limit is ${limits.maxProjectedStates}`,
    );
  }
  return {
    rangeEntries: [scenario.ranges[0].length, scenario.ranges[1].length],
    compatibleDeals: deals.length,
    publicStatesPerDeal: publicTree.states,
    publicDecisionStatesPerDeal: publicTree.decisions,
    publicTerminalStatesPerDeal: publicTree.terminals,
    projectedFullStates,
    projectedDecisionStates,
    projectedTerminalStates,
    roughRepeatedTreeMemoryBytes: projectedFullStates * 256,
    limits,
  };
}

function dealKey(hands: readonly [RiverCombo, RiverCombo]): string {
  return `${riverComboKey(hands[0])}|${riverComboKey(hands[1])}`;
}

export function createConfigurableRiverV3Game(
  input: ConfigurableRiverV3Scenario,
  limitOverrides: Partial<ConfigurableRiverV3Limits> = {},
): ConfigurableRiverV3Game {
  const limits = normalizeLimits(limitOverrides);
  const scenario = validateScenario(input, limits);
  const deals = buildDeals(scenario);
  const preflight = createPreflight(scenario, deals, limits);
  const dealKeys = new Set(deals.map(deal => dealKey(deal.outcome.hands)));

  const game: ConfigurableRiverV3Game = {
    id: scenario.id,
    scenario,
    deals,
    preflight,
    initialState: () => ({ hands: null, public: initialPublicState() }),
    node(state): GameNode<ConfigurableRiverAction, ConfigurableRiverV3Deal> {
      if (!state.hands) {
        if (state.public.history.length > 0) throw new Error("Undealt river v3 state has actions");
        return { kind: "chance", outcomes: deals };
      }
      if (state.public.terminal) return { kind: "terminal", utility: game.settlement(state).utility };
      if (state.public.actingPlayer === null) throw new Error("Live river v3 state has no actor");
      return {
        kind: "player",
        player: state.public.actingPlayer,
        actions: legalActionsFor(state.public, scenario),
      };
    },
    nextChance(state, outcome): ConfigurableRiverV3State {
      if (game.node(state).kind !== "chance") throw new Error("Cannot deal at a non-chance v3 node");
      const hands = [canonicalRiverCombo(outcome.hands[0]), canonicalRiverCombo(outcome.hands[1])] as const;
      if (!dealKeys.has(dealKey(hands))) throw new Error(`River v3 deal ${dealKey(hands)} is outside the ranges`);
      return { hands, public: initialPublicState() };
    },
    nextAction(state, action): ConfigurableRiverV3State {
      const node = game.node(state);
      if (node.kind !== "player") throw new Error(`Cannot play ${action} at a ${node.kind} v3 node`);
      if (!node.actions.includes(action)) throw new Error(`Illegal river v3 action ${action}`);
      return { hands: state.hands, public: advancePublicState(state.public, action, scenario) };
    },
    informationSet(state, player): string {
      const node = game.node(state);
      if (node.kind !== "player" || node.player !== player || !state.hands) {
        throw new Error(`Player ${player} does not act in this river v3 state`);
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
    settlement(state): ConfigurableRiverV3Settlement {
      if (!state.hands || !state.public.terminal) throw new Error("Cannot settle an unfinished river v3 state");
      const contributions = game.totalContributions(state);
      const returned: [number, number] = [
        Math.max(0, contributions[0] - contributions[1]),
        Math.max(0, contributions[1] - contributions[0]),
      ];
      const contestablePot = contributions[0] + contributions[1] - returned[0] - returned[1];
      let winners: readonly SolverPlayer[];
      if (state.public.terminal === "fold") {
        if (state.public.foldedPlayer === null) throw new Error("River v3 fold has no folded player");
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
      return {
        contributions,
        returnedUncalled: returned,
        contestablePot,
        winners,
        awards,
        utility: [awards[0] - contributions[0], awards[1] - contributions[1]],
      };
    },
  };
  return game;
}

export function configurableRiverV3State(
  game: ConfigurableRiverV3Game,
  hands: readonly [RiverCombo, RiverCombo],
  history: readonly ConfigurableRiverAction[] = [],
): ConfigurableRiverV3State {
  let state = game.nextChance(game.initialState(), { hands });
  for (const action of history) state = game.nextAction(state, action);
  return state;
}
