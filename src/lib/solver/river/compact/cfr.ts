import {
  buildGameTreeIndex,
  validateStrategy,
  type BehavioralStrategy,
  type ExtensiveFormGame,
  type GameTreeIndex,
  type InformationSetKey,
  type SolverPlayer,
} from "../../toy/game";

const TERMINAL_NODE = 0;
const CHANCE_NODE = 1;
const PLAYER_NODE = 2;
const NO_INDEX = -1;
const NUMERIC_TOLERANCE = 1e-12;

export type CompactAlgorithm = "vanilla" | "cfr-plus";

export interface CompiledCompactGame<Action extends string> {
  readonly gameId: string;
  readonly index: GameTreeIndex<Action>;
  readonly nodeKinds: Uint8Array;
  readonly nodePlayers: Int8Array;
  readonly nodeInformationSets: Int32Array;
  readonly nodeEdgeStarts: Int32Array;
  readonly nodeEdgeCounts: Uint32Array;
  readonly nodePostorder: Int32Array;
  readonly terminalUtility0: Float64Array;
  readonly terminalUtility1: Float64Array;
  readonly edgeChildren: Int32Array;
  readonly edgeChanceProbabilities: Float64Array;
  readonly edgeActionSlots: Int32Array;
  readonly informationSetPlayers: Int8Array;
  readonly informationSetActionStarts: Int32Array;
  readonly informationSetActionCounts: Uint32Array;
  readonly actionSlotCount: number;
  readonly storageBytes: number;
}

export interface CompactCfrCheckpoint<Action extends string> {
  readonly iteration: number;
  readonly averageStrategy: BehavioralStrategy<Action>;
}

export interface CompactCfrOptions {
  readonly iterations: number;
  readonly algorithm?: CompactAlgorithm;
  readonly averagingDelay?: number;
  readonly checkpointIterations?: readonly number[];
}

export interface CompactCfrSolveResult<Action extends string> {
  readonly gameId: string;
  readonly algorithm: "compact-full-tree-cfr" | "compact-alternating-cfr-plus";
  readonly algorithmVersion: 1;
  readonly iterations: number;
  readonly averagingDelay: number;
  readonly fullTreeRegretPasses: number;
  readonly reachOnlyPasses: number;
  readonly index: GameTreeIndex<Action>;
  readonly compiled: CompiledCompactGame<Action>;
  readonly currentStrategy: BehavioralStrategy<Action>;
  readonly averageStrategy: BehavioralStrategy<Action>;
  readonly cumulativeRegrets: ReadonlyMap<InformationSetKey, readonly number[]>;
  readonly checkpoints: readonly CompactCfrCheckpoint<Action>[];
  readonly workingStorageBytes: number;
}

interface CompactWorkspace {
  readonly cumulativeRegrets: Float64Array;
  readonly strategySums: Float64Array;
  readonly strategy: Float64Array;
  readonly regretDeltas: Float64Array;
  readonly reach0: Float64Array;
  readonly reach1: Float64Array;
  readonly chanceReach: Float64Array;
  readonly ownReach: Float64Array;
  readonly value0: Float64Array;
  readonly value1: Float64Array;
}

function sameActions<Action extends string>(
  left: readonly Action[],
  right: readonly Action[],
): boolean {
  return left.length === right.length && left.every((action, index) => action === right[index]);
}

function typedArrayBytes(arrays: readonly ArrayBufferView[]): number {
  return arrays.reduce((sum, array) => sum + array.byteLength, 0);
}

/**
 * Compile an already validated finite game into stable numeric arrays.
 *
 * This does not invent poker rules. Every action, chance edge, information set, and
 * terminal payoff comes from the source game, which remains the readable rules oracle.
 */
export function compileCompactGame<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
): CompiledCompactGame<Action> {
  const index = buildGameTreeIndex(game);
  const nodeCount = index.totalStates;
  const edgeCount = Math.max(0, nodeCount - 1);
  const nodeKinds = new Uint8Array(nodeCount);
  const nodePlayers = new Int8Array(nodeCount);
  nodePlayers.fill(NO_INDEX);
  const nodeInformationSets = new Int32Array(nodeCount);
  nodeInformationSets.fill(NO_INDEX);
  const nodeEdgeStarts = new Int32Array(nodeCount);
  const nodeEdgeCounts = new Uint32Array(nodeCount);
  const terminalUtility0 = new Float64Array(nodeCount);
  const terminalUtility1 = new Float64Array(nodeCount);
  const postorder: number[] = [];
  const edgeChildren = new Int32Array(edgeCount);
  const edgeChanceProbabilities = new Float64Array(edgeCount);
  const edgeActionSlots = new Int32Array(edgeCount);
  edgeActionSlots.fill(NO_INDEX);

  const informationSetPlayers = new Int8Array(index.informationSets.length);
  const informationSetActionStarts = new Int32Array(index.informationSets.length);
  const informationSetActionCounts = new Uint32Array(index.informationSets.length);
  const informationSetIndex = new Map<InformationSetKey, number>();
  let actionSlotCount = 0;
  for (let id = 0; id < index.informationSets.length; id += 1) {
    const definition = index.informationSets[id];
    informationSetIndex.set(definition.key, id);
    informationSetPlayers[id] = definition.player;
    informationSetActionStarts[id] = actionSlotCount;
    informationSetActionCounts[id] = definition.actions.length;
    actionSlotCount += definition.actions.length;
  }

  const recallByInformationSet = new Map<InformationSetKey, string>();
  let nextNode = 0;
  let nextEdge = 0;
  const visit = (
    state: State,
    recall: readonly [readonly string[], readonly string[]],
  ): number => {
    const nodeId = nextNode;
    nextNode += 1;
    if (nodeId >= nodeCount) throw new Error(`${game.id} changed while its compact tree was compiled`);

    const node = game.node(state);
    if (node.kind === "terminal") {
      nodeKinds[nodeId] = TERMINAL_NODE;
      terminalUtility0[nodeId] = node.utility[0];
      terminalUtility1[nodeId] = node.utility[1];
      postorder.push(nodeId);
      return nodeId;
    }

    const children = node.kind === "chance" ? node.outcomes.length : node.actions.length;
    const edgeStart = nextEdge;
    nextEdge += children;
    if (nextEdge > edgeCount) throw new Error(`${game.id} changed while its compact edges were compiled`);
    nodeEdgeStarts[nodeId] = edgeStart;
    nodeEdgeCounts[nodeId] = children;

    if (node.kind === "chance") {
      nodeKinds[nodeId] = CHANCE_NODE;
      for (let childIndex = 0; childIndex < node.outcomes.length; childIndex += 1) {
        const edge = edgeStart + childIndex;
        const outcome = node.outcomes[childIndex];
        edgeChanceProbabilities[edge] = outcome.probability;
        edgeChildren[edge] = visit(game.nextChance(state, outcome.outcome), recall);
      }
      postorder.push(nodeId);
      return nodeId;
    }

    nodeKinds[nodeId] = PLAYER_NODE;
    nodePlayers[nodeId] = node.player;
    const key = game.informationSet(state, node.player);
    const informationSet = informationSetIndex.get(key);
    if (informationSet === undefined) throw new Error(`Missing compact information set ${key}`);
    const definition = index.informationSets[informationSet];
    if (definition.player !== node.player || !sameActions(definition.actions, node.actions)) {
      throw new Error(`${game.id} changed legal actions while compacting ${key}`);
    }
    nodeInformationSets[nodeId] = informationSet;

    const recallSignature = JSON.stringify(recall[node.player]);
    const earlierRecall = recallByInformationSet.get(key);
    if (earlierRecall !== undefined && earlierRecall !== recallSignature) {
      throw new Error(`${game.id} information set ${key} violates perfect recall`);
    }
    recallByInformationSet.set(key, recallSignature);

    const actionStart = informationSetActionStarts[informationSet];
    for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
      const edge = edgeStart + actionIndex;
      const action = node.actions[actionIndex];
      edgeActionSlots[edge] = actionStart + actionIndex;
      const nextPlayerRecall = [...recall[node.player], `${key}\u0000${action}`];
      const nextRecall: readonly [readonly string[], readonly string[]] = node.player === 0
        ? [nextPlayerRecall, recall[1]]
        : [recall[0], nextPlayerRecall];
      edgeChildren[edge] = visit(game.nextAction(state, action), nextRecall);
    }
    postorder.push(nodeId);
    return nodeId;
  };

  const root = visit(game.initialState(), [[], []]);
  if (root !== 0 || nextNode !== nodeCount || nextEdge !== edgeCount) {
    throw new Error(
      `${game.id} compact tree counts changed: nodes ${nextNode}/${nodeCount}, edges ${nextEdge}/${edgeCount}`,
    );
  }
  if (postorder.length !== nodeCount) {
    throw new Error(`${game.id} compact postorder has ${postorder.length}/${nodeCount} states`);
  }
  const nodePostorder = Int32Array.from(postorder);

  const arrays: readonly ArrayBufferView[] = [
    nodeKinds,
    nodePlayers,
    nodeInformationSets,
    nodeEdgeStarts,
    nodeEdgeCounts,
    nodePostorder,
    terminalUtility0,
    terminalUtility1,
    edgeChildren,
    edgeChanceProbabilities,
    edgeActionSlots,
    informationSetPlayers,
    informationSetActionStarts,
    informationSetActionCounts,
  ];
  return {
    gameId: game.id,
    index,
    nodeKinds,
    nodePlayers,
    nodeInformationSets,
    nodeEdgeStarts,
    nodeEdgeCounts,
    nodePostorder,
    terminalUtility0,
    terminalUtility1,
    edgeChildren,
    edgeChanceProbabilities,
    edgeActionSlots,
    informationSetPlayers,
    informationSetActionStarts,
    informationSetActionCounts,
    actionSlotCount,
    storageBytes: typedArrayBytes(arrays),
  };
}

function validateOptions(options: CompactCfrOptions): Required<CompactCfrOptions> {
  if (!Number.isSafeInteger(options.iterations) || options.iterations <= 0) {
    throw new Error(`Compact CFR iterations must be a positive safe integer, got ${options.iterations}`);
  }
  const algorithm = options.algorithm ?? "vanilla";
  const averagingDelay = options.averagingDelay ?? 0;
  if (!Number.isSafeInteger(averagingDelay) || averagingDelay < 0) {
    throw new Error(`Compact CFR averaging delay must be a non-negative safe integer, got ${averagingDelay}`);
  }
  if (algorithm === "vanilla" && averagingDelay !== 0) {
    throw new Error("Ordinary compact CFR does not use an averaging delay");
  }
  const checkpoints = [...(options.checkpointIterations ?? [])];
  for (const checkpoint of checkpoints) {
    if (!Number.isSafeInteger(checkpoint) || checkpoint <= 0 || checkpoint > options.iterations) {
      throw new Error(`Invalid compact CFR checkpoint ${checkpoint} for ${options.iterations} iterations`);
    }
  }
  return {
    iterations: options.iterations,
    algorithm,
    averagingDelay,
    checkpointIterations: checkpoints,
  };
}

function createWorkspace<Action extends string>(compiled: CompiledCompactGame<Action>): CompactWorkspace {
  const nodeCount = compiled.index.totalStates;
  const informationSetCount = compiled.index.informationSets.length;
  const actionCount = compiled.actionSlotCount;
  return {
    cumulativeRegrets: new Float64Array(actionCount),
    strategySums: new Float64Array(actionCount),
    strategy: new Float64Array(actionCount),
    regretDeltas: new Float64Array(actionCount),
    reach0: new Float64Array(nodeCount),
    reach1: new Float64Array(nodeCount),
    chanceReach: new Float64Array(nodeCount),
    ownReach: new Float64Array(informationSetCount),
    value0: new Float64Array(nodeCount),
    value1: new Float64Array(nodeCount),
  };
}

function rebuildStrategy<Action extends string>(
  compiled: CompiledCompactGame<Action>,
  workspace: CompactWorkspace,
): void {
  for (let informationSet = 0; informationSet < compiled.index.informationSets.length; informationSet += 1) {
    const start = compiled.informationSetActionStarts[informationSet];
    const count = compiled.informationSetActionCounts[informationSet];
    let positiveSum = 0;
    for (let action = 0; action < count; action += 1) {
      positiveSum += Math.max(0, workspace.cumulativeRegrets[start + action]);
    }
    if (positiveSum > 0) {
      for (let action = 0; action < count; action += 1) {
        workspace.strategy[start + action] = Math.max(
          0,
          workspace.cumulativeRegrets[start + action],
        ) / positiveSum;
      }
    } else {
      const probability = 1 / count;
      for (let action = 0; action < count; action += 1) {
        workspace.strategy[start + action] = probability;
      }
    }
  }
}

function forwardReach<Action extends string>(
  compiled: CompiledCompactGame<Action>,
  workspace: CompactWorkspace,
): void {
  workspace.ownReach.fill(Number.NaN);
  workspace.reach0[0] = 1;
  workspace.reach1[0] = 1;
  workspace.chanceReach[0] = 1;
  for (let node = 0; node < compiled.index.totalStates; node += 1) {
    const kind = compiled.nodeKinds[node];
    if (kind === TERMINAL_NODE) continue;
    const edgeStart = compiled.nodeEdgeStarts[node];
    const edgeCount = compiled.nodeEdgeCounts[node];
    if (kind === CHANCE_NODE) {
      for (let action = 0; action < edgeCount; action += 1) {
        const edge = edgeStart + action;
        const child = compiled.edgeChildren[edge];
        workspace.reach0[child] = workspace.reach0[node];
        workspace.reach1[child] = workspace.reach1[node];
        workspace.chanceReach[child] = workspace.chanceReach[node]
          * compiled.edgeChanceProbabilities[edge];
      }
      continue;
    }

    const player = compiled.nodePlayers[node] as SolverPlayer;
    const informationSet = compiled.nodeInformationSets[node];
    const own = player === 0 ? workspace.reach0[node] : workspace.reach1[node];
    if (Number.isNaN(workspace.ownReach[informationSet])) {
      workspace.ownReach[informationSet] = own;
    } else if (Math.abs(workspace.ownReach[informationSet] - own) > NUMERIC_TOLERANCE) {
      throw new Error(
        `${compiled.gameId} compact own reach disagrees at ${compiled.index.informationSets[informationSet].key}`,
      );
    }
    for (let action = 0; action < edgeCount; action += 1) {
      const edge = edgeStart + action;
      const child = compiled.edgeChildren[edge];
      const probability = workspace.strategy[compiled.edgeActionSlots[edge]];
      workspace.reach0[child] = player === 0
        ? workspace.reach0[node] * probability
        : workspace.reach0[node];
      workspace.reach1[child] = player === 1
        ? workspace.reach1[node] * probability
        : workspace.reach1[node];
      workspace.chanceReach[child] = workspace.chanceReach[node];
    }
  }
}

function backwardValuesAndRegrets<Action extends string>(
  compiled: CompiledCompactGame<Action>,
  workspace: CompactWorkspace,
  targetPlayer: SolverPlayer | null,
): void {
  workspace.regretDeltas.fill(0);
  for (let ordinal = 0; ordinal < compiled.index.totalStates; ordinal += 1) {
    const node = compiled.nodePostorder[ordinal];
    const kind = compiled.nodeKinds[node];
    if (kind === TERMINAL_NODE) {
      workspace.value0[node] = compiled.terminalUtility0[node];
      workspace.value1[node] = compiled.terminalUtility1[node];
      continue;
    }
    const edgeStart = compiled.nodeEdgeStarts[node];
    const edgeCount = compiled.nodeEdgeCounts[node];
    let value0 = 0;
    let value1 = 0;
    if (kind === CHANCE_NODE) {
      for (let action = 0; action < edgeCount; action += 1) {
        const edge = edgeStart + action;
        const probability = compiled.edgeChanceProbabilities[edge];
        const child = compiled.edgeChildren[edge];
        value0 += probability * workspace.value0[child];
        value1 += probability * workspace.value1[child];
      }
    } else {
      for (let action = 0; action < edgeCount; action += 1) {
        const edge = edgeStart + action;
        const probability = workspace.strategy[compiled.edgeActionSlots[edge]];
        const child = compiled.edgeChildren[edge];
        value0 += probability * workspace.value0[child];
        value1 += probability * workspace.value1[child];
      }
    }
    workspace.value0[node] = value0;
    workspace.value1[node] = value1;

    if (kind !== PLAYER_NODE) continue;
    const player = compiled.nodePlayers[node] as SolverPlayer;
    if (targetPlayer !== null && player !== targetPlayer) continue;
    const counterfactualReach = workspace.chanceReach[node]
      * (player === 0 ? workspace.reach1[node] : workspace.reach0[node]);
    const mixedValue = player === 0 ? value0 : value1;
    for (let action = 0; action < edgeCount; action += 1) {
      const edge = edgeStart + action;
      const child = compiled.edgeChildren[edge];
      const actionValue = player === 0 ? workspace.value0[child] : workspace.value1[child];
      workspace.regretDeltas[compiled.edgeActionSlots[edge]] += counterfactualReach
        * (actionValue - mixedValue);
    }
  }
}

function applyRegrets<Action extends string>(
  compiled: CompiledCompactGame<Action>,
  workspace: CompactWorkspace,
  player: SolverPlayer | null,
  clipNegative: boolean,
): void {
  for (let informationSet = 0; informationSet < compiled.index.informationSets.length; informationSet += 1) {
    if (player !== null && compiled.informationSetPlayers[informationSet] !== player) continue;
    const start = compiled.informationSetActionStarts[informationSet];
    const count = compiled.informationSetActionCounts[informationSet];
    for (let action = 0; action < count; action += 1) {
      const slot = start + action;
      const updated = workspace.cumulativeRegrets[slot] + workspace.regretDeltas[slot];
      workspace.cumulativeRegrets[slot] = clipNegative ? Math.max(0, updated) : updated;
      if (!Number.isFinite(workspace.cumulativeRegrets[slot])) {
        throw new Error(
          `Non-finite compact regret at ${compiled.index.informationSets[informationSet].key}`,
        );
      }
    }
  }
}

function accumulateAverage<Action extends string>(
  compiled: CompiledCompactGame<Action>,
  workspace: CompactWorkspace,
  weight: number,
): void {
  if (weight <= 0) return;
  for (let informationSet = 0; informationSet < compiled.index.informationSets.length; informationSet += 1) {
    const reach = workspace.ownReach[informationSet];
    if (!Number.isFinite(reach)) {
      throw new Error(`Missing compact own reach at ${compiled.index.informationSets[informationSet].key}`);
    }
    const start = compiled.informationSetActionStarts[informationSet];
    const count = compiled.informationSetActionCounts[informationSet];
    for (let action = 0; action < count; action += 1) {
      workspace.strategySums[start + action] += weight * reach * workspace.strategy[start + action];
    }
  }
}

function decodedStrategy<Action extends string>(
  compiled: CompiledCompactGame<Action>,
  probabilities: Float64Array,
): BehavioralStrategy<Action> {
  return new Map(compiled.index.informationSets.map((definition, informationSet) => {
    const start = compiled.informationSetActionStarts[informationSet];
    const count = compiled.informationSetActionCounts[informationSet];
    return [definition.key, {
      actions: [...definition.actions],
      probabilities: Array.from(probabilities.subarray(start, start + count)),
    }] as const;
  }));
}

function averageStrategy<Action extends string>(
  compiled: CompiledCompactGame<Action>,
  workspace: CompactWorkspace,
): BehavioralStrategy<Action> {
  const probabilities = new Float64Array(compiled.actionSlotCount);
  for (let informationSet = 0; informationSet < compiled.index.informationSets.length; informationSet += 1) {
    const start = compiled.informationSetActionStarts[informationSet];
    const count = compiled.informationSetActionCounts[informationSet];
    let sum = 0;
    for (let action = 0; action < count; action += 1) sum += workspace.strategySums[start + action];
    for (let action = 0; action < count; action += 1) {
      probabilities[start + action] = sum > 0
        ? workspace.strategySums[start + action] / sum
        : workspace.strategy[start + action];
    }
  }
  return decodedStrategy(compiled, probabilities);
}

function regretMap<Action extends string>(
  compiled: CompiledCompactGame<Action>,
  workspace: CompactWorkspace,
): ReadonlyMap<InformationSetKey, readonly number[]> {
  return new Map(compiled.index.informationSets.map((definition, informationSet) => {
    const start = compiled.informationSetActionStarts[informationSet];
    const count = compiled.informationSetActionCounts[informationSet];
    return [definition.key, Array.from(workspace.cumulativeRegrets.subarray(start, start + count))] as const;
  }));
}

/**
 * Solve a precompiled game. `vanilla` matches the readable simultaneous-update CFR;
 * `cfr-plus` is alternating regret-matching+ with delayed linear averaging.
 */
export function solveCompiledCompactCfr<Action extends string>(
  compiled: CompiledCompactGame<Action>,
  input: CompactCfrOptions,
): CompactCfrSolveResult<Action> {
  const options = validateOptions(input);
  const workspace = createWorkspace(compiled);
  const requestedCheckpoints = new Set(options.checkpointIterations);
  const checkpoints: CompactCfrCheckpoint<Action>[] = [];

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    if (options.algorithm === "vanilla") {
      rebuildStrategy(compiled, workspace);
      forwardReach(compiled, workspace);
      backwardValuesAndRegrets(compiled, workspace, null);
      accumulateAverage(compiled, workspace, 1);
      applyRegrets(compiled, workspace, null, false);
    } else {
      for (const player of [0, 1] as const) {
        rebuildStrategy(compiled, workspace);
        forwardReach(compiled, workspace);
        backwardValuesAndRegrets(compiled, workspace, player);
        applyRegrets(compiled, workspace, player, true);
      }
      rebuildStrategy(compiled, workspace);
      forwardReach(compiled, workspace);
      accumulateAverage(compiled, workspace, Math.max(0, iteration - options.averagingDelay));
    }

    if (requestedCheckpoints.has(iteration)) {
      checkpoints.push({ iteration, averageStrategy: averageStrategy(compiled, workspace) });
    }
  }

  rebuildStrategy(compiled, workspace);
  const currentStrategy = decodedStrategy(compiled, workspace.strategy);
  const savedAverageStrategy = averageStrategy(compiled, workspace);
  validateStrategy(compiled.index, currentStrategy);
  validateStrategy(compiled.index, savedAverageStrategy);
  const workingArrays: readonly ArrayBufferView[] = Object.values(workspace);
  return {
    gameId: compiled.gameId,
    algorithm: options.algorithm === "vanilla"
      ? "compact-full-tree-cfr"
      : "compact-alternating-cfr-plus",
    algorithmVersion: 1,
    iterations: options.iterations,
    averagingDelay: options.averagingDelay,
    fullTreeRegretPasses: options.iterations * (options.algorithm === "vanilla" ? 1 : 2),
    reachOnlyPasses: options.algorithm === "vanilla" ? 0 : options.iterations,
    index: compiled.index,
    compiled,
    currentStrategy,
    averageStrategy: savedAverageStrategy,
    cumulativeRegrets: regretMap(compiled, workspace),
    checkpoints,
    workingStorageBytes: typedArrayBytes(workingArrays),
  };
}

/** Compile and solve one finite game without modifying the readable source engine. */
export function solveCompactCfr<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  options: CompactCfrOptions,
): CompactCfrSolveResult<Action> {
  return solveCompiledCompactCfr(compileCompactGame(game), options);
}
