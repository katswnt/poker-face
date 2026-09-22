import {
  buildGameTreeIndex,
  validateStrategy,
  type BehavioralStrategy,
  type InformationSetKey,
  type SolverPlayer,
} from "../../toy/game";
import { riverComboKey, type RiverCombo } from "../cards";
import type {
  ConfigurableRiverAction,
  ConfigurableRiverGame,
  ConfigurableRiverState,
} from "./game";

export interface ConfigurableRiverOpponentComboWeight {
  readonly cards: RiverCombo;
  readonly key: string;
  readonly probability: number | null;
}

export interface ConfigurableRiverOutcomeBreakdown {
  readonly playerFolds: number | null;
  readonly opponentFolds: number | null;
  readonly showdownWin: number | null;
  readonly showdownSplit: number | null;
  readonly showdownLoss: number | null;
}

export interface ConfigurableRiverActionFact {
  readonly action: ConfigurableRiverAction;
  readonly frequency: number;
  readonly expectedValue: number | null;
  readonly expectedAdditionalValue: number | null;
  readonly differenceFromBest: number | null;
  readonly immediateOpponentResponses: readonly {
    readonly action: ConfigurableRiverAction;
    readonly probability: number;
  }[];
  readonly immediateOpponentFoldProbability: number | null;
  readonly outcomes: ConfigurableRiverOutcomeBreakdown;
  readonly showdownEquity: number | null;
}

export interface ConfigurableRiverDecisionFacts {
  readonly informationSet: InformationSetKey;
  readonly player: SolverPlayer;
  readonly position: "out-of-position" | "in-position";
  readonly privateCards: RiverCombo;
  readonly history: readonly ConfigurableRiverAction[];
  readonly contributions: readonly [number, number];
  readonly pot: number;
  readonly toCall: number;
  readonly reachProbability: number;
  readonly offPath: boolean;
  readonly opponentRange: readonly ConfigurableRiverOpponentComboWeight[];
  readonly actions: readonly ConfigurableRiverActionFact[];
}

interface ReachedState {
  readonly state: ConfigurableRiverState;
  readonly probability: number;
}

interface Summary {
  readonly expectedValue: number;
  readonly playerFolds: number;
  readonly opponentFolds: number;
  readonly showdownWin: number;
  readonly showdownSplit: number;
  readonly showdownLoss: number;
}

const OFF_PATH = 1e-12;
const PROBABILITY_TOLERANCE = 1e-10;

function zero(): Summary {
  return {
    expectedValue: 0,
    playerFolds: 0,
    opponentFolds: 0,
    showdownWin: 0,
    showdownSplit: 0,
    showdownLoss: 0,
  };
}

function add(total: Summary, value: Summary, weight: number): Summary {
  return {
    expectedValue: total.expectedValue + weight * value.expectedValue,
    playerFolds: total.playerFolds + weight * value.playerFolds,
    opponentFolds: total.opponentFolds + weight * value.opponentFolds,
    showdownWin: total.showdownWin + weight * value.showdownWin,
    showdownSplit: total.showdownSplit + weight * value.showdownSplit,
    showdownLoss: total.showdownLoss + weight * value.showdownLoss,
  };
}

function mass(summary: Summary): number {
  return summary.playerFolds + summary.opponentFolds + summary.showdownWin +
    summary.showdownSplit + summary.showdownLoss;
}

function entry(
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
  key: InformationSetKey,
) {
  const found = strategy.get(key);
  if (!found) throw new Error(`Missing configurable river strategy at ${key}`);
  return found;
}

function terminalSummary(
  game: ConfigurableRiverGame,
  state: ConfigurableRiverState,
  player: SolverPlayer,
): Summary {
  const node = game.node(state);
  if (node.kind !== "terminal") throw new Error("Expected terminal configurable river state");
  const result = { ...zero(), expectedValue: node.utility[player] };
  if (state.public.terminal === "fold") {
    return state.public.foldedPlayer === player
      ? { ...result, playerFolds: 1 }
      : { ...result, opponentFolds: 1 };
  }
  const settlement = game.settlement(state);
  if (settlement.winners.length === 2) return { ...result, showdownSplit: 1 };
  return settlement.winners[0] === player
    ? { ...result, showdownWin: 1 }
    : { ...result, showdownLoss: 1 };
}

function continuationEvaluator(
  game: ConfigurableRiverGame,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
) {
  const evaluate = (state: ConfigurableRiverState, player: SolverPlayer): Summary => {
    const node = game.node(state);
    if (node.kind === "terminal") return terminalSummary(game, state, player);
    let result = zero();
    if (node.kind === "chance") {
      for (const child of node.outcomes) {
        result = add(result, evaluate(game.nextChance(state, child.outcome), player), child.probability);
      }
    } else {
      const strategyEntry = entry(strategy, game.informationSet(state, node.player));
      for (let index = 0; index < node.actions.length; index += 1) {
        result = add(
          result,
          evaluate(game.nextAction(state, node.actions[index]), player),
          strategyEntry.probabilities[index],
        );
      }
    }
    if (Math.abs(mass(result) - 1) > PROBABILITY_TOLERANCE) {
      throw new Error(`Configurable river continuation outcomes sum to ${mass(result)}, not 1`);
    }
    return result;
  };
  return evaluate;
}

function nullOutcomes(): ConfigurableRiverOutcomeBreakdown {
  return {
    playerFolds: null,
    opponentFolds: null,
    showdownWin: null,
    showdownSplit: null,
    showdownLoss: null,
  };
}

export function configurableRiverDecisionFacts(
  game: ConfigurableRiverGame,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
): readonly ConfigurableRiverDecisionFacts[] {
  const index = buildGameTreeIndex(game, { maxStates: game.preflight.limits.maxProjectedStates });
  validateStrategy(index, strategy);
  const continuation = continuationEvaluator(game, strategy);
  const reached = new Map<InformationSetKey, ReachedState[]>();

  const visit = (
    state: ConfigurableRiverState,
    chanceReach: number,
    reach0: number,
    reach1: number,
  ): void => {
    const node = game.node(state);
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      for (const child of node.outcomes) {
        visit(game.nextChance(state, child.outcome), chanceReach * child.probability, reach0, reach1);
      }
      return;
    }
    const key = game.informationSet(state, node.player);
    const states = reached.get(key) ?? [];
    states.push({ state, probability: chanceReach * reach0 * reach1 });
    reached.set(key, states);
    const strategyEntry = entry(strategy, key);
    for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
      const probability = strategyEntry.probabilities[actionIndex];
      const child = game.nextAction(state, node.actions[actionIndex]);
      if (node.player === 0) visit(child, chanceReach, reach0 * probability, reach1);
      else visit(child, chanceReach, reach0, reach1 * probability);
    }
  };
  visit(game.initialState(), 1, 1, 1);

  return index.informationSets.map(definition => {
    const states = reached.get(definition.key);
    if (!states?.length) throw new Error(`Missing states for ${definition.key}`);
    const first = states[0].state;
    const firstHands = first.hands;
    if (!firstHands) throw new Error(`Missing private hands for ${definition.key}`);
    const player = definition.player;
    const opponent = (1 - player) as SolverPlayer;
    const history = first.public.history.join(",");
    const contributions = game.totalContributions(first);
    for (const candidate of states.slice(1)) {
      if (
        candidate.state.public.history.join(",") !== history ||
        game.totalContributions(candidate.state).join(",") !== contributions.join(",")
      ) {
        throw new Error(`Information set ${definition.key} contains inconsistent public state`);
      }
    }
    const reachProbability = states.reduce((sum, state) => sum + state.probability, 0);
    const offPath = reachProbability <= OFF_PATH;
    const strategyEntry = entry(strategy, definition.key);
    const opponentMass = new Map(game.scenario.ranges[opponent].map(item => [riverComboKey(item.cards), 0]));
    for (const candidate of states) {
      if (!candidate.state.hands) throw new Error(`Missing private hands at ${definition.key}`);
      const key = riverComboKey(candidate.state.hands[opponent]);
      opponentMass.set(key, (opponentMass.get(key) ?? 0) + candidate.probability);
    }
    const opponentRange = game.scenario.ranges[opponent].map(item => ({
      cards: item.cards,
      key: riverComboKey(item.cards),
      probability: offPath ? null : (opponentMass.get(riverComboKey(item.cards)) ?? 0) / reachProbability,
    }));
    const summaries = definition.actions.map(action => {
      if (offPath) return null;
      let result = zero();
      for (const candidate of states) {
        result = add(
          result,
          continuation(game.nextAction(candidate.state, action), player),
          candidate.probability / reachProbability,
        );
      }
      return result;
    });
    const values = summaries.map(summary => summary?.expectedValue ?? null);
    const numericValues = values.filter((value): value is number => value !== null);
    const best = numericValues.length ? Math.max(...numericValues) : null;

    return {
      informationSet: definition.key,
      player,
      position: game.scenario.positions[player],
      privateCards: firstHands[player],
      history: [...first.public.history],
      contributions,
      pot: contributions[0] + contributions[1],
      toCall: game.toCall(first, player),
      reachProbability,
      offPath,
      opponentRange,
      actions: definition.actions.map((action, actionIndex) => {
        const summary = summaries[actionIndex];
        const expectedValue = values[actionIndex];
        if (!summary || expectedValue === null || best === null) {
          return {
            action,
            frequency: strategyEntry.probabilities[actionIndex],
            expectedValue: null,
            expectedAdditionalValue: null,
            differenceFromBest: null,
            immediateOpponentResponses: [],
            immediateOpponentFoldProbability: null,
            outcomes: nullOutcomes(),
            showdownEquity: null,
          };
        }
        const responseMass = new Map<ConfigurableRiverAction, number>();
        for (const candidate of states) {
          const child = game.nextAction(candidate.state, action);
          const node = game.node(child);
          if (node.kind !== "player") continue;
          const childEntry = entry(strategy, game.informationSet(child, node.player));
          for (let index = 0; index < node.actions.length; index += 1) {
            responseMass.set(
              node.actions[index],
              (responseMass.get(node.actions[index]) ?? 0) +
                candidate.probability / reachProbability * childEntry.probabilities[index],
            );
          }
        }
        const responses = [...responseMass].map(([responseAction, probability]) => ({
          action: responseAction,
          probability,
        }));
        const showdownMass = summary.showdownWin + summary.showdownSplit + summary.showdownLoss;
        return {
          action,
          frequency: strategyEntry.probabilities[actionIndex],
          expectedValue,
          expectedAdditionalValue: expectedValue + contributions[player],
          differenceFromBest: best - expectedValue,
          immediateOpponentResponses: responses,
          immediateOpponentFoldProbability: responseMass.get("fold") ?? null,
          outcomes: {
            playerFolds: summary.playerFolds,
            opponentFolds: summary.opponentFolds,
            showdownWin: summary.showdownWin,
            showdownSplit: summary.showdownSplit,
            showdownLoss: summary.showdownLoss,
          },
          showdownEquity: showdownMass <= OFF_PATH
            ? null
            : (summary.showdownWin + summary.showdownSplit / 2) / showdownMass,
        };
      }),
    };
  });
}
