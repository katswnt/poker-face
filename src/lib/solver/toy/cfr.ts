import {
  buildGameTreeIndex,
  validateStrategy,
  type BehavioralStrategy,
  type ExtensiveFormGame,
  type GameTreeIndex,
  type InformationSetKey,
  type SolverPlayer,
  type StrategyEntry,
} from "./game";

export interface CfrCheckpoint<Action extends string> {
  readonly iteration: number;
  readonly averageStrategy: BehavioralStrategy<Action>;
}

export interface CfrSolveResult<Action extends string> {
  readonly gameId: string;
  readonly algorithm: "full-tree-cfr";
  readonly algorithmVersion: 1;
  readonly iterations: number;
  readonly index: GameTreeIndex<Action>;
  readonly currentStrategy: BehavioralStrategy<Action>;
  readonly averageStrategy: BehavioralStrategy<Action>;
  readonly cumulativeRegrets: ReadonlyMap<InformationSetKey, readonly number[]>;
  readonly checkpoints: readonly CfrCheckpoint<Action>[];
}

interface MutableInformationSet<Action extends string> {
  readonly player: SolverPlayer;
  readonly actions: readonly Action[];
  readonly cumulativeRegrets: number[];
  readonly strategySum: number[];
}

type CfrTreeNode<Action extends string> =
  | {
      readonly id: number;
      readonly kind: "terminal";
      readonly utility: readonly [number, number];
    }
  | {
      readonly id: number;
      readonly kind: "chance";
      readonly children: readonly {
        readonly probability: number;
        readonly node: CfrTreeNode<Action>;
      }[];
    }
  | {
      readonly id: number;
      readonly kind: "player";
      readonly player: SolverPlayer;
      readonly informationSet: InformationSetKey;
      readonly actions: readonly Action[];
      readonly children: readonly CfrTreeNode<Action>[];
    };

export interface CfrOptions {
  readonly iterations: number;
  readonly checkpointIterations?: readonly number[];
  readonly updateOrder?: readonly [SolverPlayer, SolverPlayer];
}

const REACH_TOLERANCE = 1e-12;

function validateOptions(options: CfrOptions): void {
  if (!Number.isSafeInteger(options.iterations) || options.iterations <= 0) {
    throw new Error(`CFR iterations must be a positive safe integer, got ${options.iterations}`);
  }
  if (options.updateOrder) {
    const [first, second] = options.updateOrder;
    if (first === second || (first !== 0 && first !== 1) || (second !== 0 && second !== 1)) {
      throw new Error(`CFR update order must contain player 0 and player 1 exactly once`);
    }
  }
  for (const checkpoint of options.checkpointIterations ?? []) {
    if (!Number.isSafeInteger(checkpoint) || checkpoint <= 0 || checkpoint > options.iterations) {
      throw new Error(`Invalid CFR checkpoint ${checkpoint} for ${options.iterations} iterations`);
    }
  }
}

function regretMatchedStrategy<Action extends string>(
  tables: ReadonlyMap<InformationSetKey, MutableInformationSet<Action>>,
): BehavioralStrategy<Action> {
  const strategy = new Map<InformationSetKey, StrategyEntry<Action>>();
  for (const [key, table] of tables) {
    const positive = table.cumulativeRegrets.map(regret => Math.max(0, regret));
    const positiveSum = positive.reduce((sum, regret) => sum + regret, 0);
    const probabilities = positiveSum > 0
      ? positive.map(regret => regret / positiveSum)
      : table.actions.map(() => 1 / table.actions.length);
    strategy.set(key, { actions: [...table.actions], probabilities });
  }
  return strategy;
}

function averagedStrategy<Action extends string>(
  tables: ReadonlyMap<InformationSetKey, MutableInformationSet<Action>>,
  fallback: BehavioralStrategy<Action>,
): BehavioralStrategy<Action> {
  const strategy = new Map<InformationSetKey, StrategyEntry<Action>>();
  for (const [key, table] of tables) {
    const sum = table.strategySum.reduce((total, value) => total + value, 0);
    const probabilities = sum > 0
      ? table.strategySum.map(value => value / sum)
      : [...(fallback.get(key)?.probabilities ?? table.actions.map(() => 1 / table.actions.length))];
    strategy.set(key, { actions: [...table.actions], probabilities });
  }
  return strategy;
}

function strategyAt<Action extends string>(
  strategy: BehavioralStrategy<Action>,
  key: InformationSetKey,
): StrategyEntry<Action> {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing CFR strategy at ${key}`);
  return entry;
}

/** Compile immutable states once so every CFR iteration only performs numeric work. */
function buildCfrTree<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  index: GameTreeIndex<Action>,
): CfrTreeNode<Action> {
  let nextId = 0;
  const visit = (state: State): CfrTreeNode<Action> => {
    const id = nextId;
    nextId += 1;
    if (nextId > index.totalStates) {
      throw new Error(`${game.id} changed while its CFR tree was being built`);
    }

    const node = game.node(state);
    if (node.kind === "terminal") return { id, kind: "terminal", utility: node.utility };
    if (node.kind === "chance") {
      return {
        id,
        kind: "chance",
        children: node.outcomes.map(({ outcome, probability }) => ({
          probability,
          node: visit(game.nextChance(state, outcome)),
        })),
      };
    }
    return {
      id,
      kind: "player",
      player: node.player,
      informationSet: game.informationSet(state, node.player),
      actions: [...node.actions],
      children: node.actions.map(action => visit(game.nextAction(state, action))),
    };
  };

  const root = visit(game.initialState());
  if (nextId !== index.totalStates) {
    throw new Error(`${game.id} CFR tree has ${nextId} states; its index has ${index.totalStates}`);
  }
  return root;
}

interface IterationData {
  readonly deltas: readonly [
    ReadonlyMap<InformationSetKey, readonly number[]>,
    ReadonlyMap<InformationSetKey, readonly number[]>,
  ];
  readonly ownReach: ReadonlyMap<InformationSetKey, number>;
}

function collectIterationData<Action extends string>(
  gameId: string,
  root: CfrTreeNode<Action>,
  strategy: BehavioralStrategy<Action>,
  tables: ReadonlyMap<InformationSetKey, MutableInformationSet<Action>>,
): IterationData {
  const deltas = ([0, 1] as const).map(player => new Map([...tables.entries()]
    .filter(([, table]) => table.player === player)
    .map(([key, table]) => [key, table.actions.map(() => 0)] as const))) as [
      Map<InformationSetKey, number[]>,
      Map<InformationSetKey, number[]>,
    ];
  const ownReach = new Map<InformationSetKey, number>();

  // One frozen-strategy traversal collects both players' regret changes plus
  // their own reach. Updates are applied only after this traversal returns.
  const visit = (
    node: CfrTreeNode<Action>,
    reach0: number,
    reach1: number,
    chanceReach: number,
  ): readonly [number, number] => {
    if (node.kind === "terminal") return node.utility;
    if (node.kind === "chance") {
      let value0 = 0;
      let value1 = 0;
      for (const child of node.children) {
        const childValue = visit(
          child.node,
          reach0,
          reach1,
          chanceReach * child.probability,
        );
        value0 += child.probability * childValue[0];
        value1 += child.probability * childValue[1];
      }
      return [value0, value1];
    }

    const reach = node.player === 0 ? reach0 : reach1;
    const priorReach = ownReach.get(node.informationSet);
    if (priorReach === undefined) {
      ownReach.set(node.informationSet, reach);
    } else if (Math.abs(priorReach - reach) > REACH_TOLERANCE) {
      throw new Error(
        `${gameId} information set ${node.informationSet} violates perfect recall: ` +
        `own reach ${priorReach} vs ${reach}`,
      );
    }

    const entry = strategyAt(strategy, node.informationSet);
    const actionValues = node.actions.map((_, actionIndex) => {
      const probability = entry.probabilities[actionIndex];
      return node.player === 0
        ? visit(node.children[actionIndex], reach0 * probability, reach1, chanceReach)
        : visit(node.children[actionIndex], reach0, reach1 * probability, chanceReach);
    });
    const mixedValue = actionValues.reduce<readonly [number, number]>(
      (value, actionValue, actionIndex) => [
        value[0] + entry.probabilities[actionIndex] * actionValue[0],
        value[1] + entry.probabilities[actionIndex] * actionValue[1],
      ],
      [0, 0],
    );

    const opponentReach = node.player === 0 ? reach1 : reach0;
    const counterfactualReach = chanceReach * opponentReach;
    const informationSetDeltas = deltas[node.player].get(node.informationSet);
    if (!informationSetDeltas) {
      throw new Error(`Missing regret accumulator at ${node.informationSet}`);
    }
    for (let actionIndex = 0; actionIndex < actionValues.length; actionIndex += 1) {
      informationSetDeltas[actionIndex] += counterfactualReach
        * (actionValues[actionIndex][node.player] - mixedValue[node.player]);
    }

    return mixedValue;
  };

  visit(root, 1, 1, 1);
  return { deltas, ownReach };
}

function accumulateAverageStrategy<Action extends string>(
  tables: ReadonlyMap<InformationSetKey, MutableInformationSet<Action>>,
  strategy: BehavioralStrategy<Action>,
  ownReach: ReadonlyMap<InformationSetKey, number>,
): void {
  for (const [key, table] of tables) {
    const reach = ownReach.get(key);
    if (reach === undefined) throw new Error(`Missing own reach at ${key}`);
    const entry = strategyAt(strategy, key);
    for (let actionIndex = 0; actionIndex < table.actions.length; actionIndex += 1) {
      table.strategySum[actionIndex] += reach * entry.probabilities[actionIndex];
    }
  }
}

/** Deterministic, simultaneous-update, full-tree vanilla CFR. */
export function solveCfr<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  options: CfrOptions,
): CfrSolveResult<Action> {
  validateOptions(options);
  const index = buildGameTreeIndex(game);
  const tables = new Map<InformationSetKey, MutableInformationSet<Action>>(
    index.informationSets.map(definition => [definition.key, {
      player: definition.player,
      actions: [...definition.actions],
      cumulativeRegrets: definition.actions.map(() => 0),
      strategySum: definition.actions.map(() => 0),
    }] as const),
  );
  const tree = buildCfrTree(game, index);
  const requestedCheckpoints = new Set(options.checkpointIterations ?? []);
  const checkpoints: CfrCheckpoint<Action>[] = [];
  const updateOrder = options.updateOrder ?? [0, 1] as const;

  let currentStrategy = regretMatchedStrategy(tables);
  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    currentStrategy = regretMatchedStrategy(tables);
    const iterationData = collectIterationData(game.id, tree, currentStrategy, tables);
    accumulateAverageStrategy(tables, currentStrategy, iterationData.ownReach);

    for (const player of updateOrder) {
      const deltas = iterationData.deltas[player];
      for (const [key, values] of deltas) {
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
      checkpoints.push({
        iteration,
        averageStrategy: averagedStrategy(tables, currentStrategy),
      });
    }
  }

  currentStrategy = regretMatchedStrategy(tables);
  const averageStrategy = averagedStrategy(tables, currentStrategy);
  validateStrategy(index, currentStrategy);
  validateStrategy(index, averageStrategy);

  return {
    gameId: game.id,
    algorithm: "full-tree-cfr",
    algorithmVersion: 1,
    iterations: options.iterations,
    index,
    currentStrategy,
    averageStrategy,
    cumulativeRegrets: new Map([...tables].map(([key, table]) => [
      key,
      [...table.cumulativeRegrets],
    ] as const)),
    checkpoints,
  };
}
