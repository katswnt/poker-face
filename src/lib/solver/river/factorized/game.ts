import type {
  ExtensiveFormGame,
  GameTreeIndex,
  InformationSetDefinition,
  InformationSetKey,
  SolverPlayer,
  Weighted,
} from "../../toy/game";
import { riverComboKey, type RiverCombo } from "../cards";
import type { ConfigurableRiverAction } from "../configurable/game";
import type { ConfigurableRiverRangeEntry } from "../configurable/range";

export const FACTORIZED_TERMINAL_NODE = 0;
export const FACTORIZED_PLAYER_NODE = 1;
export const FACTORIZED_NO_INDEX = -1;

export interface FactorizedRiverSourceState {
  readonly hands: readonly [RiverCombo, RiverCombo] | null;
  readonly public: {
    readonly terminal: "fold" | "showdown" | null;
    readonly history: readonly ConfigurableRiverAction[];
  };
}

export interface FactorizedRiverSourcePreflight {
  readonly publicStatesPerDeal: number;
  readonly publicTerminalStatesPerDeal: number;
  readonly projectedFullStates: number;
}

export interface FactorizedRiverSource<State extends FactorizedRiverSourceState>
  extends ExtensiveFormGame<State, ConfigurableRiverAction, { readonly hands: readonly [RiverCombo, RiverCombo] }> {
  readonly scenario: {
    readonly ranges: readonly [
      readonly ConfigurableRiverRangeEntry[],
      readonly ConfigurableRiverRangeEntry[],
    ];
  };
  readonly deals: readonly Weighted<{ readonly hands: readonly [RiverCombo, RiverCombo] }>[];
  readonly preflight: FactorizedRiverSourcePreflight;
  totalContributions(state: State): readonly [number, number];
  showdownWinner(hands: readonly [RiverCombo, RiverCombo]): SolverPlayer | null;
}

export interface CompiledFactorizedRiverGame {
  readonly gameId: string;
  readonly index: GameTreeIndex<ConfigurableRiverAction>;
  readonly rangeEntryCounts: readonly [number, number];
  readonly publicNodeCount: number;
  readonly publicDecisionNodes: number;
  readonly publicTerminalNodes: number;
  readonly publicActions: readonly (readonly ConfigurableRiverAction[])[];
  readonly publicHistories: readonly (readonly ConfigurableRiverAction[])[];
  readonly nodeKinds: Uint8Array;
  readonly nodePlayers: Int8Array;
  readonly nodeEdgeStarts: Int32Array;
  readonly nodeEdgeCounts: Uint32Array;
  readonly nodePostorder: Int32Array;
  readonly edgeChildren: Int32Array;
  readonly terminalShowdown: Uint8Array;
  readonly terminalUtility0Win: Float64Array;
  readonly terminalUtility0Tie: Float64Array;
  readonly terminalUtility0Loss: Float64Array;
  readonly dealProbabilities: Float64Array;
  readonly dealHand0: Uint16Array;
  readonly dealHand1: Uint16Array;
  readonly dealShowdown: Int8Array;
  readonly informationSetPlayers: Int8Array;
  readonly informationSetPublicNodes: Int32Array;
  readonly informationSetHandIndexes: Uint16Array;
  readonly informationSetActionStarts: Int32Array;
  readonly informationSetActionCounts: Uint32Array;
  readonly informationSetLookup0: Int32Array;
  readonly informationSetLookup1: Int32Array;
  readonly actionSlotCount: number;
  readonly typedStorageBytes: number;
  readonly equivalentRepeatedStates: number;
}

interface MutableInformationSet {
  readonly key: InformationSetKey;
  readonly player: SolverPlayer;
  readonly actions: readonly ConfigurableRiverAction[];
  readonly publicNode: number;
  readonly handIndex: number;
  stateCount: number;
}

function typedArrayBytes(arrays: readonly ArrayBufferView[]): number {
  return arrays.reduce((sum, array) => sum + array.byteLength, 0);
}

function sameActions(
  left: readonly ConfigurableRiverAction[],
  right: readonly ConfigurableRiverAction[],
): boolean {
  return left.length === right.length && left.every((action, index) => action === right[index]);
}

function terminalUtilities<State extends FactorizedRiverSourceState>(
  game: FactorizedRiverSource<State>,
  state: State,
): readonly [number, number, number, boolean] {
  if (!state.public.terminal) throw new Error("Factorized terminal compiler received a live state");
  if (state.public.terminal === "fold") {
    const node = game.node(state);
    if (node.kind !== "terminal") throw new Error("Factorized fold state is not terminal");
    const utility = node.utility[0];
    return [utility, utility, utility, false];
  }

  const contributions = game.totalContributions(state);
  const returned0 = Math.max(0, contributions[0] - contributions[1]);
  const returned1 = Math.max(0, contributions[1] - contributions[0]);
  const contestable = contributions[0] + contributions[1] - returned0 - returned1;
  const win = returned0 + contestable - contributions[0];
  const tie = returned0 + contestable / 2 - contributions[0];
  const loss = returned0 - contributions[0];
  return [win, tie, loss, true];
}

/**
 * Store the public betting tree once, then attach exact blocker-compatible private deals.
 * The readable configurable game remains the rules and settlement oracle.
 */
export function compileFactorizedRiverGame<State extends FactorizedRiverSourceState>(
  game: FactorizedRiverSource<State>,
): CompiledFactorizedRiverGame {
  if (game.deals.length === 0) throw new Error(`${game.id} has no compatible private deals`);
  const representativeHands = game.deals[0].outcome.hands;
  const representativeRoot = game.nextChance(game.initialState(), { hands: representativeHands });
  const expectedPublicNodes = game.preflight.publicStatesPerDeal;
  const nodeKinds = new Uint8Array(expectedPublicNodes);
  const nodePlayers = new Int8Array(expectedPublicNodes);
  nodePlayers.fill(FACTORIZED_NO_INDEX);
  const nodeEdgeStarts = new Int32Array(expectedPublicNodes);
  const nodeEdgeCounts = new Uint32Array(expectedPublicNodes);
  const terminalShowdown = new Uint8Array(expectedPublicNodes);
  const terminalUtility0Win = new Float64Array(expectedPublicNodes);
  const terminalUtility0Tie = new Float64Array(expectedPublicNodes);
  const terminalUtility0Loss = new Float64Array(expectedPublicNodes);
  const edgeChildren = new Int32Array(Math.max(0, expectedPublicNodes - 1));
  const publicActions: (readonly ConfigurableRiverAction[])[] = [];
  const publicHistories: (readonly ConfigurableRiverAction[])[] = [];
  const postorder: number[] = [];
  let nextNode = 0;
  let nextEdge = 0;
  let publicDecisionNodes = 0;
  let publicTerminalNodes = 0;

  const visit = (state: State): number => {
    const nodeId = nextNode;
    nextNode += 1;
    if (nodeId >= expectedPublicNodes) {
      throw new Error(`${game.id} public tree grew while factorizing it`);
    }
    publicHistories[nodeId] = [...state.public.history];
    const node = game.node(state);
    if (node.kind === "chance") {
      throw new Error(`${game.id} has chance after the private river deal`);
    }
    if (node.kind === "terminal") {
      nodeKinds[nodeId] = FACTORIZED_TERMINAL_NODE;
      publicActions[nodeId] = [];
      publicTerminalNodes += 1;
      const [win, tie, loss, showdown] = terminalUtilities(game, state);
      terminalUtility0Win[nodeId] = win;
      terminalUtility0Tie[nodeId] = tie;
      terminalUtility0Loss[nodeId] = loss;
      terminalShowdown[nodeId] = showdown ? 1 : 0;
      postorder.push(nodeId);
      return nodeId;
    }

    nodeKinds[nodeId] = FACTORIZED_PLAYER_NODE;
    nodePlayers[nodeId] = node.player;
    publicDecisionNodes += 1;
    publicActions[nodeId] = [...node.actions];
    const edgeStart = nextEdge;
    nextEdge += node.actions.length;
    if (nextEdge > edgeChildren.length) {
      throw new Error(`${game.id} public edges grew while factorizing it`);
    }
    nodeEdgeStarts[nodeId] = edgeStart;
    nodeEdgeCounts[nodeId] = node.actions.length;
    for (let action = 0; action < node.actions.length; action += 1) {
      edgeChildren[edgeStart + action] = visit(game.nextAction(state, node.actions[action]));
    }
    postorder.push(nodeId);
    return nodeId;
  };

  const root = visit(representativeRoot);
  if (
    root !== 0 ||
    nextNode !== expectedPublicNodes ||
    nextEdge !== edgeChildren.length ||
    publicTerminalNodes !== game.preflight.publicTerminalStatesPerDeal
  ) {
    throw new Error(
      `${game.id} public tree counts changed while factorizing: ` +
      `${nextNode}/${expectedPublicNodes} nodes, ${nextEdge}/${edgeChildren.length} edges`,
    );
  }
  const nodePostorder = Int32Array.from(postorder);

  const rangeKeys = [
    new Map(game.scenario.ranges[0].map((entry, index) => [riverComboKey(entry.cards), index] as const)),
    new Map(game.scenario.ranges[1].map((entry, index) => [riverComboKey(entry.cards), index] as const)),
  ] as const;
  const dealCount = game.deals.length;
  const dealProbabilities = new Float64Array(dealCount);
  const dealHand0 = new Uint16Array(dealCount);
  const dealHand1 = new Uint16Array(dealCount);
  const dealShowdown = new Int8Array(dealCount);
  let probabilitySum = 0;
  for (let deal = 0; deal < dealCount; deal += 1) {
    const weighted = game.deals[deal];
    const hand0 = rangeKeys[0].get(riverComboKey(weighted.outcome.hands[0]));
    const hand1 = rangeKeys[1].get(riverComboKey(weighted.outcome.hands[1]));
    if (hand0 === undefined || hand1 === undefined) {
      throw new Error(`${game.id} factorized deal is missing from its source range`);
    }
    dealProbabilities[deal] = weighted.probability;
    dealHand0[deal] = hand0;
    dealHand1[deal] = hand1;
    const winner = game.showdownWinner(weighted.outcome.hands);
    dealShowdown[deal] = winner === null ? 0 : winner === 0 ? 1 : -1;
    probabilitySum += weighted.probability;
  }
  if (Math.abs(probabilitySum - 1) > 1e-12) {
    throw new Error(`${game.id} factorized deal probabilities sum to ${probabilitySum}`);
  }

  const mutableByCoordinate = new Map<string, MutableInformationSet>();
  for (let publicNode = 0; publicNode < expectedPublicNodes; publicNode += 1) {
    if (nodeKinds[publicNode] !== FACTORIZED_PLAYER_NODE) continue;
    const player = nodePlayers[publicNode] as SolverPlayer;
    const actions = publicActions[publicNode];
    for (let deal = 0; deal < dealCount; deal += 1) {
      const handIndex = player === 0 ? dealHand0[deal] : dealHand1[deal];
      const coordinate = `${publicNode}:${handIndex}`;
      const existing = mutableByCoordinate.get(coordinate);
      if (existing) {
        existing.stateCount += 1;
        continue;
      }
      const hands = game.deals[deal].outcome.hands;
      let state = game.nextChance(game.initialState(), { hands });
      for (const action of publicHistories[publicNode]) state = game.nextAction(state, action);
      const stateNode = game.node(state);
      if (stateNode.kind !== "player" || stateNode.player !== player || !sameActions(stateNode.actions, actions)) {
        throw new Error(`${game.id} public structure depends on hidden cards at node ${publicNode}`);
      }
      mutableByCoordinate.set(coordinate, {
        key: game.informationSet(state, player),
        player,
        actions: [...actions],
        publicNode,
        handIndex,
        stateCount: 1,
      });
    }
  }

  const mutableInformationSets = [...mutableByCoordinate.values()]
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const definitions: InformationSetDefinition<ConfigurableRiverAction>[] = mutableInformationSets.map(entry => ({
    key: entry.key,
    player: entry.player,
    actions: [...entry.actions],
    stateCount: entry.stateCount,
  }));
  const informationSetByKey = new Map(definitions.map(definition => [definition.key, definition] as const));
  if (informationSetByKey.size !== definitions.length) {
    throw new Error(`${game.id} produced duplicate factorized information-set keys`);
  }
  const decisionNodes = publicDecisionNodes * dealCount;
  const terminalNodes = publicTerminalNodes * dealCount;
  const index: GameTreeIndex<ConfigurableRiverAction> = {
    gameId: game.id,
    totalStates: 1 + expectedPublicNodes * dealCount,
    chanceNodes: 1,
    decisionNodes,
    terminalNodes,
    informationSets: definitions,
    informationSetByKey,
  };

  const informationSetPlayers = new Int8Array(definitions.length);
  const informationSetPublicNodes = new Int32Array(definitions.length);
  const informationSetHandIndexes = new Uint16Array(definitions.length);
  const informationSetActionStarts = new Int32Array(definitions.length);
  const informationSetActionCounts = new Uint32Array(definitions.length);
  const lookup0 = new Int32Array(expectedPublicNodes * game.scenario.ranges[0].length);
  const lookup1 = new Int32Array(expectedPublicNodes * game.scenario.ranges[1].length);
  lookup0.fill(FACTORIZED_NO_INDEX);
  lookup1.fill(FACTORIZED_NO_INDEX);
  let actionSlotCount = 0;
  for (let informationSet = 0; informationSet < definitions.length; informationSet += 1) {
    const mutable = mutableInformationSets[informationSet];
    informationSetPlayers[informationSet] = mutable.player;
    informationSetPublicNodes[informationSet] = mutable.publicNode;
    informationSetHandIndexes[informationSet] = mutable.handIndex;
    informationSetActionStarts[informationSet] = actionSlotCount;
    informationSetActionCounts[informationSet] = mutable.actions.length;
    actionSlotCount += mutable.actions.length;
    const rangeSize = game.scenario.ranges[mutable.player].length;
    const lookup = mutable.player === 0 ? lookup0 : lookup1;
    const offset = mutable.publicNode * rangeSize + mutable.handIndex;
    if (lookup[offset] !== FACTORIZED_NO_INDEX) {
      throw new Error(`${game.id} duplicated factorized information-set coordinate`);
    }
    lookup[offset] = informationSet;
  }

  const typedArrays = [
    nodeKinds,
    nodePlayers,
    nodeEdgeStarts,
    nodeEdgeCounts,
    nodePostorder,
    edgeChildren,
    terminalShowdown,
    terminalUtility0Win,
    terminalUtility0Tie,
    terminalUtility0Loss,
    dealProbabilities,
    dealHand0,
    dealHand1,
    dealShowdown,
    informationSetPlayers,
    informationSetPublicNodes,
    informationSetHandIndexes,
    informationSetActionStarts,
    informationSetActionCounts,
    lookup0,
    lookup1,
  ] as const;
  return {
    gameId: game.id,
    index,
    rangeEntryCounts: [game.scenario.ranges[0].length, game.scenario.ranges[1].length],
    publicNodeCount: expectedPublicNodes,
    publicDecisionNodes,
    publicTerminalNodes,
    publicActions,
    publicHistories,
    nodeKinds,
    nodePlayers,
    nodeEdgeStarts,
    nodeEdgeCounts,
    nodePostorder,
    edgeChildren,
    terminalShowdown,
    terminalUtility0Win,
    terminalUtility0Tie,
    terminalUtility0Loss,
    dealProbabilities,
    dealHand0,
    dealHand1,
    dealShowdown,
    informationSetPlayers,
    informationSetPublicNodes,
    informationSetHandIndexes,
    informationSetActionStarts,
    informationSetActionCounts,
    informationSetLookup0: lookup0,
    informationSetLookup1: lookup1,
    actionSlotCount,
    typedStorageBytes: typedArrayBytes(typedArrays),
    equivalentRepeatedStates: index.totalStates,
  };
}

export function factorizedInformationSet(
  game: CompiledFactorizedRiverGame,
  deal: number,
  publicNode: number,
): number {
  const player = game.nodePlayers[publicNode] as SolverPlayer;
  const handIndex = player === 0 ? game.dealHand0[deal] : game.dealHand1[deal];
  const rangeSize = game.rangeEntryCounts[player];
  const lookup = player === 0 ? game.informationSetLookup0 : game.informationSetLookup1;
  const informationSet = lookup[publicNode * rangeSize + handIndex];
  if (informationSet === FACTORIZED_NO_INDEX) {
    throw new Error(`${game.gameId} has no information set at deal ${deal}, public node ${publicNode}`);
  }
  return informationSet;
}

export function factorizedTerminalUtility0(
  game: CompiledFactorizedRiverGame,
  deal: number,
  publicNode: number,
): number {
  if (game.terminalShowdown[publicNode] === 0) return game.terminalUtility0Win[publicNode];
  const outcome = game.dealShowdown[deal];
  return outcome > 0
    ? game.terminalUtility0Win[publicNode]
    : outcome < 0
      ? game.terminalUtility0Loss[publicNode]
      : game.terminalUtility0Tie[publicNode];
}
