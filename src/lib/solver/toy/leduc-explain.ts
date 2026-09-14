import {
  buildGameTreeIndex,
  validateStrategy,
  type BehavioralStrategy,
  type InformationSetKey,
  type SolverPlayer,
} from "./game";
import {
  LEDUC_RANKS,
  leducContributions,
  leducGame,
  leducRank,
  leducShowdownWinner,
  type LeducAction,
  type LeducRank,
  type LeducRound,
  type LeducState,
} from "./leduc";

export interface LeducOpponentRankWeight {
  readonly rank: LeducRank;
  readonly probability: number | null;
}

/** Mutually exclusive ways a hand can end after the learner takes an action. */
export interface LeducOutcomeBreakdown {
  readonly playerFolds: number | null;
  readonly opponentFolds: number | null;
  readonly showdownWin: number | null;
  readonly showdownSplit: number | null;
  readonly showdownLoss: number | null;
}

export interface LeducActionFact {
  readonly action: LeducAction;
  readonly frequency: number;
  /** Net chips from the start of the hand, not the size of the final pot. */
  readonly expectedValue: number | null;
  /** Expected chip change from this decision forward; chips already committed are excluded. */
  readonly expectedAdditionalValue: number | null;
  readonly differenceFromBest: number | null;
  readonly immediateOpponentFoldProbability: number | null;
  readonly outcomes: LeducOutcomeBreakdown;
  /** Hero's pot share at showdowns only. Future folds are excluded. */
  readonly showdownEquity: number | null;
}

export interface LeducDecisionFacts {
  readonly informationSet: InformationSetKey;
  readonly player: SolverPlayer;
  readonly privateRank: LeducRank;
  readonly boardRank: LeducRank | null;
  readonly round: LeducRound;
  readonly firstRoundHistory: readonly LeducAction[];
  readonly secondRoundHistory: readonly LeducAction[];
  readonly contributions: readonly [number, number];
  readonly pot: number;
  readonly toCall: number;
  readonly betSize: 1 | 2;
  readonly handState: "private-card-only" | "pair" | "high-card";
  /** Probability that chance plus both saved strategies reach this information set. */
  readonly reachProbability: number;
  readonly offPath: boolean;
  readonly opponentRanks: readonly LeducOpponentRankWeight[];
  readonly actions: readonly LeducActionFact[];
}

interface ReachedState {
  readonly state: LeducState;
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
  strategy: BehavioralStrategy<LeducAction>,
  key: InformationSetKey,
) {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing Leduc strategy at ${key}`);
  return entry;
}

function stateKey(state: LeducState): string {
  const cards = state.privateCards?.join(",") ?? "-";
  return `${cards}|${state.board ?? "-"}|${state.round}|` +
    `${state.histories[0].join(",")}|${state.histories[1].join(",")}`;
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

function terminalSummary(state: LeducState, player: SolverPlayer): ContinuationSummary {
  const node = leducGame.node(state);
  if (node.kind !== "terminal") throw new Error("Expected a terminal Leduc state");
  const summary = { ...zeroSummary(), expectedValue: node.utility[player] };
  const history = state.histories[state.round];
  if (history.at(-1) === "fold") {
    return node.utility[player] > 0
      ? { ...summary, opponentFolds: 1 }
      : { ...summary, playerFolds: 1 };
  }
  if (!state.privateCards || !state.board) {
    throw new Error("A Leduc showdown requires private cards and a public card");
  }
  const winner = leducShowdownWinner(state.privateCards, state.board);
  if (winner === null) return { ...summary, showdownSplit: 1 };
  return winner === player
    ? { ...summary, showdownWin: 1 }
    : { ...summary, showdownLoss: 1 };
}

function createContinuationEvaluator(strategy: BehavioralStrategy<LeducAction>) {
  const cache = new Map<string, ContinuationSummary>();

  const evaluate = (state: LeducState, player: SolverPlayer): ContinuationSummary => {
    const cacheKey = `${player}|${stateKey(state)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const node = leducGame.node(state);
    if (node.kind === "terminal") {
      const result = terminalSummary(state, player);
      cache.set(cacheKey, result);
      return result;
    }

    let result = zeroSummary();
    if (node.kind === "chance") {
      for (const { outcome, probability } of node.outcomes) {
        result = addWeighted(
          result,
          evaluate(leducGame.nextChance(state, outcome), player),
          probability,
        );
      }
    } else {
      const key = leducGame.informationSet(state, node.player);
      const entry = strategyEntry(strategy, key);
      for (let index = 0; index < node.actions.length; index += 1) {
        result = addWeighted(
          result,
          evaluate(leducGame.nextAction(state, node.actions[index]), player),
          entry.probabilities[index],
        );
      }
    }

    if (Math.abs(outcomeMass(result) - 1) > PROBABILITY_TOLERANCE) {
      throw new Error(`Leduc continuation outcomes sum to ${outcomeMass(result)}, not 1`);
    }
    cache.set(cacheKey, result);
    return result;
  };

  return evaluate;
}

function immediateOpponentFoldProbability(
  state: LeducState,
  action: LeducAction,
  strategy: BehavioralStrategy<LeducAction>,
): number | null {
  if (action !== "bet" && action !== "raise") return null;
  const child = leducGame.nextAction(state, action);
  const response = leducGame.node(child);
  if (response.kind !== "player") {
    throw new Error(`Expected an opponent response after ${action}`);
  }
  const foldIndex = response.actions.indexOf("fold");
  if (foldIndex < 0) throw new Error(`Opponent cannot fold after ${action}`);
  const entry = strategyEntry(strategy, leducGame.informationSet(child, response.player));
  return entry.probabilities[foldIndex];
}

function assertSamePublicState(states: readonly ReachedState[]): void {
  const first = states[0].state;
  const firstContributions = leducContributions(first);
  for (const reached of states.slice(1)) {
    const state = reached.state;
    const contributions = leducContributions(state);
    const same = state.board === null
      ? first.board === null
      : first.board !== null && leducRank(state.board) === leducRank(first.board);
    if (
      !same || state.round !== first.round ||
      state.histories[0].join(",") !== first.histories[0].join(",") ||
      state.histories[1].join(",") !== first.histories[1].join(",") ||
      contributions[0] !== firstContributions[0] || contributions[1] !== firstContributions[1]
    ) {
      throw new Error("A Leduc information set contains inconsistent public state");
    }
  }
}

function nullOutcomes(): LeducOutcomeBreakdown {
  return {
    playerFolds: null,
    opponentFolds: null,
    showdownWin: null,
    showdownSplit: null,
    showdownLoss: null,
  };
}

/**
 * Build exact teaching inputs from a saved Leduc strategy.
 *
 * These values describe this saved strategy, not an assertion that every action is uniquely
 * optimal. Hidden physical card copies are summed into the ranks a learner can reason about.
 */
export function leducDecisionFacts(
  strategy: BehavioralStrategy<LeducAction>,
): readonly LeducDecisionFacts[] {
  const index = buildGameTreeIndex(leducGame);
  validateStrategy(index, strategy);
  const continuation = createContinuationEvaluator(strategy);
  const reachedStates = new Map<InformationSetKey, ReachedState[]>();

  const visit = (
    state: LeducState,
    chanceReach: number,
    reach0: number,
    reach1: number,
  ): void => {
    const node = leducGame.node(state);
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      for (const { outcome, probability } of node.outcomes) {
        visit(leducGame.nextChance(state, outcome), chanceReach * probability, reach0, reach1);
      }
      return;
    }

    const key = leducGame.informationSet(state, node.player);
    const probability = chanceReach * reach0 * reach1;
    const states = reachedStates.get(key) ?? [];
    states.push({ state, probability });
    reachedStates.set(key, states);

    const entry = strategyEntry(strategy, key);
    for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
      const actionProbability = entry.probabilities[actionIndex];
      const child = leducGame.nextAction(state, node.actions[actionIndex]);
      if (node.player === 0) {
        visit(child, chanceReach, reach0 * actionProbability, reach1);
      } else {
        visit(child, chanceReach, reach0, reach1 * actionProbability);
      }
    }
  };

  visit(leducGame.initialState(), 1, 1, 1);

  return index.informationSets.map(definition => {
    const states = reachedStates.get(definition.key);
    if (!states || states.length === 0) throw new Error(`No Leduc states found for ${definition.key}`);
    assertSamePublicState(states);
    const firstState = states[0].state;
    if (!firstState.privateCards) {
      throw new Error(`Information set ${definition.key} has no private cards`);
    }

    const player = definition.player;
    const reachProbability = states.reduce((sum, reached) => sum + reached.probability, 0);
    const offPath = reachProbability <= OFF_PATH_TOLERANCE;
    const entry = strategyEntry(strategy, definition.key);
    const contributions = leducContributions(firstState);
    const boardRank = firstState.board === null ? null : leducRank(firstState.board);
    const privateRank = leducRank(firstState.privateCards[player]);

    const opponentWeights = new Map<LeducRank, number>(LEDUC_RANKS.map(rank => [rank, 0]));
    for (const reached of states) {
      if (!reached.state.privateCards) {
        throw new Error(`Information set ${definition.key} has no private cards`);
      }
      const opponentRank = leducRank(reached.state.privateCards[1 - player]);
      opponentWeights.set(
        opponentRank,
        (opponentWeights.get(opponentRank) ?? 0) + reached.probability,
      );
    }
    const opponentRanks = LEDUC_RANKS.map(rank => ({
      rank,
      probability: offPath ? null : (opponentWeights.get(rank) ?? 0) / reachProbability,
    }));

    const summaries = definition.actions.map(action => {
      if (offPath) return null;
      let summary = zeroSummary();
      for (const reached of states) {
        summary = addWeighted(
          summary,
          continuation(leducGame.nextAction(reached.state, action), player),
          reached.probability / reachProbability,
        );
      }
      if (Math.abs(outcomeMass(summary) - 1) > PROBABILITY_TOLERANCE) {
        throw new Error(`Leduc action outcomes sum to ${outcomeMass(summary)}, not 1`);
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
      privateRank,
      boardRank,
      round: firstState.round,
      firstRoundHistory: [...firstState.histories[0]],
      secondRoundHistory: [...firstState.histories[1]],
      contributions,
      pot: contributions[0] + contributions[1],
      toCall: Math.max(...contributions) - contributions[player],
      betSize: firstState.round === 0 ? 1 : 2,
      handState: boardRank === null
        ? "private-card-only"
        : boardRank === privateRank ? "pair" : "high-card",
      reachProbability,
      offPath,
      opponentRanks,
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
            immediateOpponentFoldProbability: null,
            outcomes: nullOutcomes(),
            showdownEquity: null,
          };
        }
        const showdownProbability = summary.showdownWin + summary.showdownSplit + summary.showdownLoss;
        let immediateFold = 0;
        if (action === "bet" || action === "raise") {
          for (const reached of states) {
            immediateFold += reached.probability / reachProbability *
              immediateOpponentFoldProbability(reached.state, action, strategy)!;
          }
        }
        return {
          action,
          frequency: entry.probabilities[actionIndex],
          expectedValue,
          expectedAdditionalValue: expectedValue + contributions[player],
          differenceFromBest: bestExpectedValue - expectedValue,
          immediateOpponentFoldProbability: action === "bet" || action === "raise"
            ? immediateFold
            : null,
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
