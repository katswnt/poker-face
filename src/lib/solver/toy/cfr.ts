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

function regretDeltas<Action extends string>(
  tables: ReadonlyMap<InformationSetKey, MutableInformationSet<Action>>,
  player: SolverPlayer,
): Map<InformationSetKey, number[]> {
  return new Map([...tables.entries()]
    .filter(([, table]) => table.player === player)
    .map(([key, table]) => [key, table.actions.map(() => 0)] as const));
}

function collectRegretDeltas<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  strategy: BehavioralStrategy<Action>,
  targetPlayer: SolverPlayer,
  deltas: Map<InformationSetKey, number[]>,
): void {
  const visit = (
    state: State,
    reach0: number,
    reach1: number,
    chanceReach: number,
  ): number => {
    const node = game.node(state);
    if (node.kind === "terminal") return node.utility[targetPlayer];
    if (node.kind === "chance") {
      let value = 0;
      for (const { outcome, probability } of node.outcomes) {
        value += probability * visit(
          game.nextChance(state, outcome),
          reach0,
          reach1,
          chanceReach * probability,
        );
      }
      return value;
    }

    const key = game.informationSet(state, node.player);
    const entry = strategyAt(strategy, key);
    const actionValues = node.actions.map((action, actionIndex) => {
      const probability = entry.probabilities[actionIndex];
      return node.player === 0
        ? visit(game.nextAction(state, action), reach0 * probability, reach1, chanceReach)
        : visit(game.nextAction(state, action), reach0, reach1 * probability, chanceReach);
    });
    const mixedValue = actionValues.reduce(
      (value, actionValue, actionIndex) => value + entry.probabilities[actionIndex] * actionValue,
      0,
    );

    if (node.player === targetPlayer) {
      const opponentReach = targetPlayer === 0 ? reach1 : reach0;
      const counterfactualReach = chanceReach * opponentReach;
      const informationSetDeltas = deltas.get(key);
      if (!informationSetDeltas) throw new Error(`Missing regret accumulator at ${key}`);
      for (let actionIndex = 0; actionIndex < actionValues.length; actionIndex += 1) {
        informationSetDeltas[actionIndex] += counterfactualReach
          * (actionValues[actionIndex] - mixedValue);
      }
    }

    return mixedValue;
  };

  visit(game.initialState(), 1, 1, 1);
}

function collectOwnReach<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  strategy: BehavioralStrategy<Action>,
): Map<InformationSetKey, number> {
  const ownReach = new Map<InformationSetKey, number>();

  const visit = (state: State, reach0: number, reach1: number): void => {
    const node = game.node(state);
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      for (const { outcome } of node.outcomes) visit(game.nextChance(state, outcome), reach0, reach1);
      return;
    }

    const key = game.informationSet(state, node.player);
    const reach = node.player === 0 ? reach0 : reach1;
    const prior = ownReach.get(key);
    if (prior === undefined) {
      ownReach.set(key, reach);
    } else if (Math.abs(prior - reach) > REACH_TOLERANCE) {
      throw new Error(
        `${game.id} information set ${key} violates perfect recall: own reach ${prior} vs ${reach}`,
      );
    }

    const entry = strategyAt(strategy, key);
    for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
      const probability = entry.probabilities[actionIndex];
      if (node.player === 0) {
        visit(game.nextAction(state, node.actions[actionIndex]), reach0 * probability, reach1);
      } else {
        visit(game.nextAction(state, node.actions[actionIndex]), reach0, reach1 * probability);
      }
    }
  };

  visit(game.initialState(), 1, 1);
  return ownReach;
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
  const requestedCheckpoints = new Set(options.checkpointIterations ?? []);
  const checkpoints: CfrCheckpoint<Action>[] = [];
  const updateOrder = options.updateOrder ?? [0, 1] as const;

  let currentStrategy = regretMatchedStrategy(tables);
  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    currentStrategy = regretMatchedStrategy(tables);
    const allDeltas = updateOrder.map(player => {
      const deltas = regretDeltas(tables, player);
      collectRegretDeltas(game, currentStrategy, player, deltas);
      return deltas;
    });

    accumulateAverageStrategy(tables, currentStrategy, collectOwnReach(game, currentStrategy));

    for (const deltas of allDeltas) {
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
