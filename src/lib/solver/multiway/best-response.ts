import type { InformationSetKey } from "../toy/game";
import {
  buildMultiwayGameTreeIndex,
  validateMultiwayStrategy,
  type MultiwayBehavioralStrategy,
  type MultiwayExtensiveFormGame,
  type MultiwayGameTreeIndex,
  type MultiwayInformationSetDefinition,
  type MultiwayStrategyEntry,
  type MultiwayUtility,
} from "./game";

export interface MultiwayBestResponse<Action extends string> {
  readonly player: number;
  readonly value: number;
  readonly choices: ReadonlyMap<InformationSetKey, Action>;
  readonly method: "exhaustive" | "information-set";
  readonly informationSetsOptimized: number;
  readonly pureStrategiesChecked: number | null;
}

export interface MultiwayStrategyGrade<Action extends string> {
  readonly value: MultiwayUtility;
  readonly bestResponses: readonly MultiwayBestResponse<Action>[];
  readonly unilateralGains: MultiwayUtility;
  readonly sumUnilateralGains: number;
  readonly maximumUnilateralGain: number;
}

type EvaluationNode<Action extends string> =
  | { readonly id: number; readonly kind: "terminal"; readonly utility: MultiwayUtility }
  | {
      readonly id: number;
      readonly kind: "chance";
      readonly children: readonly { readonly probability: number; readonly node: EvaluationNode<Action> }[];
    }
  | EvaluationPlayerNode<Action>;

interface EvaluationPlayerNode<Action extends string> {
  readonly id: number;
  readonly kind: "player";
  readonly player: number;
  readonly informationSet: InformationSetKey;
  readonly actions: readonly Action[];
  readonly children: readonly EvaluationNode<Action>[];
}

interface RecallStep<Action extends string> {
  readonly informationSet: InformationSetKey;
  readonly action: Action;
}

function strategyAt<Action extends string>(
  strategy: MultiwayBehavioralStrategy<Action>,
  key: InformationSetKey,
): MultiwayStrategyEntry<Action> {
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing strategy at ${key}`);
  return entry;
}

function assertPlayer(player: number, playerCount: number): void {
  if (!Number.isSafeInteger(player) || player < 0 || player >= playerCount) {
    throw new Error(`Player ${player} is outside 0..${playerCount - 1}`);
  }
}

/** Exact full-tree value for a complete N-player behavioral strategy profile. */
export function evaluateMultiwayStrategy<State, Action extends string, ChanceOutcome>(
  game: MultiwayExtensiveFormGame<State, Action, ChanceOutcome>,
  strategy: MultiwayBehavioralStrategy<Action>,
  index: MultiwayGameTreeIndex<Action> = buildMultiwayGameTreeIndex(game),
): MultiwayUtility {
  validateMultiwayStrategy(index, strategy);
  const visit = (state: State): number[] => {
    const node = game.node(state);
    if (node.kind === "terminal") return [...node.utility];
    if (node.kind === "chance") {
      const value = Array.from({ length: game.playerCount }, () => 0);
      for (const { outcome, probability } of node.outcomes) {
        const child = visit(game.nextChance(state, outcome));
        for (let player = 0; player < game.playerCount; player += 1) {
          value[player] += probability * child[player];
        }
      }
      return value;
    }
    const entry = strategyAt(strategy, game.informationSet(state, node.player));
    const value = Array.from({ length: game.playerCount }, () => 0);
    for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex += 1) {
      const child = visit(game.nextAction(state, node.actions[actionIndex]));
      for (let player = 0; player < game.playerCount; player += 1) {
        value[player] += entry.probabilities[actionIndex] * child[player];
      }
    }
    return value;
  };
  return visit(game.initialState());
}

function pureStrategyCount<Action extends string>(
  definitions: readonly MultiwayInformationSetDefinition<Action>[],
): number {
  return definitions.reduce((count, definition) => count * definition.actions.length, 1);
}

export function exhaustiveMultiwayBestResponse<State, Action extends string, ChanceOutcome>(
  game: MultiwayExtensiveFormGame<State, Action, ChanceOutcome>,
  baseProfile: MultiwayBehavioralStrategy<Action>,
  player: number,
  index: MultiwayGameTreeIndex<Action> = buildMultiwayGameTreeIndex(game),
  { maxPureStrategies = 1_000_000 }: { readonly maxPureStrategies?: number } = {},
): MultiwayBestResponse<Action> {
  assertPlayer(player, game.playerCount);
  validateMultiwayStrategy(index, baseProfile);
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
    let remaining = ordinal;
    const profile = new Map(baseProfile);
    const choices = new Map<InformationSetKey, Action>();
    for (const definition of definitions) {
      const actionIndex = remaining % definition.actions.length;
      remaining = Math.floor(remaining / definition.actions.length);
      profile.set(definition.key, {
        actions: [...definition.actions],
        probabilities: definition.actions.map((_, index) => index === actionIndex ? 1 : 0),
      });
      choices.set(definition.key, definition.actions[actionIndex]);
    }
    const value = evaluateMultiwayStrategy(game, profile, index)[player];
    if (value > bestValue) {
      bestValue = value;
      bestChoices = choices;
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

/** Exact information-set best response against every other saved strategy. */
export function informationSetMultiwayBestResponse<State, Action extends string, ChanceOutcome>(
  game: MultiwayExtensiveFormGame<State, Action, ChanceOutcome>,
  baseProfile: MultiwayBehavioralStrategy<Action>,
  player: number,
  index: MultiwayGameTreeIndex<Action> = buildMultiwayGameTreeIndex(game),
): MultiwayBestResponse<Action> {
  assertPlayer(player, game.playerCount);
  validateMultiwayStrategy(index, baseProfile);
  let nextId = 0;
  const responseNodes = new Map<InformationSetKey, EvaluationPlayerNode<Action>[]>();
  const recallByInformationSet = new Map<InformationSetKey, string>();

  const build = (state: State, recall: readonly (readonly RecallStep<Action>[])[]): EvaluationNode<Action> => {
    const id = nextId;
    nextId += 1;
    if (nextId > index.totalStates) throw new Error(`${game.id} changed while its grader compiled the tree`);
    const node = game.node(state);
    if (node.kind === "terminal") return { id, kind: "terminal", utility: node.utility };
    if (node.kind === "chance") {
      return {
        id,
        kind: "chance",
        children: node.outcomes.map(({ outcome, probability }) => ({
          probability,
          node: build(game.nextChance(state, outcome), recall),
        })),
      };
    }
    const informationSet = game.informationSet(state, node.player);
    const signature = JSON.stringify(recall[node.player]);
    const existing = recallByInformationSet.get(informationSet);
    if (existing !== undefined && existing !== signature) {
      throw new Error(`${game.id} information set ${informationSet} violates perfect recall`);
    }
    recallByInformationSet.set(informationSet, signature);
    const children = node.actions.map(action => {
      const childRecall = recall.map(steps => [...steps]);
      childRecall[node.player] = [...childRecall[node.player], { informationSet, action }];
      return build(game.nextAction(state, action), childRecall);
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
      const grouped = responseNodes.get(informationSet);
      if (grouped) grouped.push(treeNode);
      else responseNodes.set(informationSet, [treeNode]);
    }
    return treeNode;
  };

  const root = build(
    game.initialState(),
    Array.from({ length: game.playerCount }, () => [] as readonly RecallStep<Action>[]),
  );
  if (nextId !== index.totalStates) {
    throw new Error(`${game.id} grader tree has ${nextId} states; its index has ${index.totalStates}`);
  }

  const counterfactualReach = new Map<number, number>();
  const collectReach = (node: EvaluationNode<Action>, reach: number): void => {
    counterfactualReach.set(node.id, reach);
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      for (const child of node.children) collectReach(child.node, reach * child.probability);
    } else if (node.player === player) {
      for (const child of node.children) collectReach(child, reach);
    } else {
      const entry = strategyAt(baseProfile, node.informationSet);
      node.children.forEach((child, actionIndex) => {
        collectReach(child, reach * entry.probabilities[actionIndex]);
      });
    }
  };
  collectReach(root, 1);

  const choices = new Map<InformationSetKey, Action>();
  const valueByNode = new Map<number, number>();
  const resolving = new Set<InformationSetKey>();
  const stateValue = (node: EvaluationNode<Action>): number => {
    const cached = valueByNode.get(node.id);
    if (cached !== undefined) return cached;
    let value: number;
    if (node.kind === "terminal") value = node.utility[player];
    else if (node.kind === "chance") {
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
      const entry = strategyAt(baseProfile, node.informationSet);
      value = node.children.reduce(
        (sum, child, actionIndex) => sum + entry.probabilities[actionIndex] * stateValue(child),
        0,
      );
    }
    if (!Number.isFinite(value)) throw new Error(`Non-finite best-response value at state ${node.id}`);
    valueByNode.set(node.id, value);
    return value;
  };
  const bestAction = (informationSet: InformationSetKey): Action => {
    const cached = choices.get(informationSet);
    if (cached !== undefined) return cached;
    if (resolving.has(informationSet)) {
      throw new Error(`${game.id} cannot order best-response decisions at ${informationSet}`);
    }
    const definition = index.informationSetByKey.get(informationSet);
    const nodes = responseNodes.get(informationSet);
    if (!definition || definition.player !== player || !nodes?.length) {
      throw new Error(`Missing player ${player} states at ${informationSet}`);
    }
    resolving.add(informationSet);
    let chosen = definition.actions[0];
    let chosenValue = Number.NEGATIVE_INFINITY;
    for (let actionIndex = 0; actionIndex < definition.actions.length; actionIndex += 1) {
      let actionValue = 0;
      for (const node of nodes) {
        const reach = counterfactualReach.get(node.id);
        if (reach === undefined) throw new Error(`Missing reach probability for state ${node.id}`);
        actionValue += reach * stateValue(node.children[actionIndex]);
      }
      if (actionValue > chosenValue) {
        chosen = definition.actions[actionIndex];
        chosenValue = actionValue;
      }
    }
    resolving.delete(informationSet);
    choices.set(informationSet, chosen);
    return chosen;
  };

  const definitions = index.informationSets.filter(definition => definition.player === player);
  for (const definition of definitions) bestAction(definition.key);
  return {
    player,
    value: stateValue(root),
    choices,
    method: "information-set",
    informationSetsOptimized: definitions.length,
    pureStrategiesChecked: null,
  };
}

export function gradeMultiwayStrategy<State, Action extends string, ChanceOutcome>(
  game: MultiwayExtensiveFormGame<State, Action, ChanceOutcome>,
  strategy: MultiwayBehavioralStrategy<Action>,
  index: MultiwayGameTreeIndex<Action> = buildMultiwayGameTreeIndex(game),
  method: "information-set" | "exhaustive" = "information-set",
): MultiwayStrategyGrade<Action> {
  const value = evaluateMultiwayStrategy(game, strategy, index);
  const bestResponses = Array.from({ length: game.playerCount }, (_, player) => method === "exhaustive"
    ? exhaustiveMultiwayBestResponse(game, strategy, player, index)
    : informationSetMultiwayBestResponse(game, strategy, player, index));
  const unilateralGains = bestResponses.map((response, player) => {
    const gain = response.value - value[player];
    if (gain < -1e-9) throw new Error(`Player ${player} best response is worse by ${-gain}`);
    return Math.max(0, gain);
  });
  return {
    value,
    bestResponses,
    unilateralGains,
    sumUnilateralGains: unilateralGains.reduce((sum, gain) => sum + gain, 0),
    maximumUnilateralGain: Math.max(...unilateralGains),
  };
}
