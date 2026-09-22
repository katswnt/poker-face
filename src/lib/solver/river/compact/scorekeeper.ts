import {
  validateStrategy,
  type BehavioralStrategy,
  type InformationSetKey,
  type SolverPlayer,
  type Utility,
} from "../../toy/game";
import type { CompiledCompactGame } from "./cfr";

const TERMINAL_NODE = 0;
const CHANCE_NODE = 1;
const PLAYER_NODE = 2;
const NO_CHOICE = -1;

export interface CompiledCompactScorekeeper<Action extends string> {
  readonly game: CompiledCompactGame<Action>;
  readonly informationSetNodeStarts: Int32Array;
  readonly informationSetNodeCounts: Uint32Array;
  readonly informationSetNodes: Int32Array;
  readonly storageBytes: number;
}

export interface CompactBestResponse<Action extends string> {
  readonly player: SolverPlayer;
  readonly value: number;
  readonly choices: ReadonlyMap<InformationSetKey, Action>;
  readonly method: "compact-information-set";
  readonly informationSetsOptimized: number;
  readonly pureStrategiesChecked: null;
  readonly workingStorageBytes: number;
}

export interface CompactStrategyGrade<Action extends string> {
  readonly value: Utility;
  readonly bestResponses: readonly [CompactBestResponse<Action>, CompactBestResponse<Action>];
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
  readonly workingStorageBytes: number;
}

function typedArrayBytes(arrays: readonly ArrayBufferView[]): number {
  return arrays.reduce((sum, array) => sum + array.byteLength, 0);
}

/** Build the information-set-to-node index used only by compact grading. */
export function compileCompactScorekeeper<Action extends string>(
  game: CompiledCompactGame<Action>,
): CompiledCompactScorekeeper<Action> {
  const informationSetCount = game.index.informationSets.length;
  const informationSetNodeCounts = new Uint32Array(informationSetCount);
  for (let node = 0; node < game.index.totalStates; node += 1) {
    if (game.nodeKinds[node] !== PLAYER_NODE) continue;
    informationSetNodeCounts[game.nodeInformationSets[node]] += 1;
  }

  const informationSetNodeStarts = new Int32Array(informationSetCount);
  let decisionNodes = 0;
  for (let informationSet = 0; informationSet < informationSetCount; informationSet += 1) {
    informationSetNodeStarts[informationSet] = decisionNodes;
    const count = informationSetNodeCounts[informationSet];
    const expected = game.index.informationSets[informationSet].stateCount;
    if (count !== expected) {
      throw new Error(
        `${game.gameId} compact scorekeeper found ${count}/${expected} nodes at ` +
        game.index.informationSets[informationSet].key,
      );
    }
    decisionNodes += count;
  }
  if (decisionNodes !== game.index.decisionNodes) {
    throw new Error(
      `${game.gameId} compact scorekeeper found ${decisionNodes}/${game.index.decisionNodes} decision nodes`,
    );
  }

  const informationSetNodes = new Int32Array(decisionNodes);
  const cursors = Int32Array.from(informationSetNodeStarts);
  for (let node = 0; node < game.index.totalStates; node += 1) {
    if (game.nodeKinds[node] !== PLAYER_NODE) continue;
    const informationSet = game.nodeInformationSets[node];
    informationSetNodes[cursors[informationSet]] = node;
    cursors[informationSet] += 1;
  }
  const arrays = [
    informationSetNodeStarts,
    informationSetNodeCounts,
    informationSetNodes,
  ] as const;
  return {
    game,
    informationSetNodeStarts,
    informationSetNodeCounts,
    informationSetNodes,
    storageBytes: typedArrayBytes(arrays),
  };
}

function encodeStrategy<Action extends string>(
  scorekeeper: CompiledCompactScorekeeper<Action>,
  strategy: BehavioralStrategy<Action>,
): Float64Array {
  const game = scorekeeper.game;
  validateStrategy(game.index, strategy);
  const encoded = new Float64Array(game.actionSlotCount);
  for (let informationSet = 0; informationSet < game.index.informationSets.length; informationSet += 1) {
    const definition = game.index.informationSets[informationSet];
    const entry = strategy.get(definition.key);
    if (!entry) throw new Error(`Missing compact grading strategy at ${definition.key}`);
    const start = game.informationSetActionStarts[informationSet];
    encoded.set(entry.probabilities, start);
  }
  return encoded;
}

function evaluateEncodedStrategy<Action extends string>(
  scorekeeper: CompiledCompactScorekeeper<Action>,
  strategy: Float64Array,
): { readonly value: Utility; readonly storageBytes: number } {
  const game = scorekeeper.game;
  const value0 = new Float64Array(game.index.totalStates);
  const value1 = new Float64Array(game.index.totalStates);
  for (let ordinal = 0; ordinal < game.index.totalStates; ordinal += 1) {
    const node = game.nodePostorder[ordinal];
    const kind = game.nodeKinds[node];
    if (kind === TERMINAL_NODE) {
      value0[node] = game.terminalUtility0[node];
      value1[node] = game.terminalUtility1[node];
      continue;
    }
    const edgeStart = game.nodeEdgeStarts[node];
    const edgeCount = game.nodeEdgeCounts[node];
    let mixed0 = 0;
    let mixed1 = 0;
    for (let action = 0; action < edgeCount; action += 1) {
      const edge = edgeStart + action;
      const probability = kind === CHANCE_NODE
        ? game.edgeChanceProbabilities[edge]
        : strategy[game.edgeActionSlots[edge]];
      const child = game.edgeChildren[edge];
      mixed0 += probability * value0[child];
      mixed1 += probability * value1[child];
    }
    value0[node] = mixed0;
    value1[node] = mixed1;
  }
  const value = [value0[0], value1[0]] as const;
  if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    throw new Error(`${game.gameId} compact strategy evaluation produced a non-finite value`);
  }
  return { value, storageBytes: typedArrayBytes([value0, value1]) };
}

/** Exact full-tree value using the compact tree rather than rebuilding game objects. */
export function evaluateCompactStrategy<Action extends string>(
  scorekeeper: CompiledCompactScorekeeper<Action>,
  strategy: BehavioralStrategy<Action>,
): Utility {
  return evaluateEncodedStrategy(scorekeeper, encodeStrategy(scorekeeper, strategy)).value;
}

function bestResponseEncoded<Action extends string>(
  scorekeeper: CompiledCompactScorekeeper<Action>,
  strategy: Float64Array,
  player: SolverPlayer,
): CompactBestResponse<Action> {
  const game = scorekeeper.game;
  const nodeCount = game.index.totalStates;
  const informationSetCount = game.index.informationSets.length;
  const counterfactualReach = new Float64Array(nodeCount);
  counterfactualReach[0] = 1;
  for (let node = 0; node < nodeCount; node += 1) {
    const kind = game.nodeKinds[node];
    if (kind === TERMINAL_NODE) continue;
    const start = game.nodeEdgeStarts[node];
    const count = game.nodeEdgeCounts[node];
    for (let action = 0; action < count; action += 1) {
      const edge = start + action;
      const child = game.edgeChildren[edge];
      let probability = 1;
      if (kind === CHANCE_NODE) {
        probability = game.edgeChanceProbabilities[edge];
      } else if (game.nodePlayers[node] !== player) {
        probability = strategy[game.edgeActionSlots[edge]];
      }
      counterfactualReach[child] = counterfactualReach[node] * probability;
    }
  }

  const chosenActionIndexes = new Int32Array(informationSetCount);
  chosenActionIndexes.fill(NO_CHOICE);
  const resolving = new Uint8Array(informationSetCount);
  const nodeValues = new Float64Array(nodeCount);
  nodeValues.fill(Number.NaN);

  const bestAction = (informationSet: number): number => {
    const cached = chosenActionIndexes[informationSet];
    if (cached !== NO_CHOICE) return cached;
    const definition = game.index.informationSets[informationSet];
    if (definition.player !== player) {
      throw new Error(`Player ${player} cannot optimize ${definition.key}`);
    }
    if (resolving[informationSet] !== 0) {
      throw new Error(
        `${game.gameId} cannot order compact best-response decisions at ${definition.key}`,
      );
    }
    resolving[informationSet] = 1;
    const nodeStart = scorekeeper.informationSetNodeStarts[informationSet];
    const nodeCountAtInformationSet = scorekeeper.informationSetNodeCounts[informationSet];
    if (nodeCountAtInformationSet === 0) {
      throw new Error(`Missing compact response nodes for ${definition.key}`);
    }

    let chosen = 0;
    let chosenValue = Number.NEGATIVE_INFINITY;
    for (let action = 0; action < definition.actions.length; action += 1) {
      let actionValue = 0;
      for (let offset = 0; offset < nodeCountAtInformationSet; offset += 1) {
        const node = scorekeeper.informationSetNodes[nodeStart + offset];
        const edge = game.nodeEdgeStarts[node] + action;
        actionValue += counterfactualReach[node] * stateValue(game.edgeChildren[edge]);
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

  const stateValue = (node: number): number => {
    const cached = nodeValues[node];
    if (!Number.isNaN(cached)) return cached;
    const kind = game.nodeKinds[node];
    let value: number;
    if (kind === TERMINAL_NODE) {
      value = player === 0 ? game.terminalUtility0[node] : game.terminalUtility1[node];
    } else if (kind === CHANCE_NODE) {
      value = 0;
      const start = game.nodeEdgeStarts[node];
      const count = game.nodeEdgeCounts[node];
      for (let action = 0; action < count; action += 1) {
        const edge = start + action;
        value += game.edgeChanceProbabilities[edge] * stateValue(game.edgeChildren[edge]);
      }
    } else if (game.nodePlayers[node] === player) {
      const action = bestAction(game.nodeInformationSets[node]);
      value = stateValue(game.edgeChildren[game.nodeEdgeStarts[node] + action]);
    } else {
      value = 0;
      const start = game.nodeEdgeStarts[node];
      const count = game.nodeEdgeCounts[node];
      for (let action = 0; action < count; action += 1) {
        const edge = start + action;
        value += strategy[game.edgeActionSlots[edge]] * stateValue(game.edgeChildren[edge]);
      }
    }
    if (!Number.isFinite(value)) {
      throw new Error(`${game.gameId} compact best response produced a non-finite value at node ${node}`);
    }
    nodeValues[node] = value;
    return value;
  };

  let informationSetsOptimized = 0;
  for (let informationSet = 0; informationSet < informationSetCount; informationSet += 1) {
    if (game.informationSetPlayers[informationSet] !== player) continue;
    bestAction(informationSet);
    informationSetsOptimized += 1;
  }
  const value = stateValue(0);
  const choices = new Map<InformationSetKey, Action>();
  for (let informationSet = 0; informationSet < informationSetCount; informationSet += 1) {
    const definition = game.index.informationSets[informationSet];
    if (definition.player !== player) continue;
    const action = chosenActionIndexes[informationSet];
    if (action === NO_CHOICE) throw new Error(`Missing compact best response at ${definition.key}`);
    choices.set(definition.key, definition.actions[action]);
  }
  return {
    player,
    value,
    choices,
    method: "compact-information-set",
    informationSetsOptimized,
    pureStrategiesChecked: null,
    workingStorageBytes: typedArrayBytes([
      counterfactualReach,
      chosenActionIndexes,
      resolving,
      nodeValues,
    ]),
  };
}

/** Exact information-set best response using compact arrays and no regret totals. */
export function compactInformationSetBestResponse<Action extends string>(
  scorekeeper: CompiledCompactScorekeeper<Action>,
  opponentProfile: BehavioralStrategy<Action>,
  player: SolverPlayer,
): CompactBestResponse<Action> {
  return bestResponseEncoded(scorekeeper, encodeStrategy(scorekeeper, opponentProfile), player);
}

/** Independently grade one heads-up, zero-sum profile using the compact tree. */
export function gradeCompactStrategy<Action extends string>(
  scorekeeper: CompiledCompactScorekeeper<Action>,
  strategy: BehavioralStrategy<Action>,
): CompactStrategyGrade<Action> {
  const encoded = encodeStrategy(scorekeeper, strategy);
  const evaluated = evaluateEncodedStrategy(scorekeeper, encoded);
  const response0 = bestResponseEncoded(scorekeeper, encoded, 0);
  const response1 = bestResponseEncoded(scorekeeper, encoded, 1);
  const rawGain0 = response0.value - evaluated.value[0];
  const rawGain1 = response1.value - evaluated.value[1];
  const tolerance = 1e-12;
  if (rawGain0 < -tolerance || rawGain1 < -tolerance) {
    throw new Error(`Compact best response is worse than the profile: gains ${rawGain0}, ${rawGain1}`);
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
