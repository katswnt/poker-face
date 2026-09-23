import {
  validateStrategy,
  type BehavioralStrategy,
  type InformationSetKey,
  type SolverPlayer,
} from "../../toy/game";
import type { ConfigurableRiverAction } from "../configurable/game";
import {
  FACTORIZED_TERMINAL_NODE,
  factorizedInformationSet,
  factorizedTerminalUtility0,
  type CompiledFactorizedRiverGame,
} from "./game";

const NUMERIC_TOLERANCE = 1e-12;

export type FactorizedRiverAlgorithm = "vanilla" | "cfr-plus";

export interface FactorizedRiverCfrOptions {
  readonly iterations: number;
  readonly algorithm?: FactorizedRiverAlgorithm;
  readonly averagingDelay?: number;
  readonly checkpointIterations?: readonly number[];
}

export interface FactorizedRiverCfrCheckpoint {
  readonly iteration: number;
  readonly averageStrategy: BehavioralStrategy<ConfigurableRiverAction>;
}

export interface FactorizedRiverCfrResult {
  readonly gameId: string;
  readonly algorithm: "factorized-river-full-tree-cfr" | "factorized-river-alternating-cfr-plus";
  readonly algorithmVersion: 1;
  readonly iterations: number;
  readonly averagingDelay: number;
  readonly fullDealRegretPasses: number;
  readonly reachOnlyPasses: number;
  readonly compiled: CompiledFactorizedRiverGame;
  readonly currentStrategy: BehavioralStrategy<ConfigurableRiverAction>;
  readonly averageStrategy: BehavioralStrategy<ConfigurableRiverAction>;
  readonly cumulativeRegrets: ReadonlyMap<InformationSetKey, readonly number[]>;
  readonly checkpoints: readonly FactorizedRiverCfrCheckpoint[];
  readonly workingStorageBytes: number;
}

interface FactorizedWorkspace {
  readonly cumulativeRegrets: Float64Array;
  readonly strategySums: Float64Array;
  readonly strategy: Float64Array;
  readonly regretDeltas: Float64Array;
  readonly reach0: Float64Array;
  readonly reach1: Float64Array;
  readonly ownReach: Float64Array;
  readonly value0: Float64Array;
}

function typedArrayBytes(arrays: readonly ArrayBufferView[]): number {
  return arrays.reduce((sum, array) => sum + array.byteLength, 0);
}

function validateOptions(
  input: FactorizedRiverCfrOptions,
): Required<FactorizedRiverCfrOptions> {
  if (!Number.isSafeInteger(input.iterations) || input.iterations <= 0) {
    throw new Error(`Factorized CFR iterations must be a positive safe integer, got ${input.iterations}`);
  }
  const algorithm = input.algorithm ?? "vanilla";
  const averagingDelay = input.averagingDelay ?? 0;
  if (!Number.isSafeInteger(averagingDelay) || averagingDelay < 0) {
    throw new Error(`Factorized CFR averaging delay must be non-negative, got ${averagingDelay}`);
  }
  if (algorithm === "vanilla" && averagingDelay !== 0) {
    throw new Error("Ordinary factorized CFR does not use an averaging delay");
  }
  const checkpointIterations = [...(input.checkpointIterations ?? [])];
  for (const checkpoint of checkpointIterations) {
    if (!Number.isSafeInteger(checkpoint) || checkpoint <= 0 || checkpoint > input.iterations) {
      throw new Error(`Invalid factorized CFR checkpoint ${checkpoint}`);
    }
  }
  return { iterations: input.iterations, algorithm, averagingDelay, checkpointIterations };
}

function createWorkspace(game: CompiledFactorizedRiverGame): FactorizedWorkspace {
  return {
    cumulativeRegrets: new Float64Array(game.actionSlotCount),
    strategySums: new Float64Array(game.actionSlotCount),
    strategy: new Float64Array(game.actionSlotCount),
    regretDeltas: new Float64Array(game.actionSlotCount),
    reach0: new Float64Array(game.publicNodeCount),
    reach1: new Float64Array(game.publicNodeCount),
    ownReach: new Float64Array(game.index.informationSets.length),
    value0: new Float64Array(game.publicNodeCount),
  };
}

function rebuildStrategy(game: CompiledFactorizedRiverGame, workspace: FactorizedWorkspace): void {
  for (let informationSet = 0; informationSet < game.index.informationSets.length; informationSet += 1) {
    const start = game.informationSetActionStarts[informationSet];
    const count = game.informationSetActionCounts[informationSet];
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

function forwardDeal(
  game: CompiledFactorizedRiverGame,
  workspace: FactorizedWorkspace,
  deal: number,
): void {
  workspace.reach0[0] = 1;
  workspace.reach1[0] = 1;
  for (let publicNode = 0; publicNode < game.publicNodeCount; publicNode += 1) {
    if (game.nodeKinds[publicNode] === FACTORIZED_TERMINAL_NODE) continue;
    const player = game.nodePlayers[publicNode] as SolverPlayer;
    const informationSet = factorizedInformationSet(game, deal, publicNode);
    const own = player === 0 ? workspace.reach0[publicNode] : workspace.reach1[publicNode];
    const earlier = workspace.ownReach[informationSet];
    if (Number.isNaN(earlier)) {
      workspace.ownReach[informationSet] = own;
    } else if (Math.abs(earlier - own) > NUMERIC_TOLERANCE) {
      throw new Error(
        `${game.gameId} own reach disagrees at ${game.index.informationSets[informationSet].key}`,
      );
    }
    const edgeStart = game.nodeEdgeStarts[publicNode];
    const edgeCount = game.nodeEdgeCounts[publicNode];
    const actionStart = game.informationSetActionStarts[informationSet];
    for (let action = 0; action < edgeCount; action += 1) {
      const child = game.edgeChildren[edgeStart + action];
      const probability = workspace.strategy[actionStart + action];
      workspace.reach0[child] = player === 0
        ? workspace.reach0[publicNode] * probability
        : workspace.reach0[publicNode];
      workspace.reach1[child] = player === 1
        ? workspace.reach1[publicNode] * probability
        : workspace.reach1[publicNode];
    }
  }
}

function backwardDeal(
  game: CompiledFactorizedRiverGame,
  workspace: FactorizedWorkspace,
  deal: number,
  targetPlayer: SolverPlayer | null,
): void {
  for (let ordinal = 0; ordinal < game.publicNodeCount; ordinal += 1) {
    const publicNode = game.nodePostorder[ordinal];
    if (game.nodeKinds[publicNode] === FACTORIZED_TERMINAL_NODE) {
      workspace.value0[publicNode] = factorizedTerminalUtility0(game, deal, publicNode);
      continue;
    }
    const player = game.nodePlayers[publicNode] as SolverPlayer;
    const informationSet = factorizedInformationSet(game, deal, publicNode);
    const edgeStart = game.nodeEdgeStarts[publicNode];
    const edgeCount = game.nodeEdgeCounts[publicNode];
    const actionStart = game.informationSetActionStarts[informationSet];
    let mixedValue0 = 0;
    for (let action = 0; action < edgeCount; action += 1) {
      mixedValue0 += workspace.strategy[actionStart + action]
        * workspace.value0[game.edgeChildren[edgeStart + action]];
    }
    workspace.value0[publicNode] = mixedValue0;
    if (targetPlayer !== null && player !== targetPlayer) continue;
    const counterfactualReach = game.dealProbabilities[deal]
      * (player === 0 ? workspace.reach1[publicNode] : workspace.reach0[publicNode]);
    const mixedValue = player === 0 ? mixedValue0 : -mixedValue0;
    for (let action = 0; action < edgeCount; action += 1) {
      const actionValue0 = workspace.value0[game.edgeChildren[edgeStart + action]];
      const actionValue = player === 0 ? actionValue0 : -actionValue0;
      workspace.regretDeltas[actionStart + action] += counterfactualReach
        * (actionValue - mixedValue);
    }
  }
}

function regretPass(
  game: CompiledFactorizedRiverGame,
  workspace: FactorizedWorkspace,
  targetPlayer: SolverPlayer | null,
): void {
  workspace.regretDeltas.fill(0);
  workspace.ownReach.fill(Number.NaN);
  for (let deal = 0; deal < game.dealProbabilities.length; deal += 1) {
    forwardDeal(game, workspace, deal);
    backwardDeal(game, workspace, deal, targetPlayer);
  }
}

function reachOnlyPass(game: CompiledFactorizedRiverGame, workspace: FactorizedWorkspace): void {
  workspace.ownReach.fill(Number.NaN);
  for (let deal = 0; deal < game.dealProbabilities.length; deal += 1) {
    forwardDeal(game, workspace, deal);
  }
}

function applyRegrets(
  game: CompiledFactorizedRiverGame,
  workspace: FactorizedWorkspace,
  player: SolverPlayer | null,
  clipNegative: boolean,
): void {
  for (let informationSet = 0; informationSet < game.index.informationSets.length; informationSet += 1) {
    if (player !== null && game.informationSetPlayers[informationSet] !== player) continue;
    const start = game.informationSetActionStarts[informationSet];
    const count = game.informationSetActionCounts[informationSet];
    for (let action = 0; action < count; action += 1) {
      const slot = start + action;
      const updated = workspace.cumulativeRegrets[slot] + workspace.regretDeltas[slot];
      workspace.cumulativeRegrets[slot] = clipNegative ? Math.max(0, updated) : updated;
      if (!Number.isFinite(workspace.cumulativeRegrets[slot])) {
        throw new Error(`Non-finite factorized regret at ${game.index.informationSets[informationSet].key}`);
      }
    }
  }
}

function accumulateAverage(
  game: CompiledFactorizedRiverGame,
  workspace: FactorizedWorkspace,
  weight: number,
): void {
  if (weight <= 0) return;
  for (let informationSet = 0; informationSet < game.index.informationSets.length; informationSet += 1) {
    const reach = workspace.ownReach[informationSet];
    if (!Number.isFinite(reach)) {
      throw new Error(`Missing factorized own reach at ${game.index.informationSets[informationSet].key}`);
    }
    const start = game.informationSetActionStarts[informationSet];
    const count = game.informationSetActionCounts[informationSet];
    for (let action = 0; action < count; action += 1) {
      workspace.strategySums[start + action] += weight * reach * workspace.strategy[start + action];
    }
  }
}

function decodedStrategy(
  game: CompiledFactorizedRiverGame,
  probabilities: Float64Array,
): BehavioralStrategy<ConfigurableRiverAction> {
  return new Map(game.index.informationSets.map((definition, informationSet) => {
    const start = game.informationSetActionStarts[informationSet];
    const count = game.informationSetActionCounts[informationSet];
    return [definition.key, {
      actions: [...definition.actions],
      probabilities: Array.from(probabilities.subarray(start, start + count)),
    }] as const;
  }));
}

function averageStrategy(
  game: CompiledFactorizedRiverGame,
  workspace: FactorizedWorkspace,
): BehavioralStrategy<ConfigurableRiverAction> {
  const probabilities = new Float64Array(game.actionSlotCount);
  for (let informationSet = 0; informationSet < game.index.informationSets.length; informationSet += 1) {
    const start = game.informationSetActionStarts[informationSet];
    const count = game.informationSetActionCounts[informationSet];
    let sum = 0;
    for (let action = 0; action < count; action += 1) sum += workspace.strategySums[start + action];
    for (let action = 0; action < count; action += 1) {
      probabilities[start + action] = sum > 0
        ? workspace.strategySums[start + action] / sum
        : workspace.strategy[start + action];
    }
  }
  return decodedStrategy(game, probabilities);
}

function regretMap(
  game: CompiledFactorizedRiverGame,
  workspace: FactorizedWorkspace,
): ReadonlyMap<InformationSetKey, readonly number[]> {
  return new Map(game.index.informationSets.map((definition, informationSet) => {
    const start = game.informationSetActionStarts[informationSet];
    const count = game.informationSetActionCounts[informationSet];
    return [definition.key, Array.from(workspace.cumulativeRegrets.subarray(start, start + count))] as const;
  }));
}

export interface FactorizedRiverCfrSession {
  readonly iterations: number;
  readonly done: boolean;
  /** Advance this same workspace. Chunk boundaries do not change the arithmetic. */
  advance(iterations: number): void;
  /** Detached numeric results; inspecting a session does not reset its averages. */
  snapshot(): FactorizedRiverCfrResult;
}

/** A resumable, deterministic session with no timers, browser APIs, or React dependency. */
export function createFactorizedRiverCfrSession(
  game: CompiledFactorizedRiverGame,
  input: FactorizedRiverCfrOptions,
): FactorizedRiverCfrSession {
  const options = validateOptions(input);
  const workspace = createWorkspace(game);
  const requestedCheckpoints = new Set(options.checkpointIterations);
  const checkpoints: FactorizedRiverCfrCheckpoint[] = [];
  let completed = 0;

  function advance(count: number): void {
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new Error("CFR session chunk must be a positive safe integer");
    }
    const end = completed + Math.min(count, options.iterations - completed);
    for (let iteration = completed + 1; iteration <= end; iteration += 1) {
      if (options.algorithm === "vanilla") {
        rebuildStrategy(game, workspace);
        regretPass(game, workspace, null);
        accumulateAverage(game, workspace, 1);
        applyRegrets(game, workspace, null, false);
      } else {
        for (const player of [0, 1] as const) {
          rebuildStrategy(game, workspace);
          regretPass(game, workspace, player);
          applyRegrets(game, workspace, player, true);
        }
        rebuildStrategy(game, workspace);
        reachOnlyPass(game, workspace);
        accumulateAverage(game, workspace, Math.max(0, iteration - options.averagingDelay));
      }
      if (requestedCheckpoints.has(iteration)) {
        checkpoints.push({ iteration, averageStrategy: averageStrategy(game, workspace) });
      }
      completed = iteration;
    }
  }

  function snapshot(): FactorizedRiverCfrResult {
    rebuildStrategy(game, workspace);
    const currentStrategy = decodedStrategy(game, workspace.strategy);
    const savedAverageStrategy = averageStrategy(game, workspace);
    validateStrategy(game.index, currentStrategy);
    validateStrategy(game.index, savedAverageStrategy);
    return {
      gameId: game.gameId,
      algorithm: options.algorithm === "vanilla"
        ? "factorized-river-full-tree-cfr"
        : "factorized-river-alternating-cfr-plus",
      algorithmVersion: 1,
      iterations: completed,
      averagingDelay: options.averagingDelay,
      fullDealRegretPasses: completed * (options.algorithm === "vanilla" ? 1 : 2),
      reachOnlyPasses: options.algorithm === "vanilla" ? 0 : completed,
      compiled: game,
      currentStrategy,
      averageStrategy: savedAverageStrategy,
      cumulativeRegrets: regretMap(game, workspace),
      checkpoints: [...checkpoints],
      workingStorageBytes: typedArrayBytes(Object.values(workspace)),
    };
  }
  return {
    get iterations() { return completed; },
    get done() { return completed === options.iterations; },
    advance,
    snapshot,
  };
}

/** The script API and resumable API execute exactly the same iterations. */
export function solveCompiledFactorizedRiverCfr(
  game: CompiledFactorizedRiverGame,
  input: FactorizedRiverCfrOptions,
): FactorizedRiverCfrResult {
  const session = createFactorizedRiverCfrSession(game, input);
  session.advance(input.iterations);
  return session.snapshot();
}
