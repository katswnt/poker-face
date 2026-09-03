import {
  buildGameTreeIndex,
  validateStrategy,
  type BehavioralStrategy,
  type ExtensiveFormGame,
  type GameTreeIndex,
  type InformationSetDefinition,
  type InformationSetKey,
  type SolverPlayer,
  type StrategyEntry,
  type Utility,
} from "./game";

export interface BestResponse<Action extends string> {
  readonly player: SolverPlayer;
  readonly value: number;
  readonly choices: ReadonlyMap<InformationSetKey, Action>;
  readonly pureStrategiesChecked: number;
}

export interface StrategyGrade<Action extends string> {
  readonly value: Utility;
  readonly bestResponses: readonly [BestResponse<Action>, BestResponse<Action>];
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
}

function strategyEntry<Action extends string>(
  strategy: BehavioralStrategy<Action>,
  key: InformationSetKey,
): StrategyEntry<Action> {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing strategy at ${key}`);
  return entry;
}

/** Exact full-tree value for a complete behavioral strategy profile. */
export function evaluateStrategy<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  strategy: BehavioralStrategy<Action>,
  index: GameTreeIndex<Action> = buildGameTreeIndex(game),
): Utility {
  validateStrategy(index, strategy);

  const visit = (state: State): Utility => {
    const node = game.node(state);
    if (node.kind === "terminal") return node.utility;
    if (node.kind === "chance") {
      let value0 = 0;
      let value1 = 0;
      for (const { outcome, probability } of node.outcomes) {
        const child = visit(game.nextChance(state, outcome));
        value0 += probability * child[0];
        value1 += probability * child[1];
      }
      return [value0, value1];
    }

    const key = game.informationSet(state, node.player);
    const entry = strategyEntry(strategy, key);
    let value0 = 0;
    let value1 = 0;
    for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
      const child = visit(game.nextAction(state, node.actions[actionIndex]));
      const probability = entry.probabilities[actionIndex];
      value0 += probability * child[0];
      value1 += probability * child[1];
    }
    return [value0, value1];
  };

  return visit(game.initialState());
}

export function pureStrategyCount<Action extends string>(
  definitions: readonly InformationSetDefinition<Action>[],
): number {
  return definitions.reduce((count, definition) => count * definition.actions.length, 1);
}

function strategyWithPureResponse<Action extends string>(
  base: BehavioralStrategy<Action>,
  definitions: readonly InformationSetDefinition<Action>[],
  ordinal: number,
): {
  readonly profile: BehavioralStrategy<Action>;
  readonly choices: ReadonlyMap<InformationSetKey, Action>;
} {
  let remaining = ordinal;
  const profile = new Map(base);
  const choices = new Map<InformationSetKey, Action>();

  for (const definition of definitions) {
    const actionIndex = remaining % definition.actions.length;
    remaining = Math.floor(remaining / definition.actions.length);
    const probabilities = definition.actions.map((_, index) => index === actionIndex ? 1 : 0);
    profile.set(definition.key, { actions: [...definition.actions], probabilities });
    choices.set(definition.key, definition.actions[actionIndex]);
  }

  return { profile, choices };
}

/**
 * Exact best response by enumerating pure strategies at information sets.
 *
 * This is intentionally exponential and therefore only suitable for tiny games. Its
 * virtue is independence: it cannot choose separately for hidden full states unless the
 * game's information-set model itself is wrong.
 */
export function exhaustiveBestResponse<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  opponentProfile: BehavioralStrategy<Action>,
  player: SolverPlayer,
  index: GameTreeIndex<Action> = buildGameTreeIndex(game),
  { maxPureStrategies = 1_000_000 }: { readonly maxPureStrategies?: number } = {},
): BestResponse<Action> {
  validateStrategy(index, opponentProfile);
  const definitions = index.informationSets.filter(definition => definition.player === player);
  const count = pureStrategyCount(definitions);
  if (!Number.isSafeInteger(count) || count > maxPureStrategies) {
    throw new Error(
      `${game.id} player ${player} has ${count} pure strategies; exhaustive limit is ${maxPureStrategies}`,
    );
  }

  let bestValue = Number.NEGATIVE_INFINITY;
  let bestChoices = new Map<InformationSetKey, Action>();
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const candidate = strategyWithPureResponse(opponentProfile, definitions, ordinal);
    const value = evaluateStrategy(game, candidate.profile, index)[player];
    if (value > bestValue) {
      bestValue = value;
      bestChoices = new Map(candidate.choices);
    }
  }

  if (!Number.isFinite(bestValue)) throw new Error(`Could not find a best response for player ${player}`);
  return { player, value: bestValue, choices: bestChoices, pureStrategiesChecked: count };
}

export function gradeStrategy<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  strategy: BehavioralStrategy<Action>,
  index: GameTreeIndex<Action> = buildGameTreeIndex(game),
): StrategyGrade<Action> {
  const value = evaluateStrategy(game, strategy, index);
  const response0 = exhaustiveBestResponse(game, strategy, 0, index);
  const response1 = exhaustiveBestResponse(game, strategy, 1, index);
  const rawGain0 = response0.value - value[0];
  const rawGain1 = response1.value - value[1];
  const tolerance = 1e-12;
  if (rawGain0 < -tolerance || rawGain1 < -tolerance) {
    throw new Error(`Best response is worse than the profile: gains ${rawGain0}, ${rawGain1}`);
  }
  const gains: Utility = [Math.max(0, rawGain0), Math.max(0, rawGain1)];
  const nashGap = gains[0] + gains[1];
  return {
    value,
    bestResponses: [response0, response1],
    gains,
    nashGap,
    exploitability: nashGap / 2,
  };
}
