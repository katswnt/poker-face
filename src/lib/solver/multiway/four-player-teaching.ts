import { riverComboKey, type RiverCombo } from "../river/cards";
import type { InformationSetKey } from "../toy/game";
import type {
  FourPlayerRiverAction,
  FourPlayerRiverGame,
  FourPlayerRiverPosition,
  FourPlayerRiverState,
  FourPlayers,
} from "./four-player-river-game";
import {
  buildMultiwayGameTreeIndex,
  validateMultiwayStrategy,
  type MultiwayBehavioralStrategy,
} from "./game";

export interface FourPlayerOpponentMarginal {
  readonly player: number;
  readonly cards: RiverCombo;
  readonly key: string;
  readonly probability: number | null;
}

export interface FourPlayerJointOpponentWeight {
  readonly key: string;
  readonly hands: readonly { readonly player: number; readonly cards: RiverCombo }[];
  readonly probability: number | null;
}

export interface FourPlayerResponseFrequency {
  readonly player: number;
  readonly action: FourPlayerRiverAction;
  readonly probability: number | null;
}

export interface FourPlayerOutcomeBreakdown {
  readonly playerFolds: number | null;
  readonly allOpponentsFold: number | null;
  readonly showdownWin: number | null;
  readonly showdownSplit: number | null;
  readonly showdownLoss: number | null;
  readonly reachesShowdown: number | null;
}

export interface FourPlayerActionFact {
  readonly action: FourPlayerRiverAction;
  readonly frequency: number;
  readonly expectedValue: number | null;
  readonly expectedAdditionalValue: number | null;
  readonly expectedAdditionalContribution: number | null;
  readonly differenceFromBest: number | null;
  readonly immediateResponses: readonly FourPlayerResponseFrequency[];
  readonly immediateOpponentFoldProbability: number | null;
  readonly outcomes: FourPlayerOutcomeBreakdown;
  readonly showdownEquity: number | null;
  readonly expectedPot: number | null;
  readonly expectedAward: number | null;
}

export interface FourPlayerDecisionFacts {
  readonly informationSet: InformationSetKey;
  readonly player: number;
  readonly playerCount: 4;
  readonly position: FourPlayerRiverPosition;
  readonly privateCards: RiverCombo;
  readonly history: readonly FourPlayerRiverAction[];
  readonly activePlayers: readonly number[];
  readonly contributions: FourPlayers<number>;
  readonly pot: number;
  readonly callCost: number;
  readonly reachProbability: number;
  readonly offPath: boolean;
  readonly jointOpponentRange: readonly FourPlayerJointOpponentWeight[];
  readonly opponentMarginals: readonly FourPlayerOpponentMarginal[];
  readonly actions: readonly FourPlayerActionFact[];
}

interface ReachedState {
  readonly state: FourPlayerRiverState;
  readonly probability: number;
}

interface ContinuationSummary {
  readonly expectedValue: number;
  readonly finalContribution: number;
  readonly expectedPot: number;
  readonly expectedAward: number;
  readonly playerFolds: number;
  readonly allOpponentsFold: number;
  readonly showdownWin: number;
  readonly showdownSplit: number;
  readonly showdownLoss: number;
  readonly showdownPotShare: number;
}

const OFF_PATH_TOLERANCE = 1e-12;
const PROBABILITY_TOLERANCE = 1e-9;

function strategyEntry(
  strategy: MultiwayBehavioralStrategy<FourPlayerRiverAction>,
  key: InformationSetKey,
) {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing four-player strategy at ${key}`);
  return entry;
}

function zeroSummary(): ContinuationSummary {
  return {
    expectedValue: 0,
    finalContribution: 0,
    expectedPot: 0,
    expectedAward: 0,
    playerFolds: 0,
    allOpponentsFold: 0,
    showdownWin: 0,
    showdownSplit: 0,
    showdownLoss: 0,
    showdownPotShare: 0,
  };
}

function addWeighted(
  total: ContinuationSummary,
  value: ContinuationSummary,
  weight: number,
): ContinuationSummary {
  return {
    expectedValue: total.expectedValue + weight * value.expectedValue,
    finalContribution: total.finalContribution + weight * value.finalContribution,
    expectedPot: total.expectedPot + weight * value.expectedPot,
    expectedAward: total.expectedAward + weight * value.expectedAward,
    playerFolds: total.playerFolds + weight * value.playerFolds,
    allOpponentsFold: total.allOpponentsFold + weight * value.allOpponentsFold,
    showdownWin: total.showdownWin + weight * value.showdownWin,
    showdownSplit: total.showdownSplit + weight * value.showdownSplit,
    showdownLoss: total.showdownLoss + weight * value.showdownLoss,
    showdownPotShare: total.showdownPotShare + weight * value.showdownPotShare,
  };
}

function outcomeMass(summary: ContinuationSummary): number {
  return summary.playerFolds + summary.allOpponentsFold + summary.showdownWin +
    summary.showdownSplit + summary.showdownLoss;
}

function stateKey(state: FourPlayerRiverState): string {
  return `${state.hands?.map(riverComboKey).join("|") ?? "-"}|${state.public.history.join(",")}`;
}

function terminalSummary(
  game: FourPlayerRiverGame,
  state: FourPlayerRiverState,
  player: number,
): ContinuationSummary {
  const node = game.node(state);
  if (node.kind !== "terminal") throw new Error("Expected a terminal four-player state");
  const settlement = game.settlement(state);
  const summary = {
    ...zeroSummary(),
    expectedValue: node.utility[player],
    finalContribution: settlement.contributions[player],
    expectedPot: settlement.pot,
    expectedAward: settlement.awards[player],
  };
  if (!state.public.active[player]) return { ...summary, playerFolds: 1 };
  if (state.public.terminal === "fold") return { ...summary, allOpponentsFold: 1 };
  if (!settlement.winners.includes(player)) return { ...summary, showdownLoss: 1 };
  const share = 1 / settlement.winners.length;
  return settlement.winners.length === 1
    ? { ...summary, showdownWin: 1, showdownPotShare: share }
    : { ...summary, showdownSplit: 1, showdownPotShare: share };
}

function continuationEvaluator(
  game: FourPlayerRiverGame,
  strategy: MultiwayBehavioralStrategy<FourPlayerRiverAction>,
) {
  const cache = new Map<string, ContinuationSummary>();
  const evaluate = (state: FourPlayerRiverState, player: number): ContinuationSummary => {
    const key = `${player}|${stateKey(state)}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const node = game.node(state);
    if (node.kind === "terminal") {
      const result = terminalSummary(game, state, player);
      cache.set(key, result);
      return result;
    }
    let result = zeroSummary();
    if (node.kind === "chance") {
      for (const edge of node.outcomes) {
        result = addWeighted(
          result,
          evaluate(game.nextChance(state, edge.outcome), player),
          edge.probability,
        );
      }
    } else {
      const entry = strategyEntry(strategy, game.informationSet(state, node.player));
      node.actions.forEach((action, actionIndex) => {
        result = addWeighted(
          result,
          evaluate(game.nextAction(state, action), player),
          entry.probabilities[actionIndex],
        );
      });
    }
    if (Math.abs(outcomeMass(result) - 1) > PROBABILITY_TOLERANCE) {
      throw new Error(`Four-player continuation outcomes sum to ${outcomeMass(result)}, not 1`);
    }
    cache.set(key, result);
    return result;
  };
  return evaluate;
}

function nullOutcomes(): FourPlayerOutcomeBreakdown {
  return {
    playerFolds: null,
    allOpponentsFold: null,
    showdownWin: null,
    showdownSplit: null,
    showdownLoss: null,
    reachesShowdown: null,
  };
}

function assertSamePublicState(game: FourPlayerRiverGame, states: readonly ReachedState[]): void {
  const view = (state: FourPlayerRiverState) => JSON.stringify({
    public: state.public,
    contributions: game.totalContributions(state),
  });
  const expected = view(states[0].state);
  for (const reached of states.slice(1)) {
    if (view(reached.state) !== expected) {
      throw new Error("A four-player information set has inconsistent public state");
    }
  }
}

function immediateResponses(
  game: FourPlayerRiverGame,
  strategy: MultiwayBehavioralStrategy<FourPlayerRiverAction>,
  states: readonly ReachedState[],
  reachProbability: number,
  action: FourPlayerRiverAction,
): readonly FourPlayerResponseFrequency[] {
  let responsePlayer: number | null = null;
  let responseActions: readonly FourPlayerRiverAction[] | null = null;
  let probabilities: number[] | null = null;
  for (const reached of states) {
    const child = game.nextAction(reached.state, action);
    const node = game.node(child);
    if (node.kind !== "player") continue;
    if (responsePlayer === null) {
      responsePlayer = node.player;
      responseActions = node.actions;
      probabilities = node.actions.map(() => 0);
    } else if (responsePlayer !== node.player || responseActions?.join(",") !== node.actions.join(",")) {
      throw new Error(`Four-player action ${action} has inconsistent immediate responses`);
    }
    const entry = strategyEntry(strategy, game.informationSet(child, node.player));
    node.actions.forEach((response, index) => {
      probabilities![index] += reached.probability / reachProbability * entry.probabilities[index];
    });
  }
  return responseActions?.map((actionName, index) => ({
    player: responsePlayer!,
    action: actionName,
    probability: probabilities![index],
  })) ?? [];
}

export function fourPlayerDecisionFacts(
  game: FourPlayerRiverGame,
  strategy: MultiwayBehavioralStrategy<FourPlayerRiverAction>,
): readonly FourPlayerDecisionFacts[] {
  const index = buildMultiwayGameTreeIndex(game);
  validateMultiwayStrategy(index, strategy);
  const continuation = continuationEvaluator(game, strategy);
  const reachedByInformationSet = new Map<InformationSetKey, ReachedState[]>();

  const visit = (state: FourPlayerRiverState, chanceReach: number, reach: readonly number[]): void => {
    const node = game.node(state);
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      for (const edge of node.outcomes) {
        visit(game.nextChance(state, edge.outcome), chanceReach * edge.probability, reach);
      }
      return;
    }
    const key = game.informationSet(state, node.player);
    const probability = chanceReach * reach.reduce((product, value) => product * value, 1);
    const states = reachedByInformationSet.get(key) ?? [];
    states.push({ state, probability });
    reachedByInformationSet.set(key, states);
    const entry = strategyEntry(strategy, key);
    node.actions.forEach((action, actionIndex) => {
      const childReach = [...reach];
      childReach[node.player] *= entry.probabilities[actionIndex];
      visit(game.nextAction(state, action), chanceReach, childReach);
    });
  };
  visit(game.initialState(), 1, [1, 1, 1, 1]);

  return index.informationSets.map(definition => {
    const states = reachedByInformationSet.get(definition.key);
    if (!states?.length) throw new Error(`No states found for ${definition.key}`);
    assertSamePublicState(game, states);
    const first = states[0].state;
    if (!first.hands) throw new Error(`Information set ${definition.key} has no private hands`);
    const player = definition.player;
    const reachProbability = states.reduce((sum, reached) => sum + reached.probability, 0);
    const offPath = reachProbability <= OFF_PATH_TOLERANCE;
    const entry = strategyEntry(strategy, definition.key);
    const contributions = game.totalContributions(first);
    const otherPlayers = [0, 1, 2, 3].filter(other => other !== player);

    const jointWeights = new Map<string, number>();
    const jointHands = new Map<string, FourPlayerJointOpponentWeight["hands"]>();
    for (const reached of states) {
      if (!reached.state.hands) throw new Error(`Information set ${definition.key} has no hands`);
      const hands = otherPlayers.map(other => ({ player: other, cards: reached.state.hands![other] }));
      const key = hands.map(hand => `p${hand.player}:${riverComboKey(hand.cards)}`).join("|");
      jointWeights.set(key, (jointWeights.get(key) ?? 0) + reached.probability);
      jointHands.set(key, hands);
    }
    const jointOpponentRange = [...jointWeights].sort(([left], [right]) => left.localeCompare(right))
      .map(([key, weight]) => ({
        key,
        hands: jointHands.get(key)!,
        probability: offPath ? null : weight / reachProbability,
      }));

    const opponentMarginals = otherPlayers.flatMap(opponent => {
      const weights = new Map<string, number>();
      for (const reached of states) {
        if (!reached.state.hands) throw new Error(`Information set ${definition.key} has no hands`);
        const key = riverComboKey(reached.state.hands[opponent]);
        weights.set(key, (weights.get(key) ?? 0) + reached.probability);
      }
      return game.scenario.ranges[opponent].map(rangeEntry => ({
        player: opponent,
        cards: rangeEntry.cards,
        key: riverComboKey(rangeEntry.cards),
        probability: offPath
          ? null
          : (weights.get(riverComboKey(rangeEntry.cards)) ?? 0) / reachProbability,
      }));
    });

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
        throw new Error(`Four-player outcomes at ${definition.key} do not sum to 1`);
      }
      return summary;
    });
    const values = summaries.map(summary => summary?.expectedValue ?? null);
    const bestValue = offPath
      ? null
      : Math.max(...values.filter((value): value is number => value !== null));

    return {
      informationSet: definition.key,
      player,
      playerCount: 4 as const,
      position: game.scenario.positions[player],
      privateCards: first.hands[player],
      history: [...first.public.history],
      activePlayers: first.public.active.map((active, seat) => active ? seat : null)
        .filter((seat): seat is number => seat !== null),
      contributions,
      pot: contributions.reduce((sum, amount) => sum + amount, 0),
      callCost: first.public.bettor === null ? 0 :
        game.scenario.betSize - first.public.streetContributions[player],
      reachProbability,
      offPath,
      jointOpponentRange,
      opponentMarginals,
      actions: definition.actions.map((action, actionIndex) => {
        const summary = summaries[actionIndex];
        const expectedValue = values[actionIndex];
        if (!summary || expectedValue === null || bestValue === null) {
          return {
            action,
            frequency: entry.probabilities[actionIndex],
            expectedValue: null,
            expectedAdditionalValue: null,
            expectedAdditionalContribution: null,
            differenceFromBest: null,
            immediateResponses: [],
            immediateOpponentFoldProbability: null,
            outcomes: nullOutcomes(),
            showdownEquity: null,
            expectedPot: null,
            expectedAward: null,
          };
        }
        const responses = immediateResponses(game, strategy, states, reachProbability, action);
        const reachesShowdown = summary.showdownWin + summary.showdownSplit + summary.showdownLoss;
        return {
          action,
          frequency: entry.probabilities[actionIndex],
          expectedValue,
          expectedAdditionalValue: expectedValue + contributions[player],
          expectedAdditionalContribution: summary.finalContribution - contributions[player],
          differenceFromBest: bestValue - expectedValue,
          immediateResponses: responses,
          immediateOpponentFoldProbability:
            responses.find(response => response.action === "fold")?.probability ?? null,
          outcomes: {
            playerFolds: summary.playerFolds,
            allOpponentsFold: summary.allOpponentsFold,
            showdownWin: summary.showdownWin,
            showdownSplit: summary.showdownSplit,
            showdownLoss: summary.showdownLoss,
            reachesShowdown,
          },
          showdownEquity: reachesShowdown <= OFF_PATH_TOLERANCE
            ? null
            : summary.showdownPotShare / reachesShowdown,
          expectedPot: summary.expectedPot,
          expectedAward: summary.expectedAward,
        };
      }),
    };
  });
}
