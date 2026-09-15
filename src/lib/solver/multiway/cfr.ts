import {
  buildMultiwayGameTreeIndex,
  validateMultiwayStrategy,
  type MultiwayBehavioralStrategy,
  type MultiwayExtensiveFormGame,
  type MultiwayGameTreeIndex,
  type MultiwayStrategyEntry,
  type MultiwayUtility,
} from "./game";
import type { InformationSetKey } from "../toy/game";

export interface MultiwayCfrCheckpoint<Action extends string> {
  readonly iteration: number;
  readonly averageStrategy: MultiwayBehavioralStrategy<Action>;
}

export interface MultiwayCfrSolveResult<Action extends string> {
  readonly gameId: string;
  readonly algorithm: "simultaneous-full-tree-cfr";
  readonly algorithmVersion: 1;
  readonly iterations: number;
  readonly index: MultiwayGameTreeIndex<Action>;
  readonly currentStrategy: MultiwayBehavioralStrategy<Action>;
  readonly averageStrategy: MultiwayBehavioralStrategy<Action>;
  readonly cumulativeRegrets: ReadonlyMap<InformationSetKey, readonly number[]>;
  readonly checkpoints: readonly MultiwayCfrCheckpoint<Action>[];
}

interface MutableInformationSet<Action extends string> {
  readonly player: number;
  readonly actions: readonly Action[];
  readonly cumulativeRegrets: number[];
  readonly strategySum: number[];
}

type CfrNode<Action extends string> =
  | {
      readonly kind: "terminal";
      readonly utility: MultiwayUtility;
      readonly value: number[];
    }
  | {
      readonly kind: "chance";
      readonly children: readonly { readonly probability: number; readonly node: CfrNode<Action> }[];
      readonly value: number[];
    }
  | {
      readonly kind: "player";
      readonly player: number;
      readonly informationSet: InformationSetKey;
      readonly actions: readonly Action[];
      readonly children: readonly CfrNode<Action>[];
      readonly value: number[];
    };

export interface MultiwayCfrOptions {
  readonly iterations: number;
  readonly checkpointIterations?: readonly number[];
  readonly updateOrder?: readonly number[];
}

function validateOptions(options: MultiwayCfrOptions, playerCount: number): readonly number[] {
  if (!Number.isSafeInteger(options.iterations) || options.iterations <= 0) {
    throw new Error(`CFR iterations must be a positive safe integer, got ${options.iterations}`);
  }
  for (const checkpoint of options.checkpointIterations ?? []) {
    if (!Number.isSafeInteger(checkpoint) || checkpoint <= 0 || checkpoint > options.iterations) {
      throw new Error(`Invalid CFR checkpoint ${checkpoint} for ${options.iterations} iterations`);
    }
  }
  const updateOrder = options.updateOrder ?? Array.from({ length: playerCount }, (_, player) => player);
  if (
    updateOrder.length !== playerCount ||
    new Set(updateOrder).size !== playerCount ||
    updateOrder.some(player => !Number.isSafeInteger(player) || player < 0 || player >= playerCount)
  ) {
    throw new Error(`CFR update order must contain every player exactly once`);
  }
  return updateOrder;
}

function strategyAt<Action extends string>(
  strategy: MultiwayBehavioralStrategy<Action>,
  key: InformationSetKey,
): MultiwayStrategyEntry<Action> {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing CFR strategy at ${key}`);
  return entry;
}

function regretMatchedStrategy<Action extends string>(
  tables: ReadonlyMap<InformationSetKey, MutableInformationSet<Action>>,
): MultiwayBehavioralStrategy<Action> {
  return new Map([...tables].map(([key, table]) => {
    const positive = table.cumulativeRegrets.map(regret => Math.max(0, regret));
    const total = positive.reduce((sum, regret) => sum + regret, 0);
    return [key, {
      actions: [...table.actions],
      probabilities: total > 0
        ? positive.map(regret => regret / total)
        : table.actions.map(() => 1 / table.actions.length),
    }];
  }));
}

function averageStrategy<Action extends string>(
  tables: ReadonlyMap<InformationSetKey, MutableInformationSet<Action>>,
  fallback: MultiwayBehavioralStrategy<Action>,
): MultiwayBehavioralStrategy<Action> {
  return new Map([...tables].map(([key, table]) => {
    const total = table.strategySum.reduce((sum, value) => sum + value, 0);
    return [key, {
      actions: [...table.actions],
      probabilities: total > 0
        ? table.strategySum.map(value => value / total)
        : [...(fallback.get(key)?.probabilities ?? table.actions.map(() => 1 / table.actions.length))],
    }];
  }));
}

function buildCfrTree<State, Action extends string, ChanceOutcome>(
  game: MultiwayExtensiveFormGame<State, Action, ChanceOutcome>,
  index: MultiwayGameTreeIndex<Action>,
): CfrNode<Action> {
  let stateCount = 0;
  const visit = (state: State): CfrNode<Action> => {
    stateCount += 1;
    if (stateCount > index.totalStates) throw new Error(`${game.id} changed while CFR compiled its tree`);
    const node = game.node(state);
    if (node.kind === "terminal") {
      return { kind: "terminal", utility: node.utility, value: [...node.utility] };
    }
    if (node.kind === "chance") {
      return {
        kind: "chance",
        value: Array.from({ length: game.playerCount }, () => 0),
        children: node.outcomes.map(({ outcome, probability }) => ({
          probability,
          node: visit(game.nextChance(state, outcome)),
        })),
      };
    }
    return {
      kind: "player",
      player: node.player,
      informationSet: game.informationSet(state, node.player),
      actions: [...node.actions],
      children: node.actions.map(action => visit(game.nextAction(state, action))),
      value: Array.from({ length: game.playerCount }, () => 0),
    };
  };
  const root = visit(game.initialState());
  if (stateCount !== index.totalStates) {
    throw new Error(`${game.id} CFR tree has ${stateCount} states; its index has ${index.totalStates}`);
  }
  return root;
}

interface IterationData {
  readonly deltas: readonly ReadonlyMap<InformationSetKey, readonly number[]>[];
  readonly ownReach: ReadonlyMap<InformationSetKey, number>;
}

function collectIterationData<Action extends string>(
  gameId: string,
  playerCount: number,
  root: CfrNode<Action>,
  strategy: MultiwayBehavioralStrategy<Action>,
  tables: ReadonlyMap<InformationSetKey, MutableInformationSet<Action>>,
): IterationData {
  const deltas = Array.from({ length: playerCount }, (_, player) => new Map(
    [...tables].filter(([, table]) => table.player === player)
      .map(([key, table]) => [key, table.actions.map(() => 0)]),
  ));
  const ownReach = new Map<InformationSetKey, number>();

  // Every compiled node owns one reusable value vector. Avoiding a fresh vector at
  // every state on every iteration cuts the exact audit run's allocation load sharply.
  const visit = (node: CfrNode<Action>, reach: number[], chanceReach: number): readonly number[] => {
    if (node.kind === "terminal") return node.value;
    if (node.kind === "chance") {
      node.value.fill(0);
      for (const child of node.children) {
        const childValue = visit(child.node, reach, chanceReach * child.probability);
        for (let player = 0; player < playerCount; player += 1) {
          node.value[player] += child.probability * childValue[player];
        }
      }
      return node.value;
    }

    const priorOwnReach = ownReach.get(node.informationSet);
    const playerReach = reach[node.player];
    if (priorOwnReach === undefined) ownReach.set(node.informationSet, playerReach);
    else if (Math.abs(priorOwnReach - playerReach) > 1e-12) {
      throw new Error(
        `${gameId} information set ${node.informationSet} violates perfect recall: ` +
        `own reach ${priorOwnReach} vs ${playerReach}`,
      );
    }

    const entry = strategyAt(strategy, node.informationSet);
    const savedPlayerReach = reach[node.player];
    for (let actionIndex = 0; actionIndex < node.children.length; actionIndex += 1) {
      reach[node.player] = savedPlayerReach * entry.probabilities[actionIndex];
      visit(node.children[actionIndex], reach, chanceReach);
    }
    reach[node.player] = savedPlayerReach;
    node.value.fill(0);
    for (let actionIndex = 0; actionIndex < node.children.length; actionIndex += 1) {
      for (let player = 0; player < playerCount; player += 1) {
        node.value[player] += entry.probabilities[actionIndex] * node.children[actionIndex].value[player];
      }
    }

    let counterfactualReach = chanceReach;
    for (let player = 0; player < playerCount; player += 1) {
      if (player !== node.player) counterfactualReach *= reach[player];
    }
    const regretDelta = deltas[node.player].get(node.informationSet);
    if (!regretDelta) throw new Error(`Missing regret accumulator at ${node.informationSet}`);
    for (let actionIndex = 0; actionIndex < node.children.length; actionIndex += 1) {
      regretDelta[actionIndex] += counterfactualReach *
        (node.children[actionIndex].value[node.player] - node.value[node.player]);
    }
    return node.value;
  };

  visit(root, Array.from({ length: playerCount }, () => 1), 1);
  return { deltas, ownReach };
}

export function solveMultiwayCfr<State, Action extends string, ChanceOutcome>(
  game: MultiwayExtensiveFormGame<State, Action, ChanceOutcome>,
  options: MultiwayCfrOptions,
): MultiwayCfrSolveResult<Action> {
  const updateOrder = validateOptions(options, game.playerCount);
  const index = buildMultiwayGameTreeIndex(game);
  const tables = new Map<InformationSetKey, MutableInformationSet<Action>>(
    index.informationSets.map(definition => [definition.key, {
      player: definition.player,
      actions: [...definition.actions],
      cumulativeRegrets: definition.actions.map(() => 0),
      strategySum: definition.actions.map(() => 0),
    }]),
  );
  const tree = buildCfrTree(game, index);
  const requestedCheckpoints = new Set(options.checkpointIterations ?? []);
  const checkpoints: MultiwayCfrCheckpoint<Action>[] = [];
  let currentStrategy = regretMatchedStrategy(tables);

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    currentStrategy = regretMatchedStrategy(tables);
    const { deltas, ownReach } = collectIterationData(
      game.id,
      game.playerCount,
      tree,
      currentStrategy,
      tables,
    );
    for (const [key, table] of tables) {
      const reach = ownReach.get(key);
      if (reach === undefined) throw new Error(`Missing own reach at ${key}`);
      const entry = strategyAt(currentStrategy, key);
      for (let actionIndex = 0; actionIndex < table.actions.length; actionIndex += 1) {
        table.strategySum[actionIndex] += reach * entry.probabilities[actionIndex];
      }
    }
    for (const player of updateOrder) {
      for (const [key, values] of deltas[player]) {
        const table = tables.get(key);
        if (!table) throw new Error(`Missing CFR table at ${key}`);
        for (let actionIndex = 0; actionIndex < values.length; actionIndex += 1) {
          table.cumulativeRegrets[actionIndex] += values[actionIndex];
          if (!Number.isFinite(table.cumulativeRegrets[actionIndex])) {
            throw new Error(`Non-finite cumulative regret at ${key}`);
          }
        }
      }
    }
    if (requestedCheckpoints.has(iteration)) {
      checkpoints.push({ iteration, averageStrategy: averageStrategy(tables, currentStrategy) });
    }
  }

  currentStrategy = regretMatchedStrategy(tables);
  const averaged = averageStrategy(tables, currentStrategy);
  validateMultiwayStrategy(index, currentStrategy);
  validateMultiwayStrategy(index, averaged);
  return {
    gameId: game.id,
    algorithm: "simultaneous-full-tree-cfr",
    algorithmVersion: 1,
    iterations: options.iterations,
    index,
    currentStrategy,
    averageStrategy: averaged,
    cumulativeRegrets: new Map([...tables].map(([key, table]) => [key, [...table.cumulativeRegrets]])),
    checkpoints,
  };
}
