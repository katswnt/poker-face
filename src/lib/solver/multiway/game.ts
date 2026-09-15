import type {
  BehavioralStrategy as HeadsUpStrategy,
  ExtensiveFormGame as HeadsUpGame,
  InformationSetKey,
} from "../toy/game";

export type MultiwayPlayer = number;
export type MultiwayUtility = readonly number[];

export interface Weighted<Outcome> {
  readonly outcome: Outcome;
  readonly probability: number;
}

export type MultiwayGameNode<Action extends string, ChanceOutcome> =
  | { readonly kind: "chance"; readonly outcomes: readonly Weighted<ChanceOutcome>[] }
  | { readonly kind: "player"; readonly player: MultiwayPlayer; readonly actions: readonly Action[] }
  | { readonly kind: "terminal"; readonly utility: MultiwayUtility };

export interface MultiwayExtensiveFormGame<State, Action extends string, ChanceOutcome> {
  readonly id: string;
  readonly playerCount: number;
  initialState(): State;
  node(state: State): MultiwayGameNode<Action, ChanceOutcome>;
  nextChance(state: State, outcome: ChanceOutcome): State;
  nextAction(state: State, action: Action): State;
  informationSet(state: State, player: MultiwayPlayer): InformationSetKey;
}

export interface MultiwayInformationSetDefinition<Action extends string> {
  readonly key: InformationSetKey;
  readonly player: MultiwayPlayer;
  readonly actions: readonly Action[];
  readonly stateCount: number;
}

export interface MultiwayGameTreeIndex<Action extends string> {
  readonly gameId: string;
  readonly playerCount: number;
  readonly totalStates: number;
  readonly chanceNodes: number;
  readonly decisionNodes: number;
  readonly terminalNodes: number;
  readonly informationSets: readonly MultiwayInformationSetDefinition<Action>[];
  readonly informationSetByKey: ReadonlyMap<InformationSetKey, MultiwayInformationSetDefinition<Action>>;
}

export interface MultiwayStrategyEntry<Action extends string> {
  readonly actions: readonly Action[];
  readonly probabilities: readonly number[];
}

export type MultiwayBehavioralStrategy<Action extends string> = ReadonlyMap<
  InformationSetKey,
  MultiwayStrategyEntry<Action>
>;

const PROBABILITY_TOLERANCE = 1e-12;
const ZERO_SUM_TOLERANCE = 1e-9;

function assertPlayerCount(playerCount: number): void {
  if (!Number.isSafeInteger(playerCount) || playerCount < 2) {
    throw new Error(`A multiway game needs at least two players; received ${playerCount}`);
  }
}

function assertPlayer(player: number, playerCount: number, label: string): void {
  if (!Number.isSafeInteger(player) || player < 0 || player >= playerCount) {
    throw new Error(`${label} ${player} is outside 0..${playerCount - 1}`);
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite, got ${value}`);
}

function sameActions<Action extends string>(
  left: readonly Action[],
  right: readonly Action[],
): boolean {
  return left.length === right.length && left.every((action, index) => action === right[index]);
}

/** Audit the complete finite tree and group indistinguishable states before solving. */
export function buildMultiwayGameTreeIndex<State, Action extends string, ChanceOutcome>(
  game: MultiwayExtensiveFormGame<State, Action, ChanceOutcome>,
  { maxStates = 1_000_000 }: { readonly maxStates?: number } = {},
): MultiwayGameTreeIndex<Action> {
  assertPlayerCount(game.playerCount);
  let totalStates = 0;
  let chanceNodes = 0;
  let decisionNodes = 0;
  let terminalNodes = 0;
  const informationSets = new Map<
    InformationSetKey,
    { player: MultiwayPlayer; actions: readonly Action[]; stateCount: number }
  >();

  const visit = (state: State): void => {
    totalStates += 1;
    if (totalStates > maxStates) {
      throw new Error(`${game.id} exceeded the ${maxStates}-state audit limit`);
    }
    const node = game.node(state);
    if (node.kind === "terminal") {
      terminalNodes += 1;
      if (node.utility.length !== game.playerCount) {
        throw new Error(
          `${game.id} terminal has ${node.utility.length} utilities for ${game.playerCount} players`,
        );
      }
      let sum = 0;
      node.utility.forEach((utility, player) => {
        assertFinite(utility, `player ${player} utility`);
        sum += utility;
      });
      if (Math.abs(sum) > ZERO_SUM_TOLERANCE) {
        throw new Error(`${game.id} terminal utilities sum to ${sum}, not zero`);
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
    assertPlayer(node.player, game.playerCount, "Acting player");
    if (node.actions.length === 0) throw new Error(`${game.id} has a player node without actions`);
    if (new Set(node.actions).size !== node.actions.length) {
      throw new Error(`${game.id} has duplicate legal actions`);
    }
    const key = game.informationSet(state, node.player);
    if (!key) throw new Error(`${game.id} produced an empty information-set key`);
    const existing = informationSets.get(key);
    if (existing) {
      if (existing.player !== node.player) {
        throw new Error(`${game.id} information set ${key} belongs to two players`);
      }
      if (!sameActions(existing.actions, node.actions)) {
        throw new Error(`${game.id} information set ${key} has inconsistent legal actions`);
      }
      existing.stateCount += 1;
    } else {
      informationSets.set(key, { player: node.player, actions: [...node.actions], stateCount: 1 });
    }
    for (const action of node.actions) visit(game.nextAction(state, action));
  };

  visit(game.initialState());
  const definitions = [...informationSets.entries()]
    .map(([key, definition]) => ({ key, ...definition }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  return {
    gameId: game.id,
    playerCount: game.playerCount,
    totalStates,
    chanceNodes,
    decisionNodes,
    terminalNodes,
    informationSets: definitions,
    informationSetByKey: new Map(definitions.map(definition => [definition.key, definition])),
  };
}

export function uniformMultiwayStrategy<Action extends string>(
  index: MultiwayGameTreeIndex<Action>,
): MultiwayBehavioralStrategy<Action> {
  return new Map(index.informationSets.map(definition => [definition.key, {
    actions: [...definition.actions],
    probabilities: definition.actions.map(() => 1 / definition.actions.length),
  }]));
}

export function validateMultiwayStrategy<Action extends string>(
  index: MultiwayGameTreeIndex<Action>,
  strategy: MultiwayBehavioralStrategy<Action>,
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

/**
 * Keep the proven heads-up engine untouched while exercising it through the N-player
 * contract. Artifact hashing stays on the original game, so this adapter cannot alter
 * the committed heads-up rules fingerprint.
 */
export function adaptHeadsUpGame<State, Action extends string, ChanceOutcome>(
  game: HeadsUpGame<State, Action, ChanceOutcome>,
): MultiwayExtensiveFormGame<State, Action, ChanceOutcome> {
  return {
    id: game.id,
    playerCount: 2,
    initialState: () => game.initialState(),
    node(state) {
      const node = game.node(state);
      if (node.kind === "terminal") return { kind: "terminal", utility: [...node.utility] };
      if (node.kind === "chance") return { kind: "chance", outcomes: node.outcomes };
      return { kind: "player", player: node.player, actions: node.actions };
    },
    nextChance: (state, outcome) => game.nextChance(state, outcome),
    nextAction: (state, action) => game.nextAction(state, action),
    informationSet: (state, player) => {
      if (player !== 0 && player !== 1) throw new Error(`Invalid heads-up player ${player}`);
      return game.informationSet(state, player);
    },
  };
}

export function adaptHeadsUpStrategy<Action extends string>(
  strategy: HeadsUpStrategy<Action>,
): MultiwayBehavioralStrategy<Action> {
  return new Map([...strategy].map(([key, entry]) => [key, {
    actions: [...entry.actions],
    probabilities: [...entry.probabilities],
  }]));
}
