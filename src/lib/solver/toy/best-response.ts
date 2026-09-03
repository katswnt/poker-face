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
  readonly method: "exhaustive" | "information-set";
  readonly informationSetsOptimized: number;
  readonly pureStrategiesChecked: number | null;
}

export interface StrategyGrade<Action extends string> {
  readonly value: Utility;
  readonly bestResponses: readonly [BestResponse<Action>, BestResponse<Action>];
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
}

export interface GradeStrategyOptions {
  readonly bestResponseMethod?: "exhaustive" | "information-set";
  readonly maxPureStrategies?: number;
}

type EvaluationTreeNode<Action extends string> =
  | {
      readonly id: number;
      readonly kind: "terminal";
      readonly utility: Utility;
    }
  | {
      readonly id: number;
      readonly kind: "chance";
      readonly children: readonly {
        readonly probability: number;
        readonly node: EvaluationTreeNode<Action>;
      }[];
    }
  | EvaluationPlayerNode<Action>;

interface EvaluationPlayerNode<Action extends string> {
  readonly id: number;
  readonly kind: "player";
  readonly player: SolverPlayer;
  readonly informationSet: InformationSetKey;
  readonly actions: readonly Action[];
  readonly children: readonly EvaluationTreeNode<Action>[];
}

interface RecallStep<Action extends string> {
  readonly informationSet: InformationSetKey;
  readonly action: Action;
}

interface EvaluationTree<Action extends string> {
  readonly root: EvaluationTreeNode<Action>;
  readonly responseNodes: ReadonlyMap<InformationSetKey, readonly EvaluationPlayerNode<Action>[]>;
}

function strategyEntry<Action extends string>(
  strategy: BehavioralStrategy<Action>,
  key: InformationSetKey,
): StrategyEntry<Action> {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing strategy at ${key}`);
  return entry;
}

function buildEvaluationTree<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  player: SolverPlayer,
  index: GameTreeIndex<Action>,
): EvaluationTree<Action> {
  let nextId = 0;
  const responseNodes = new Map<InformationSetKey, EvaluationPlayerNode<Action>[]>();
  const recallSignatureByInformationSet = new Map<InformationSetKey, string>();

  const visit = (
    state: State,
    recall: readonly [readonly RecallStep<Action>[], readonly RecallStep<Action>[]],
  ): EvaluationTreeNode<Action> => {
    const id = nextId;
    nextId += 1;
    if (nextId > index.totalStates) {
      throw new Error(`${game.id} changed while its evaluation tree was being built`);
    }

    const node = game.node(state);
    if (node.kind === "terminal") return { id, kind: "terminal", utility: node.utility };
    if (node.kind === "chance") {
      return {
        id,
        kind: "chance",
        children: node.outcomes.map(({ outcome, probability }) => ({
          probability,
          node: visit(game.nextChance(state, outcome), recall),
        })),
      };
    }

    const informationSet = game.informationSet(state, node.player);
    const recallSignature = JSON.stringify(recall[node.player]);
    const existingSignature = recallSignatureByInformationSet.get(informationSet);
    if (existingSignature !== undefined && existingSignature !== recallSignature) {
      throw new Error(
        `${game.id} information set ${informationSet} violates perfect recall: ` +
        "the player would have to forget an earlier decision",
      );
    }
    recallSignatureByInformationSet.set(informationSet, recallSignature);

    const children = node.actions.map(action => {
      const actingPlayerRecall = [...recall[node.player], { informationSet, action }];
      const childRecall: readonly [readonly RecallStep<Action>[], readonly RecallStep<Action>[]] =
        node.player === 0
          ? [actingPlayerRecall, recall[1]]
          : [recall[0], actingPlayerRecall];
      return visit(game.nextAction(state, action), childRecall);
    });
    const treeNode: EvaluationPlayerNode<Action> = {
      id,
      kind: "player",
      player: node.player,
      informationSet,
      actions: [...node.actions],
      children,
    };
    if (node.player === player) {
      const existing = responseNodes.get(informationSet);
      if (existing) existing.push(treeNode);
      else responseNodes.set(informationSet, [treeNode]);
    }
    return treeNode;
  };

  const root = visit(game.initialState(), [[], []]);
  if (nextId !== index.totalStates) {
    throw new Error(
      `${game.id} evaluation tree has ${nextId} states; its index has ${index.totalStates}`,
    );
  }
  return { root, responseNodes };
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
  return {
    player,
    value: bestValue,
    choices: bestChoices,
    method: "exhaustive",
    informationSetsOptimized: definitions.length,
    pureStrategiesChecked: count,
  };
}

/**
 * Exact best response without enumerating every pure strategy.
 *
 * The response chooses once per information set, after combining every hidden state
 * the player cannot distinguish. Opponent and chance reach probabilities weight those
 * states; the responding player's own earlier probabilities do not. This is the
 * counterfactual best-response calculation used by larger perfect-recall games.
 */
export function informationSetBestResponse<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  opponentProfile: BehavioralStrategy<Action>,
  player: SolverPlayer,
  index: GameTreeIndex<Action> = buildGameTreeIndex(game),
): BestResponse<Action> {
  validateStrategy(index, opponentProfile);
  const tree = buildEvaluationTree(game, player, index);
  const counterfactualReach = new Map<number, number>();

  const collectReach = (node: EvaluationTreeNode<Action>, reach: number): void => {
    counterfactualReach.set(node.id, reach);
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      for (const child of node.children) {
        collectReach(child.node, reach * child.probability);
      }
      return;
    }
    if (node.player === player) {
      for (const child of node.children) collectReach(child, reach);
      return;
    }

    const entry = strategyEntry(opponentProfile, node.informationSet);
    for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
      collectReach(node.children[actionIndex], reach * entry.probabilities[actionIndex]);
    }
  };
  collectReach(tree.root, 1);

  const choices = new Map<InformationSetKey, Action>();
  const nodeValue = new Map<number, number>();
  const resolving = new Set<InformationSetKey>();

  const bestAction = (informationSet: InformationSetKey): Action => {
    const cached = choices.get(informationSet);
    if (cached !== undefined) return cached;
    if (resolving.has(informationSet)) {
      throw new Error(
        `${game.id} cannot order best-response decisions at ${informationSet}; ` +
        "check that the game is finite and has perfect recall",
      );
    }

    const definition = index.informationSetByKey.get(informationSet);
    const nodes = tree.responseNodes.get(informationSet);
    if (!definition || definition.player !== player || !nodes || nodes.length === 0) {
      throw new Error(`Missing player ${player} decision states for ${informationSet}`);
    }

    resolving.add(informationSet);
    let chosenAction = definition.actions[0];
    let chosenValue = Number.NEGATIVE_INFINITY;
    for (let actionIndex = 0; actionIndex < definition.actions.length; actionIndex += 1) {
      let actionValue = 0;
      for (const node of nodes) {
        const reach = counterfactualReach.get(node.id);
        if (reach === undefined) throw new Error(`Missing reach probability for state ${node.id}`);
        actionValue += reach * stateValue(node.children[actionIndex]);
      }
      if (actionValue > chosenValue) {
        chosenValue = actionValue;
        chosenAction = definition.actions[actionIndex];
      }
    }
    resolving.delete(informationSet);
    choices.set(informationSet, chosenAction);
    return chosenAction;
  };

  const stateValue = (node: EvaluationTreeNode<Action>): number => {
    const cached = nodeValue.get(node.id);
    if (cached !== undefined) return cached;

    let value: number;
    if (node.kind === "terminal") {
      value = node.utility[player];
    } else if (node.kind === "chance") {
      value = node.children.reduce(
        (sum, child) => sum + child.probability * stateValue(child.node),
        0,
      );
    } else if (node.player === player) {
      const action = bestAction(node.informationSet);
      const actionIndex = node.actions.indexOf(action);
      if (actionIndex < 0) throw new Error(`Best response chose an illegal action at ${node.informationSet}`);
      value = stateValue(node.children[actionIndex]);
    } else {
      const entry = strategyEntry(opponentProfile, node.informationSet);
      value = node.children.reduce(
        (sum, child, actionIndex) => sum + entry.probabilities[actionIndex] * stateValue(child),
        0,
      );
    }

    if (!Number.isFinite(value)) throw new Error(`Non-finite best-response value at state ${node.id}`);
    nodeValue.set(node.id, value);
    return value;
  };

  const definitions = index.informationSets.filter(definition => definition.player === player);
  for (const definition of definitions) bestAction(definition.key);
  const value = stateValue(tree.root);
  return {
    player,
    value,
    choices,
    method: "information-set",
    informationSetsOptimized: definitions.length,
    pureStrategiesChecked: null,
  };
}

export function gradeStrategy<State, Action extends string, ChanceOutcome>(
  game: ExtensiveFormGame<State, Action, ChanceOutcome>,
  strategy: BehavioralStrategy<Action>,
  index: GameTreeIndex<Action> = buildGameTreeIndex(game),
  {
    bestResponseMethod = "information-set",
    maxPureStrategies = 1_000_000,
  }: GradeStrategyOptions = {},
): StrategyGrade<Action> {
  const value = evaluateStrategy(game, strategy, index);
  const response = (player: SolverPlayer) => bestResponseMethod === "exhaustive"
    ? exhaustiveBestResponse(game, strategy, player, index, { maxPureStrategies })
    : informationSetBestResponse(game, strategy, player, index);
  const response0 = response(0);
  const response1 = response(1);
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
