import {
  validateStrategy,
  type BehavioralStrategy,
  type InformationSetKey,
  type SolverPlayer,
  type Utility,
} from "../../toy/game";
import type { ConfigurableRiverAction } from "../configurable/game";
import {
  FACTORIZED_PLAYER_NODE,
  FACTORIZED_TERMINAL_NODE,
  factorizedInformationSet,
  factorizedTerminalUtility0,
  type CompiledFactorizedRiverGame,
} from "./game";

const NO_CHOICE = -1;

export interface CompiledFactorizedRiverScorekeeper {
  readonly game: CompiledFactorizedRiverGame;
  readonly informationSetStateStarts: Int32Array;
  readonly informationSetStateCounts: Uint32Array;
  readonly informationSetStates: Int32Array;
  readonly typedStorageBytes: number;
}

export interface FactorizedRiverBestResponse {
  readonly player: SolverPlayer;
  readonly value: number;
  readonly choices: ReadonlyMap<InformationSetKey, ConfigurableRiverAction>;
  readonly method: "factorized-information-set";
  readonly informationSetsOptimized: number;
  readonly pureStrategiesChecked: null;
  readonly workingStorageBytes: number;
}

export interface FactorizedRiverStrategyGrade {
  readonly value: Utility;
  readonly bestResponses: readonly [FactorizedRiverBestResponse, FactorizedRiverBestResponse];
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
  readonly workingStorageBytes: number;
}

function typedArrayBytes(arrays: readonly ArrayBufferView[]): number {
  return arrays.reduce((sum, array) => sum + array.byteLength, 0);
}

/** Group repeated deal/public states by the information set a legal response may observe. */
export function compileFactorizedRiverScorekeeper(
  game: CompiledFactorizedRiverGame,
): CompiledFactorizedRiverScorekeeper {
  const informationSetCount = game.index.informationSets.length;
  const informationSetStateCounts = new Uint32Array(informationSetCount);
  for (let deal = 0; deal < game.dealProbabilities.length; deal += 1) {
    for (let publicNode = 0; publicNode < game.publicNodeCount; publicNode += 1) {
      if (game.nodeKinds[publicNode] !== FACTORIZED_PLAYER_NODE) continue;
      informationSetStateCounts[factorizedInformationSet(game, deal, publicNode)] += 1;
    }
  }

  const informationSetStateStarts = new Int32Array(informationSetCount);
  let decisionStates = 0;
  for (let informationSet = 0; informationSet < informationSetCount; informationSet += 1) {
    informationSetStateStarts[informationSet] = decisionStates;
    const count = informationSetStateCounts[informationSet];
    const expected = game.index.informationSets[informationSet].stateCount;
    if (count !== expected) {
      throw new Error(
        `${game.gameId} factorized scorekeeper found ${count}/${expected} states at ` +
        game.index.informationSets[informationSet].key,
      );
    }
    decisionStates += count;
  }
  if (decisionStates !== game.index.decisionNodes) {
    throw new Error(
      `${game.gameId} factorized scorekeeper found ` +
      `${decisionStates}/${game.index.decisionNodes} decision states`,
    );
  }

  const informationSetStates = new Int32Array(decisionStates);
  const cursors = Int32Array.from(informationSetStateStarts);
  for (let deal = 0; deal < game.dealProbabilities.length; deal += 1) {
    for (let publicNode = 0; publicNode < game.publicNodeCount; publicNode += 1) {
      if (game.nodeKinds[publicNode] !== FACTORIZED_PLAYER_NODE) continue;
      const informationSet = factorizedInformationSet(game, deal, publicNode);
      informationSetStates[cursors[informationSet]] = deal * game.publicNodeCount + publicNode;
      cursors[informationSet] += 1;
    }
  }
  return {
    game,
    informationSetStateStarts,
    informationSetStateCounts,
    informationSetStates,
    typedStorageBytes: typedArrayBytes([
      informationSetStateStarts,
      informationSetStateCounts,
      informationSetStates,
    ]),
  };
}

function encodeStrategy(
  game: CompiledFactorizedRiverGame,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
): Float64Array {
  validateStrategy(game.index, strategy);
  const encoded = new Float64Array(game.actionSlotCount);
  for (let informationSet = 0; informationSet < game.index.informationSets.length; informationSet += 1) {
    const definition = game.index.informationSets[informationSet];
    const entry = strategy.get(definition.key);
    if (!entry) throw new Error(`Missing factorized grading strategy at ${definition.key}`);
    encoded.set(entry.probabilities, game.informationSetActionStarts[informationSet]);
  }
  return encoded;
}

function evaluateEncodedStrategy(
  game: CompiledFactorizedRiverGame,
  strategy: Float64Array,
): { readonly value: Utility; readonly storageBytes: number } {
  const value0 = new Float64Array(game.publicNodeCount);
  let expectedValue0 = 0;
  for (let deal = 0; deal < game.dealProbabilities.length; deal += 1) {
    for (let ordinal = 0; ordinal < game.publicNodeCount; ordinal += 1) {
      const publicNode = game.nodePostorder[ordinal];
      if (game.nodeKinds[publicNode] === FACTORIZED_TERMINAL_NODE) {
        value0[publicNode] = factorizedTerminalUtility0(game, deal, publicNode);
        continue;
      }
      const informationSet = factorizedInformationSet(game, deal, publicNode);
      const edgeStart = game.nodeEdgeStarts[publicNode];
      const edgeCount = game.nodeEdgeCounts[publicNode];
      const actionStart = game.informationSetActionStarts[informationSet];
      let mixedValue = 0;
      for (let action = 0; action < edgeCount; action += 1) {
        mixedValue += strategy[actionStart + action]
          * value0[game.edgeChildren[edgeStart + action]];
      }
      value0[publicNode] = mixedValue;
    }
    expectedValue0 += game.dealProbabilities[deal] * value0[0];
  }
  if (!Number.isFinite(expectedValue0)) {
    throw new Error(`${game.gameId} factorized strategy evaluation produced a non-finite value`);
  }
  return { value: [expectedValue0, -expectedValue0], storageBytes: value0.byteLength };
}

export function evaluateFactorizedRiverStrategy(
  scorekeeper: CompiledFactorizedRiverScorekeeper,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
): Utility {
  return evaluateEncodedStrategy(scorekeeper.game, encodeStrategy(scorekeeper.game, strategy)).value;
}

function bestResponseEncoded(
  scorekeeper: CompiledFactorizedRiverScorekeeper,
  strategy: Float64Array,
  player: SolverPlayer,
): FactorizedRiverBestResponse {
  const game = scorekeeper.game;
  const dealCount = game.dealProbabilities.length;
  const publicNodeCount = game.publicNodeCount;
  const repeatedStateCount = dealCount * publicNodeCount;
  const informationSetCount = game.index.informationSets.length;
  const counterfactualReach = new Float64Array(repeatedStateCount);

  for (let deal = 0; deal < dealCount; deal += 1) {
    const dealOffset = deal * publicNodeCount;
    counterfactualReach[dealOffset] = game.dealProbabilities[deal];
    for (let publicNode = 0; publicNode < publicNodeCount; publicNode += 1) {
      if (game.nodeKinds[publicNode] === FACTORIZED_TERMINAL_NODE) continue;
      const actor = game.nodePlayers[publicNode] as SolverPlayer;
      const informationSet = factorizedInformationSet(game, deal, publicNode);
      const edgeStart = game.nodeEdgeStarts[publicNode];
      const edgeCount = game.nodeEdgeCounts[publicNode];
      const actionStart = game.informationSetActionStarts[informationSet];
      for (let action = 0; action < edgeCount; action += 1) {
        const child = game.edgeChildren[edgeStart + action];
        const probability = actor === player ? 1 : strategy[actionStart + action];
        counterfactualReach[dealOffset + child] = counterfactualReach[dealOffset + publicNode]
          * probability;
      }
    }
  }

  const chosenActionIndexes = new Int32Array(informationSetCount);
  chosenActionIndexes.fill(NO_CHOICE);
  const resolving = new Uint8Array(informationSetCount);
  const stateValues = new Float64Array(repeatedStateCount);
  stateValues.fill(Number.NaN);

  const bestAction = (informationSet: number): number => {
    const cached = chosenActionIndexes[informationSet];
    if (cached !== NO_CHOICE) return cached;
    const definition = game.index.informationSets[informationSet];
    if (definition.player !== player) {
      throw new Error(`Player ${player} cannot optimize ${definition.key}`);
    }
    if (resolving[informationSet] !== 0) {
      throw new Error(`${game.gameId} cannot order factorized response decisions at ${definition.key}`);
    }
    resolving[informationSet] = 1;
    const start = scorekeeper.informationSetStateStarts[informationSet];
    const count = scorekeeper.informationSetStateCounts[informationSet];
    if (count === 0) throw new Error(`Missing factorized response states for ${definition.key}`);
    let chosen = 0;
    let chosenValue = Number.NEGATIVE_INFINITY;
    for (let action = 0; action < definition.actions.length; action += 1) {
      let actionValue = 0;
      for (let offset = 0; offset < count; offset += 1) {
        const encodedState = scorekeeper.informationSetStates[start + offset];
        const deal = Math.floor(encodedState / publicNodeCount);
        const publicNode = encodedState - deal * publicNodeCount;
        const child = game.edgeChildren[game.nodeEdgeStarts[publicNode] + action];
        actionValue += counterfactualReach[encodedState] * stateValue(deal, child);
      }
      if (actionValue > chosenValue) {
        chosen = action;
        chosenValue = actionValue;
      }
    }
    resolving[informationSet] = 0;
    chosenActionIndexes[informationSet] = chosen;
    return chosen;
  };

  const stateValue = (deal: number, publicNode: number): number => {
    const encodedState = deal * publicNodeCount + publicNode;
    const cached = stateValues[encodedState];
    if (!Number.isNaN(cached)) return cached;
    let value: number;
    if (game.nodeKinds[publicNode] === FACTORIZED_TERMINAL_NODE) {
      const utility0 = factorizedTerminalUtility0(game, deal, publicNode);
      value = player === 0 ? utility0 : -utility0;
    } else {
      const actor = game.nodePlayers[publicNode] as SolverPlayer;
      const informationSet = factorizedInformationSet(game, deal, publicNode);
      const edgeStart = game.nodeEdgeStarts[publicNode];
      if (actor === player) {
        const action = bestAction(informationSet);
        value = stateValue(deal, game.edgeChildren[edgeStart + action]);
      } else {
        value = 0;
        const edgeCount = game.nodeEdgeCounts[publicNode];
        const actionStart = game.informationSetActionStarts[informationSet];
        for (let action = 0; action < edgeCount; action += 1) {
          value += strategy[actionStart + action]
            * stateValue(deal, game.edgeChildren[edgeStart + action]);
        }
      }
    }
    if (!Number.isFinite(value)) {
      throw new Error(
        `${game.gameId} factorized best response produced a non-finite value at ` +
        `deal ${deal}, public node ${publicNode}`,
      );
    }
    stateValues[encodedState] = value;
    return value;
  };

  let informationSetsOptimized = 0;
  for (let informationSet = 0; informationSet < informationSetCount; informationSet += 1) {
    if (game.informationSetPlayers[informationSet] !== player) continue;
    bestAction(informationSet);
    informationSetsOptimized += 1;
  }
  let value = 0;
  for (let deal = 0; deal < dealCount; deal += 1) {
    value += game.dealProbabilities[deal] * stateValue(deal, 0);
  }
  const choices = new Map<InformationSetKey, ConfigurableRiverAction>();
  for (let informationSet = 0; informationSet < informationSetCount; informationSet += 1) {
    const definition = game.index.informationSets[informationSet];
    if (definition.player !== player) continue;
    const action = chosenActionIndexes[informationSet];
    if (action === NO_CHOICE) throw new Error(`Missing factorized response at ${definition.key}`);
    choices.set(definition.key, definition.actions[action]);
  }
  return {
    player,
    value,
    choices,
    method: "factorized-information-set",
    informationSetsOptimized,
    pureStrategiesChecked: null,
    workingStorageBytes: typedArrayBytes([
      counterfactualReach,
      chosenActionIndexes,
      resolving,
      stateValues,
    ]),
  };
}

export function factorizedRiverInformationSetBestResponse(
  scorekeeper: CompiledFactorizedRiverScorekeeper,
  opponentProfile: BehavioralStrategy<ConfigurableRiverAction>,
  player: SolverPlayer,
): FactorizedRiverBestResponse {
  return bestResponseEncoded(scorekeeper, encodeStrategy(scorekeeper.game, opponentProfile), player);
}

/** Exact heads-up, zero-sum grading with one response action per information set. */
export function gradeFactorizedRiverStrategy(
  scorekeeper: CompiledFactorizedRiverScorekeeper,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
): FactorizedRiverStrategyGrade {
  const encoded = encodeStrategy(scorekeeper.game, strategy);
  const evaluated = evaluateEncodedStrategy(scorekeeper.game, encoded);
  const response0 = bestResponseEncoded(scorekeeper, encoded, 0);
  const response1 = bestResponseEncoded(scorekeeper, encoded, 1);
  const rawGain0 = response0.value - evaluated.value[0];
  const rawGain1 = response1.value - evaluated.value[1];
  const tolerance = 1e-12;
  if (rawGain0 < -tolerance || rawGain1 < -tolerance) {
    throw new Error(
      `Factorized best response is worse than the profile: gains ${rawGain0}, ${rawGain1}`,
    );
  }
  const gains = [Math.max(0, rawGain0), Math.max(0, rawGain1)] as const;
  const nashGap = gains[0] + gains[1];
  return {
    value: evaluated.value,
    bestResponses: [response0, response1],
    gains,
    nashGap,
    exploitability: nashGap / 2,
    workingStorageBytes: evaluated.storageBytes + response0.workingStorageBytes +
      response1.workingStorageBytes,
  };
}
