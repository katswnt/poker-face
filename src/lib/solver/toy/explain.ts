import {
  buildGameTreeIndex,
  validateStrategy,
  type BehavioralStrategy,
  type InformationSetKey,
  type SolverPlayer,
  type Utility,
} from "./game";
import {
  KUHN_RANKS,
  kuhnGame,
  type KuhnAction,
  type KuhnRank,
  type KuhnState,
} from "./kuhn";

export interface KuhnOpponentCardWeight {
  readonly card: KuhnRank;
  readonly probability: number | null;
}

export interface KuhnActionFact {
  readonly action: KuhnAction;
  readonly frequency: number;
  readonly expectedValue: number | null;
  readonly differenceFromBest: number | null;
}

export interface KuhnDecisionFacts {
  readonly informationSet: InformationSetKey;
  readonly player: SolverPlayer;
  readonly card: KuhnRank;
  readonly history: readonly KuhnAction[];
  readonly reachProbability: number;
  readonly offPath: boolean;
  readonly opponentCards: readonly KuhnOpponentCardWeight[];
  readonly actions: readonly KuhnActionFact[];
}

interface ReachedState {
  readonly state: KuhnState;
  readonly probability: number;
}

const OFF_PATH_TOLERANCE = 1e-12;

function strategyEntry(strategy: BehavioralStrategy<KuhnAction>, key: InformationSetKey) {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing Kuhn strategy at ${key}`);
  return entry;
}

function continuationValue(
  state: KuhnState,
  strategy: BehavioralStrategy<KuhnAction>,
): Utility {
  const node = kuhnGame.node(state);
  if (node.kind === "terminal") return node.utility;
  if (node.kind === "chance") {
    let value0 = 0;
    let value1 = 0;
    for (const { outcome, probability } of node.outcomes) {
      const child = continuationValue(kuhnGame.nextChance(state, outcome), strategy);
      value0 += probability * child[0];
      value1 += probability * child[1];
    }
    return [value0, value1];
  }

  const key = kuhnGame.informationSet(state, node.player);
  const entry = strategyEntry(strategy, key);
  let value0 = 0;
  let value1 = 0;
  for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
    const child = continuationValue(kuhnGame.nextAction(state, node.actions[actionIndex]), strategy);
    value0 += entry.probabilities[actionIndex] * child[0];
    value1 += entry.probabilities[actionIndex] * child[1];
  }
  return [value0, value1];
}

/** Build exact, structured teaching inputs from a saved Kuhn strategy. */
export function kuhnDecisionFacts(
  strategy: BehavioralStrategy<KuhnAction>,
): readonly KuhnDecisionFacts[] {
  const index = buildGameTreeIndex(kuhnGame);
  validateStrategy(index, strategy);
  const reachedStates = new Map<InformationSetKey, ReachedState[]>();

  const visit = (
    state: KuhnState,
    chanceReach: number,
    reach0: number,
    reach1: number,
  ): void => {
    const node = kuhnGame.node(state);
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      for (const { outcome, probability } of node.outcomes) {
        visit(kuhnGame.nextChance(state, outcome), chanceReach * probability, reach0, reach1);
      }
      return;
    }

    const key = kuhnGame.informationSet(state, node.player);
    const probability = chanceReach * reach0 * reach1;
    const states = reachedStates.get(key) ?? [];
    states.push({ state, probability });
    reachedStates.set(key, states);

    const entry = strategyEntry(strategy, key);
    for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
      const actionProbability = entry.probabilities[actionIndex];
      if (node.player === 0) {
        visit(
          kuhnGame.nextAction(state, node.actions[actionIndex]),
          chanceReach,
          reach0 * actionProbability,
          reach1,
        );
      } else {
        visit(
          kuhnGame.nextAction(state, node.actions[actionIndex]),
          chanceReach,
          reach0,
          reach1 * actionProbability,
        );
      }
    }
  };

  visit(kuhnGame.initialState(), 1, 1, 1);

  return index.informationSets.map(definition => {
    const states = reachedStates.get(definition.key);
    if (!states || states.length === 0) throw new Error(`No Kuhn states found for ${definition.key}`);
    const firstState = states[0].state;
    const cards = firstState.cards;
    if (!cards) throw new Error(`Information set ${definition.key} has no private cards`);
    const reachProbability = states.reduce((sum, reached) => sum + reached.probability, 0);
    const offPath = reachProbability <= OFF_PATH_TOLERANCE;
    const entry = strategyEntry(strategy, definition.key);
    const player = definition.player;

    const opponentWeights = new Map<KuhnRank, number>();
    for (const reached of states) {
      const stateCards = reached.state.cards;
      if (!stateCards) throw new Error(`Information set ${definition.key} has no private cards`);
      const opponentCard = stateCards[1 - player];
      opponentWeights.set(opponentCard, (opponentWeights.get(opponentCard) ?? 0) + reached.probability);
    }
    const opponentCards = [...opponentWeights.entries()]
      .sort(([left], [right]) => KUHN_RANKS.indexOf(left) - KUHN_RANKS.indexOf(right))
      .map(([card, weight]) => ({
        card,
        probability: offPath ? null : weight / reachProbability,
      }));

    const expectedValues = definition.actions.map(action => {
      if (offPath) return null;
      let weightedValue = 0;
      for (const reached of states) {
        const child = kuhnGame.nextAction(reached.state, action);
        weightedValue += reached.probability * continuationValue(child, strategy)[player];
      }
      return weightedValue / reachProbability;
    });
    const bestExpectedValue = offPath
      ? null
      : Math.max(...expectedValues.filter((value): value is number => value !== null));

    return {
      informationSet: definition.key,
      player,
      card: cards[player],
      history: [...firstState.history],
      reachProbability,
      offPath,
      opponentCards,
      actions: definition.actions.map((action, actionIndex) => {
        const expectedValue = expectedValues[actionIndex];
        return {
          action,
          frequency: entry.probabilities[actionIndex],
          expectedValue,
          differenceFromBest: expectedValue === null || bestExpectedValue === null
            ? null
            : bestExpectedValue - expectedValue,
        };
      }),
    };
  });
}
