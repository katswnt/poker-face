import { riverComboKey, type RiverCombo } from "../river/cards";
import type { InformationSetKey } from "../toy/game";
import {
  buildMultiwayGameTreeIndex,
  validateMultiwayStrategy,
  type MultiwayBehavioralStrategy,
} from "./game";
import type { ThreePlayers } from "./river-game";
import type {
  SidePotRiverAction,
  SidePotRiverGame,
  SidePotRiverState,
} from "./side-pot-river-game";

export interface SidePotOpponentMarginal {
  readonly player: number;
  readonly cards: RiverCombo;
  readonly key: string;
  readonly probability: number | null;
}

export interface SidePotJointOpponentWeight {
  readonly key: string;
  readonly hands: readonly { readonly player: number; readonly cards: RiverCombo }[];
  readonly probability: number | null;
}

export interface SidePotResponseFrequency {
  readonly player: number;
  readonly action: SidePotRiverAction;
  readonly probability: number | null;
}

export interface SidePotOutcomeBreakdown {
  readonly playerFolds: number | null;
  readonly allOpponentsFold: number | null;
  readonly showdownWinsEveryEligiblePot: number | null;
  readonly showdownWinsSomeEligiblePots: number | null;
  readonly showdownWinsNoPot: number | null;
  readonly reachesShowdown: number | null;
}

export interface ExpectedPotLayerFact {
  readonly layer: "main" | "side-1";
  /** Probability this layer exists after all later actions. */
  readonly existsProbability: number | null;
  /** Expected layer size, counting zero when it does not exist. */
  readonly expectedAmount: number | null;
  /** Probability the acting player reaches showdown eligible for this layer. */
  readonly playerEligibilityProbability: number | null;
  /** Expected layer amount on outcomes where the acting player is eligible. */
  readonly expectedAmountPlayerCanContest: number | null;
  /** Expected chips this layer awards to the acting player. */
  readonly expectedAward: number | null;
}

export interface SidePotActionFact {
  readonly action: SidePotRiverAction;
  readonly frequency: number;
  /** Net chips from the beginning of the hand. */
  readonly expectedValue: number | null;
  /** Chip change from this decision onward; chips already put in are excluded. */
  readonly expectedAdditionalValue: number | null;
  /** Expected new chips put in after this decision; old contributions are excluded. */
  readonly expectedAdditionalContribution: number | null;
  readonly differenceFromBest: number | null;
  readonly immediateResponses: readonly SidePotResponseFrequency[];
  readonly immediateOpponentFoldProbability: number | null;
  readonly outcomes: SidePotOutcomeBreakdown;
  readonly expectedReturnedUncalled: number | null;
  readonly expectedContestablePot: number | null;
  readonly expectedPotLayers: readonly ExpectedPotLayerFact[];
}

export interface SidePotDecisionFacts {
  readonly informationSet: InformationSetKey;
  readonly player: number;
  readonly position: "first" | "middle" | "last";
  readonly privateCards: RiverCombo;
  readonly history: readonly SidePotRiverAction[];
  readonly activePlayers: readonly number[];
  readonly allInPlayers: readonly number[];
  readonly contributions: ThreePlayers<number>;
  readonly remainingStacks: ThreePlayers<number>;
  readonly pot: number;
  /** Actual chips this player must add to call, capped by their remaining stack. */
  readonly callCost: number;
  readonly currentBet: number;
  readonly raisesUsed: 0 | 1;
  readonly reachProbability: number;
  readonly offPath: boolean;
  readonly jointOpponentRange: readonly SidePotJointOpponentWeight[];
  readonly opponentMarginals: readonly SidePotOpponentMarginal[];
  readonly actions: readonly SidePotActionFact[];
}

interface ReachedState {
  readonly state: SidePotRiverState;
  readonly probability: number;
}

interface LayerSummary {
  readonly exists: number;
  readonly amount: number;
  readonly playerEligible: number;
  readonly eligibleAmount: number;
  readonly award: number;
}

interface ContinuationSummary {
  readonly expectedValue: number;
  readonly playerFolds: number;
  readonly allOpponentsFold: number;
  readonly showdownWinsEveryEligiblePot: number;
  readonly showdownWinsSomeEligiblePots: number;
  readonly showdownWinsNoPot: number;
  readonly returnedUncalled: number;
  readonly contestablePot: number;
  readonly finalContribution: number;
  readonly layers: readonly [LayerSummary, LayerSummary];
}

const OFF_PATH_TOLERANCE = 1e-12;
const PROBABILITY_TOLERANCE = 1e-9;

function strategyEntry(
  strategy: MultiwayBehavioralStrategy<SidePotRiverAction>,
  key: InformationSetKey,
) {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing side-pot river strategy at ${key}`);
  return entry;
}

function stateKey(state: SidePotRiverState): string {
  const hands = state.hands?.map(riverComboKey).join("|") ?? "-";
  return `${hands}|${state.public.history.join(",")}`;
}

function zeroLayer(): LayerSummary {
  return { exists: 0, amount: 0, playerEligible: 0, eligibleAmount: 0, award: 0 };
}

function zeroSummary(): ContinuationSummary {
  return {
    expectedValue: 0,
    playerFolds: 0,
    allOpponentsFold: 0,
    showdownWinsEveryEligiblePot: 0,
    showdownWinsSomeEligiblePots: 0,
    showdownWinsNoPot: 0,
    returnedUncalled: 0,
    contestablePot: 0,
    finalContribution: 0,
    layers: [zeroLayer(), zeroLayer()],
  };
}

function addLayer(total: LayerSummary, value: LayerSummary, weight: number): LayerSummary {
  return {
    exists: total.exists + weight * value.exists,
    amount: total.amount + weight * value.amount,
    playerEligible: total.playerEligible + weight * value.playerEligible,
    eligibleAmount: total.eligibleAmount + weight * value.eligibleAmount,
    award: total.award + weight * value.award,
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
    allOpponentsFold: total.allOpponentsFold + weight * value.allOpponentsFold,
    showdownWinsEveryEligiblePot: total.showdownWinsEveryEligiblePot +
      weight * value.showdownWinsEveryEligiblePot,
    showdownWinsSomeEligiblePots: total.showdownWinsSomeEligiblePots +
      weight * value.showdownWinsSomeEligiblePots,
    showdownWinsNoPot: total.showdownWinsNoPot + weight * value.showdownWinsNoPot,
    returnedUncalled: total.returnedUncalled + weight * value.returnedUncalled,
    contestablePot: total.contestablePot + weight * value.contestablePot,
    finalContribution: total.finalContribution + weight * value.finalContribution,
    layers: [
      addLayer(total.layers[0], value.layers[0], weight),
      addLayer(total.layers[1], value.layers[1], weight),
    ],
  };
}

function outcomeMass(summary: ContinuationSummary): number {
  return summary.playerFolds + summary.allOpponentsFold +
    summary.showdownWinsEveryEligiblePot + summary.showdownWinsSomeEligiblePots +
    summary.showdownWinsNoPot;
}

function terminalSummary(
  game: SidePotRiverGame,
  state: SidePotRiverState,
  player: number,
): ContinuationSummary {
  const node = game.node(state);
  if (node.kind !== "terminal") throw new Error("Expected a terminal side-pot state");
  const settlement = game.settlement(state);
  const layers = [zeroLayer(), zeroLayer()] as [LayerSummary, LayerSummary];
  settlement.potLayers.forEach((layer, index) => {
    if (index >= layers.length) throw new Error("Side-pot v1 produced more than two pot layers");
    const eligible = layer.eligiblePlayers.includes(player);
    layers[index] = {
      exists: 1,
      amount: layer.amount,
      playerEligible: eligible ? 1 : 0,
      eligibleAmount: eligible ? layer.amount : 0,
      award: layer.awards[player],
    };
  });
  const summary = {
    ...zeroSummary(),
    expectedValue: node.utility[player],
    returnedUncalled: settlement.returnedUncalled[player],
    contestablePot: settlement.contestablePot,
    finalContribution: settlement.contributions[player],
    layers,
  };
  if (!state.public.active[player]) return { ...summary, playerFolds: 1 };
  if (state.public.terminal === "fold") return { ...summary, allOpponentsFold: 1 };
  const eligibleLayers = settlement.potLayers.filter(layer => layer.eligiblePlayers.includes(player));
  const wonLayers = eligibleLayers.filter(layer => layer.awards[player] > 0);
  if (wonLayers.length === 0) return { ...summary, showdownWinsNoPot: 1 };
  return wonLayers.length === eligibleLayers.length
    ? { ...summary, showdownWinsEveryEligiblePot: 1 }
    : { ...summary, showdownWinsSomeEligiblePots: 1 };
}

function continuationEvaluator(
  game: SidePotRiverGame,
  strategy: MultiwayBehavioralStrategy<SidePotRiverAction>,
) {
  const cache = new Map<string, ContinuationSummary>();
  const evaluate = (state: SidePotRiverState, player: number): ContinuationSummary => {
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
      throw new Error(`Side-pot continuation outcomes sum to ${outcomeMass(result)}, not 1`);
    }
    cache.set(key, result);
    return result;
  };
  return evaluate;
}

function nullOutcomes(): SidePotOutcomeBreakdown {
  return {
    playerFolds: null,
    allOpponentsFold: null,
    showdownWinsEveryEligiblePot: null,
    showdownWinsSomeEligiblePots: null,
    showdownWinsNoPot: null,
    reachesShowdown: null,
  };
}

function nullLayers(): readonly ExpectedPotLayerFact[] {
  return (["main", "side-1"] as const).map(layer => ({
    layer,
    existsProbability: null,
    expectedAmount: null,
    playerEligibilityProbability: null,
    expectedAmountPlayerCanContest: null,
    expectedAward: null,
  }));
}

function assertSamePublicState(game: SidePotRiverGame, states: readonly ReachedState[]): void {
  const publicView = (state: SidePotRiverState) => JSON.stringify({
    public: state.public,
    contributions: game.totalContributions(state),
  });
  const expected = publicView(states[0].state);
  for (const reached of states.slice(1)) {
    if (publicView(reached.state) !== expected) {
      throw new Error("A side-pot information set has inconsistent public state");
    }
  }
}

function immediateResponses(
  game: SidePotRiverGame,
  strategy: MultiwayBehavioralStrategy<SidePotRiverAction>,
  states: readonly ReachedState[],
  reachProbability: number,
  action: SidePotRiverAction,
): readonly SidePotResponseFrequency[] {
  let responsePlayer: number | null = null;
  let responseActions: readonly SidePotRiverAction[] | null = null;
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
      throw new Error(`Side-pot action ${action} has inconsistent immediate responses`);
    }
    const entry = strategyEntry(strategy, game.informationSet(child, node.player));
    node.actions.forEach((response, actionIndex) => {
      probabilities![actionIndex] += reached.probability / reachProbability * entry.probabilities[actionIndex];
    });
  }
  return responseActions?.map((actionName, actionIndex) => ({
    player: responsePlayer!,
    action: actionName,
    probability: probabilities![actionIndex],
  })) ?? [];
}

/** Exact side-pot teaching facts, grouped at the acting player's information boundary. */
export function sidePotRiverDecisionFacts(
  game: SidePotRiverGame,
  strategy: MultiwayBehavioralStrategy<SidePotRiverAction>,
): readonly SidePotDecisionFacts[] {
  const index = buildMultiwayGameTreeIndex(game);
  validateMultiwayStrategy(index, strategy);
  const continuation = continuationEvaluator(game, strategy);
  const reachedByInformationSet = new Map<InformationSetKey, ReachedState[]>();

  const visit = (state: SidePotRiverState, chanceReach: number, reach: readonly number[]): void => {
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
  visit(game.initialState(), 1, [1, 1, 1]);

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
    const otherPlayers = [0, 1, 2].filter(other => other !== player);

    const jointWeights = new Map<string, number>();
    const jointHands = new Map<string, SidePotJointOpponentWeight["hands"]>();
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
        throw new Error(`Side-pot action outcomes at ${definition.key} do not sum to 1`);
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
      position: game.scenario.positions[player],
      privateCards: first.hands[player],
      history: [...first.public.history],
      activePlayers: first.public.active.map((active, seat) => active ? seat : null)
        .filter((seat): seat is number => seat !== null),
      allInPlayers: first.public.active.map((active, seat) =>
        active && first.public.streetContributions[seat] === game.scenario.stackBehind[seat]
          ? seat
          : null).filter((seat): seat is number => seat !== null),
      contributions,
      remainingStacks: [
        game.scenario.stackBehind[0] - first.public.streetContributions[0],
        game.scenario.stackBehind[1] - first.public.streetContributions[1],
        game.scenario.stackBehind[2] - first.public.streetContributions[2],
      ],
      pot: contributions.reduce((sum, contribution) => sum + contribution, 0),
      callCost: game.callCost(first, player),
      currentBet: first.public.currentBet,
      raisesUsed: first.public.raisesUsed,
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
            expectedReturnedUncalled: null,
            expectedContestablePot: null,
            expectedPotLayers: nullLayers(),
          };
        }
        const responses = immediateResponses(game, strategy, states, reachProbability, action);
        const foldProbability = responses.find(response => response.action === "fold")?.probability ?? null;
        const reachesShowdown = summary.showdownWinsEveryEligiblePot +
          summary.showdownWinsSomeEligiblePots + summary.showdownWinsNoPot;
        return {
          action,
          frequency: entry.probabilities[actionIndex],
          expectedValue,
          expectedAdditionalValue: expectedValue + contributions[player],
          expectedAdditionalContribution: summary.finalContribution - contributions[player],
          differenceFromBest: bestValue - expectedValue,
          immediateResponses: responses,
          immediateOpponentFoldProbability: foldProbability,
          outcomes: {
            playerFolds: summary.playerFolds,
            allOpponentsFold: summary.allOpponentsFold,
            showdownWinsEveryEligiblePot: summary.showdownWinsEveryEligiblePot,
            showdownWinsSomeEligiblePots: summary.showdownWinsSomeEligiblePots,
            showdownWinsNoPot: summary.showdownWinsNoPot,
            reachesShowdown,
          },
          expectedReturnedUncalled: summary.returnedUncalled,
          expectedContestablePot: summary.contestablePot,
          expectedPotLayers: summary.layers.map((layer, index) => ({
            layer: index === 0 ? "main" as const : "side-1" as const,
            existsProbability: layer.exists,
            expectedAmount: layer.amount,
            playerEligibilityProbability: layer.playerEligible,
            expectedAmountPlayerCanContest: layer.eligibleAmount,
            expectedAward: layer.award,
          })),
        };
      }),
    };
  });
}
