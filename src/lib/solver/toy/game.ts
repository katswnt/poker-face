// Shared contract for the small, two-player, zero-sum games used to validate
// solver math before applying it to hold'em.

export type SolverPlayer = 0 | 1;
export type Utility = readonly [number, number];
export type InformationSetKey = string;

export interface Weighted<Outcome> {
  readonly outcome: Outcome;
  readonly probability: number;
}

export type GameNode<Action extends string, ChanceOutcome> =
  | {
      readonly kind: "chance";
      readonly outcomes: readonly Weighted<ChanceOutcome>[];
    }
  | {
      readonly kind: "player";
      readonly player: SolverPlayer;
      readonly actions: readonly Action[];
    }
  | {
      readonly kind: "terminal";
      readonly utility: Utility;
    };

export interface ExtensiveFormGame<State, Action extends string, ChanceOutcome> {
  readonly id: string;
  initialState(): State;
  node(state: State): GameNode<Action, ChanceOutcome>;
  nextChance(state: State, outcome: ChanceOutcome): State;
  nextAction(state: State, action: Action): State;
  informationSet(state: State, player: SolverPlayer): InformationSetKey;
}

export interface InformationSetDefinition<Action extends string> {
  readonly key: InformationSetKey;
  readonly player: SolverPlayer;
  readonly actions: readonly Action[];
  readonly stateCount: number;
}

export interface GameTreeIndex<Action extends string> {
  readonly gameId: string;
  readonly totalStates: number;
  readonly chanceNodes: number;
  readonly decisionNodes: number;
  readonly terminalNodes: number;
  readonly informationSets: readonly InformationSetDefinition<Action>[];
  readonly informationSetByKey: ReadonlyMap<InformationSetKey, InformationSetDefinition<Action>>;
}

export interface StrategyEntry<Action extends string> {
  readonly actions: readonly Action[];
  readonly probabilities: readonly number[];
}

export type BehavioralStrategy<Action extends string> = ReadonlyMap<
  InformationSetKey,
  StrategyEntry<Action>
>;

const PROBABILITY_TOLERANCE = 1e-12;
const ZERO_SUM_TOLERANCE = 1e-12;

function sameActions<Action extends string>(
  left: readonly Action[],
  right: readonly Action[],
): boolean {
  return left.length === right.length && left.every((action, index) => action === right[index]);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite, got ${value}`);
}

/**
 * Walk the complete game tree and lock its public structure before solving.
 *
 * The index deliberately counts tree states rather than deduplicating them. Two full
 * states that a player cannot distinguish must be grouped under one information-set key.
 */
export function buildGameTreeIndex<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  { maxStates = 1_000_000 }: { readonly maxStates?: number } = {},
): GameTreeIndex<Action> {
  let totalStates = 0;
  let chanceNodes = 0;
  let decisionNodes = 0;
  let terminalNodes = 0;
  const mutableInformationSets = new Map<
    InformationSetKey,
    { player: SolverPlayer; actions: readonly Action[]; stateCount: number }
  >();

  const visit = (state: State): void => {
    totalStates += 1;
    if (totalStates > maxStates) {
      throw new Error(`${game.id} exceeded the ${maxStates}-state audit limit`);
    }

    const node = game.node(state);
    if (node.kind === "terminal") {
      terminalNodes += 1;
      const [utility0, utility1] = node.utility;
      assertFinite(utility0, "player 0 utility");
      assertFinite(utility1, "player 1 utility");
      if (Math.abs(utility0 + utility1) > ZERO_SUM_TOLERANCE) {
        throw new Error(`${game.id} terminal utility is not zero-sum: ${utility0}, ${utility1}`);
      }
      return;
    }

    if (node.kind === "chance") {
      chanceNodes += 1;
      if (node.outcomes.length === 0) throw new Error(`${game.id} has an empty chance node`);
      let probabilitySum = 0;
      for (const { outcome, probability } of node.outcomes) {
        assertFinite(probability, "chance probability");
        if (probability <= 0 || probability > 1) {
          throw new Error(`${game.id} has invalid chance probability ${probability}`);
        }
        probabilitySum += probability;
        visit(game.nextChance(state, outcome));
      }
      if (Math.abs(probabilitySum - 1) > PROBABILITY_TOLERANCE) {
        throw new Error(`${game.id} chance probabilities sum to ${probabilitySum}, not 1`);
      }
      return;
    }

    decisionNodes += 1;
    if (node.actions.length === 0) throw new Error(`${game.id} has a player node without actions`);
    if (new Set(node.actions).size !== node.actions.length) {
      throw new Error(`${game.id} has duplicate legal actions`);
    }

    const key = game.informationSet(state, node.player);
    if (!key) throw new Error(`${game.id} produced an empty information-set key`);
    const existing = mutableInformationSets.get(key);
    if (existing) {
      if (existing.player !== node.player) {
        throw new Error(`${game.id} information set ${key} belongs to both players`);
      }
      if (!sameActions(existing.actions, node.actions)) {
        throw new Error(`${game.id} information set ${key} has inconsistent legal actions`);
      }
      existing.stateCount += 1;
    } else {
      mutableInformationSets.set(key, {
        player: node.player,
        actions: [...node.actions],
        stateCount: 1,
      });
    }

    for (const action of node.actions) visit(game.nextAction(state, action));
  };

  visit(game.initialState());

  const informationSets = [...mutableInformationSets.entries()]
    .map(([key, definition]) => ({ key, ...definition }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const informationSetByKey = new Map(
    informationSets.map(definition => [definition.key, definition] as const),
  );

  return {
    gameId: game.id,
    totalStates,
    chanceNodes,
    decisionNodes,
    terminalNodes,
    informationSets,
    informationSetByKey,
  };
}

export function uniformStrategy<Action extends string>(
  index: GameTreeIndex<Action>,
): BehavioralStrategy<Action> {
  return new Map(index.informationSets.map(definition => {
    const probability = 1 / definition.actions.length;
    return [definition.key, {
      actions: [...definition.actions],
      probabilities: definition.actions.map(() => probability),
    }] as const;
  }));
}

export function validateStrategy<Action extends string>(
  index: GameTreeIndex<Action>,
  strategy: BehavioralStrategy<Action>,
  tolerance = PROBABILITY_TOLERANCE,
): void {
  if (strategy.size !== index.informationSets.length) {
    throw new Error(
      `${index.gameId} strategy has ${strategy.size} information sets; expected ${index.informationSets.length}`,
    );
  }

  for (const definition of index.informationSets) {
    const entry = strategy.get(definition.key);
    if (!entry) throw new Error(`Missing strategy for ${definition.key}`);
    if (!sameActions(entry.actions, definition.actions)) {
      throw new Error(`Strategy actions do not match the game at ${definition.key}`);
    }
    if (entry.probabilities.length !== entry.actions.length) {
      throw new Error(`Strategy probability length does not match actions at ${definition.key}`);
    }

    let sum = 0;
    for (const probability of entry.probabilities) {
      assertFinite(probability, `strategy probability at ${definition.key}`);
      if (probability < -tolerance || probability > 1 + tolerance) {
        throw new Error(`Strategy probability at ${definition.key} is outside [0, 1]: ${probability}`);
      }
      sum += probability;
    }
    if (Math.abs(sum - 1) > tolerance) {
      throw new Error(`Strategy probabilities at ${definition.key} sum to ${sum}, not 1`);
    }
  }

  for (const key of strategy.keys()) {
    if (!index.informationSetByKey.has(key)) throw new Error(`Strategy has unknown information set ${key}`);
  }
}
