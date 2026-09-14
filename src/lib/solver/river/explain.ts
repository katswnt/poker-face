import {
  buildGameTreeIndex,
  validateStrategy,
  type BehavioralStrategy,
  type InformationSetKey,
  type SolverPlayer,
} from "../toy/game";
import { riverComboKey, type RiverCombo } from "./cards";
import {
  type RiverAction,
  type RiverGame,
  type RiverState,
} from "./game";

export interface RiverOpponentComboWeight {
  readonly cards: RiverCombo;
  readonly key: string;
  readonly probability: number | null;
}

export interface RiverOutcomeBreakdown {
  readonly playerFolds: number | null;
  readonly opponentFolds: number | null;
  readonly showdownWin: number | null;
  readonly showdownSplit: number | null;
  readonly showdownLoss: number | null;
}

export interface RiverResponseFrequency {
  readonly action: RiverAction;
  readonly probability: number | null;
}

export interface RiverActionFact {
  readonly action: RiverAction;
  readonly frequency: number;
  /** Net chips from the beginning of the hand. */
  readonly expectedValue: number | null;
  /** Chip change from this decision forward; previously committed chips are excluded. */
  readonly expectedAdditionalValue: number | null;
  readonly differenceFromBest: number | null;
  readonly immediateOpponentResponses: readonly RiverResponseFrequency[];
  readonly immediateOpponentFoldProbability: number | null;
  readonly outcomes: RiverOutcomeBreakdown;
  /** Pot share at showdowns only. Folds are excluded. */
  readonly showdownEquity: number | null;
}

export interface RiverDecisionFacts {
  readonly informationSet: InformationSetKey;
  readonly player: SolverPlayer;
  readonly position: "out-of-position" | "in-position";
  readonly privateCards: RiverCombo;
  readonly history: readonly RiverAction[];
  readonly contributions: readonly [number, number];
  readonly pot: number;
  readonly toCall: number;
  /** Chance plus both saved strategies reaching this information set. */
  readonly reachProbability: number;
  readonly offPath: boolean;
  readonly opponentRange: readonly RiverOpponentComboWeight[];
  readonly actions: readonly RiverActionFact[];
}

interface ReachedState {
  readonly state: RiverState;
  readonly probability: number;
}

interface ContinuationSummary {
  readonly expectedValue: number;
  readonly playerFolds: number;
  readonly opponentFolds: number;
  readonly showdownWin: number;
  readonly showdownSplit: number;
  readonly showdownLoss: number;
}

const OFF_PATH_TOLERANCE = 1e-12;
const PROBABILITY_TOLERANCE = 1e-10;

function strategyEntry(
  strategy: BehavioralStrategy<RiverAction>,
  key: InformationSetKey,
) {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing river strategy at ${key}`);
  return entry;
}

function stateKey(state: RiverState): string {
  const hands = state.hands
    ? `${riverComboKey(state.hands[0])}|${riverComboKey(state.hands[1])}`
    : "-";
  return `${hands}|${state.history.join(",")}`;
}

function zeroSummary(): ContinuationSummary {
  return {
    expectedValue: 0,
    playerFolds: 0,
    opponentFolds: 0,
    showdownWin: 0,
    showdownSplit: 0,
    showdownLoss: 0,
  };
}

function addWeighted(
  total: ContinuationSummary,
  value: ContinuationSummary,
  weight: number,
): ContinuationSummary {
  return {
    expectedValue: total.expectedValue + weight * value.expectedValue,
    playerFolds: total.playerFolds + weight * value.playerFolds,
    opponentFolds: total.opponentFolds + weight * value.opponentFolds,
    showdownWin: total.showdownWin + weight * value.showdownWin,
    showdownSplit: total.showdownSplit + weight * value.showdownSplit,
    showdownLoss: total.showdownLoss + weight * value.showdownLoss,
  };
}

function outcomeMass(summary: ContinuationSummary): number {
  return summary.playerFolds + summary.opponentFolds + summary.showdownWin +
    summary.showdownSplit + summary.showdownLoss;
}

function terminalSummary(
  game: RiverGame,
  state: RiverState,
  player: SolverPlayer,
): ContinuationSummary {
  const node = game.node(state);
  if (node.kind !== "terminal") throw new Error("Expected a terminal river state");
  const summary = { ...zeroSummary(), expectedValue: node.utility[player] };
  if (state.history.at(-1) === "fold") {
    return node.utility[player] > 0
      ? { ...summary, opponentFolds: 1 }
      : { ...summary, playerFolds: 1 };
  }
  if (!state.hands) throw new Error("A river showdown requires private hands");
  const winner = game.showdownWinner(state.hands);
  if (winner === null) return { ...summary, showdownSplit: 1 };
  return winner === player
    ? { ...summary, showdownWin: 1 }
    : { ...summary, showdownLoss: 1 };
}

function createContinuationEvaluator(
  game: RiverGame,
  strategy: BehavioralStrategy<RiverAction>,
) {
  const cache = new Map<string, ContinuationSummary>();

  const evaluate = (state: RiverState, player: SolverPlayer): ContinuationSummary => {
    const cacheKey = `${player}|${stateKey(state)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const node = game.node(state);
    if (node.kind === "terminal") {
      const result = terminalSummary(game, state, player);
      cache.set(cacheKey, result);
      return result;
    }

    let result = zeroSummary();
    if (node.kind === "chance") {
      for (const { outcome, probability } of node.outcomes) {
        result = addWeighted(result, evaluate(game.nextChance(state, outcome), player), probability);
      }
    } else {
      const entry = strategyEntry(strategy, game.informationSet(state, node.player));
      for (let index = 0; index < node.actions.length; index += 1) {
        result = addWeighted(
          result,
          evaluate(game.nextAction(state, node.actions[index]), player),
          entry.probabilities[index],
        );
      }
    }

    if (Math.abs(outcomeMass(result) - 1) > PROBABILITY_TOLERANCE) {
      throw new Error(`River continuation outcomes sum to ${outcomeMass(result)}, not 1`);
    }
    cache.set(cacheKey, result);
    return result;
  };
  return evaluate;
}

function nullOutcomes(): RiverOutcomeBreakdown {
  return {
    playerFolds: null,
    opponentFolds: null,
    showdownWin: null,
    showdownSplit: null,
    showdownLoss: null,
  };
}

function assertSamePublicState(game: RiverGame, states: readonly ReachedState[]): void {
  const first = states[0].state;
  const firstContributions = game.totalContributions(first);
  for (const reached of states.slice(1)) {
    const contributions = game.totalContributions(reached.state);
    if (
      reached.state.history.join(",") !== first.history.join(",") ||
      contributions[0] !== firstContributions[0] ||
      contributions[1] !== firstContributions[1]
    ) {
      throw new Error("A river information set contains inconsistent public state");
    }
  }
}

function opponentResponses(
  game: RiverGame,
  strategy: BehavioralStrategy<RiverAction>,
  states: readonly ReachedState[],
  reachProbability: number,
  action: RiverAction,
): readonly RiverResponseFrequency[] {
  let responseActions: readonly RiverAction[] | null = null;
  let probabilities: number[] | null = null;
  for (const reached of states) {
    const child = game.nextAction(reached.state, action);
    const response = game.node(child);
    if (response.kind !== "player") continue;
    if (!responseActions) {
      responseActions = response.actions;
      probabilities = response.actions.map(() => 0);
    } else if (response.actions.join(",") !== responseActions.join(",")) {
      throw new Error(`River action ${action} has inconsistent response menus`);
    }
    const entry = strategyEntry(strategy, game.informationSet(child, response.player));
    for (let index = 0; index < response.actions.length; index += 1) {
      probabilities![index] += reached.probability / reachProbability * entry.probabilities[index];
    }
  }
  return responseActions?.map((response, index) => ({
    action: response,
    probability: probabilities![index],
  })) ?? [];
}

/**
 * Derive exact teaching inputs from a saved river strategy. These facts describe that
 * saved strategy; they do not claim its small residual CFR frequencies are exact GTO.
 */
export function riverDecisionFacts(
  game: RiverGame,
  strategy: BehavioralStrategy<RiverAction>,
): readonly RiverDecisionFacts[] {
  const index = buildGameTreeIndex(game);
  validateStrategy(index, strategy);
  const continuation = createContinuationEvaluator(game, strategy);
  const reachedStates = new Map<InformationSetKey, ReachedState[]>();

  const visit = (
    state: RiverState,
    chanceReach: number,
    reach0: number,
    reach1: number,
  ): void => {
    const node = game.node(state);
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      for (const { outcome, probability } of node.outcomes) {
        visit(game.nextChance(state, outcome), chanceReach * probability, reach0, reach1);
      }
      return;
    }
    const key = game.informationSet(state, node.player);
    const states = reachedStates.get(key) ?? [];
    states.push({ state, probability: chanceReach * reach0 * reach1 });
    reachedStates.set(key, states);

    const entry = strategyEntry(strategy, key);
    for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
      const probability = entry.probabilities[actionIndex];
      const child = game.nextAction(state, node.actions[actionIndex]);
      if (node.player === 0) visit(child, chanceReach, reach0 * probability, reach1);
      else visit(child, chanceReach, reach0, reach1 * probability);
    }
  };
  visit(game.initialState(), 1, 1, 1);

  return index.informationSets.map(definition => {
    const states = reachedStates.get(definition.key);
    if (!states || states.length === 0) throw new Error(`No river states found for ${definition.key}`);
    assertSamePublicState(game, states);
    const first = states[0].state;
    if (!first.hands) throw new Error(`Information set ${definition.key} has no private hands`);
    const player = definition.player;
    const opponent = (1 - player) as SolverPlayer;
    const reachProbability = states.reduce((sum, reached) => sum + reached.probability, 0);
    const offPath = reachProbability <= OFF_PATH_TOLERANCE;
    const entry = strategyEntry(strategy, definition.key);
    const contributions = game.totalContributions(first);

    const opponentWeights = new Map<string, number>(
      game.scenario.ranges[opponent].map(rangeEntry => [riverComboKey(rangeEntry.cards), 0]),
    );
    for (const reached of states) {
      if (!reached.state.hands) throw new Error(`Information set ${definition.key} has no private hands`);
      const key = riverComboKey(reached.state.hands[opponent]);
      opponentWeights.set(key, (opponentWeights.get(key) ?? 0) + reached.probability);
    }
    const opponentRange = game.scenario.ranges[opponent].map(rangeEntry => ({
      cards: rangeEntry.cards,
      key: riverComboKey(rangeEntry.cards),
      probability: offPath
        ? null
        : (opponentWeights.get(riverComboKey(rangeEntry.cards)) ?? 0) / reachProbability,
    }));

    const summaries = definition.actions.map(action => {
      if (offPath) return null;
      let summary = zeroSummary();
      for (const reached of states) {
        summary = addWeighted(
          summary,
          continuation(game.nextAction(reached.state, action), player),
          reached.probability / reachProbability,
        );
      }
      if (Math.abs(outcomeMass(summary) - 1) > PROBABILITY_TOLERANCE) {
        throw new Error(`River action outcomes sum to ${outcomeMass(summary)}, not 1`);
      }
      return summary;
    });
    const expectedValues = summaries.map(summary => summary?.expectedValue ?? null);
    const bestExpectedValue = offPath
      ? null
      : Math.max(...expectedValues.filter((value): value is number => value !== null));

    return {
      informationSet: definition.key,
      player,
      position: game.scenario.positions[player],
      privateCards: first.hands[player],
      history: [...first.history],
      contributions,
      pot: contributions[0] + contributions[1],
      toCall: Math.max(...contributions) - contributions[player],
      reachProbability,
      offPath,
      opponentRange,
      actions: definition.actions.map((action, actionIndex) => {
        const summary = summaries[actionIndex];
        const expectedValue = expectedValues[actionIndex];
        if (!summary || expectedValue === null || bestExpectedValue === null) {
          return {
            action,
            frequency: entry.probabilities[actionIndex],
            expectedValue: null,
            expectedAdditionalValue: null,
            differenceFromBest: null,
            immediateOpponentResponses: [],
            immediateOpponentFoldProbability: null,
            outcomes: nullOutcomes(),
            showdownEquity: null,
          };
        }
        const responses = opponentResponses(game, strategy, states, reachProbability, action);
        const fold = responses.find(response => response.action === "fold")?.probability ?? null;
        const showdownProbability = summary.showdownWin + summary.showdownSplit + summary.showdownLoss;
        return {
          action,
          frequency: entry.probabilities[actionIndex],
          expectedValue,
          expectedAdditionalValue: expectedValue + contributions[player],
          differenceFromBest: bestExpectedValue - expectedValue,
          immediateOpponentResponses: responses,
          immediateOpponentFoldProbability: fold,
          outcomes: {
            playerFolds: summary.playerFolds,
            opponentFolds: summary.opponentFolds,
            showdownWin: summary.showdownWin,
            showdownSplit: summary.showdownSplit,
            showdownLoss: summary.showdownLoss,
          },
          showdownEquity: showdownProbability <= OFF_PATH_TOLERANCE
            ? null
            : (summary.showdownWin + summary.showdownSplit / 2) / showdownProbability,
        };
      }),
    };
  });
}
