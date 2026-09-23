import { assertDistinctRiverCards, RIVER_DECK, riverComboKey, type RiverCombo } from "../../river/cards";
import { validateStrategy, type BehavioralStrategy, type GameTreeIndex } from "../../toy/game";
import type { TurnAction, TurnRequest, TurnState } from "../../turn/game";
import { compileCompactTurn, TURN_PLAYER } from "../compact-turn";
import { compileVectorRanges, type VectorRanges } from "./ranges";
import { createVectorKernelScratch, vectorTerminalValues } from "./kernels";

export const VECTOR_TURN_VERSION = 1;
export const VECTOR_MEMORY_LIMIT = 1024 * 1024 * 1024;
type Topology = ReturnType<typeof compileCompactTurn>;

function prepare(request: TurnRequest, memoryLimitBytes: number) {
  if (!Number.isSafeInteger(memoryLimitBytes) || memoryLimitBytes < 1 || memoryLimitBytes > VECTOR_MEMORY_LIMIT) {
    throw new Error(`Vector memory limit must be 1..${VECTOR_MEMORY_LIMIT} bytes`);
  }
  if (!request || !Array.isArray(request.board) || request.board.length !== 4) throw new Error("Vector turn needs four board cards");
  assertDistinctRiverCards(request.board, "Vector turn board");
  // A constant-sized rules harness supplies ONLY public topology/transitions. Its
  // private deal, ranks and policy are never used for range values or probabilities.
  const deck = RIVER_DECK.filter(card => !request.board.includes(card));
  const topology = compileCompactTurn({ ...request, rangeText: [deck.slice(0, 2).join(""), deck.slice(2, 4).join("")] });
  const ranges = compileVectorRanges(request);
  const p = topology.nodeKinds.length, hands = ranges.players[0].hands.length + ranges.players[1].hands.length;
  const informationSetUpperBound = topology.nodeKinds.reduce((sum, kind, n) => sum + (kind === TURN_PLAYER
    ? ranges.players[topology.nodePlayers[n]].hands.length : 0), 0);
  const estimatedPeakBytes = 256 * 1024 * 1024 + informationSetUpperBound * 6000 + p * hands * 80 + hands * 48 * 128;
  if (estimatedPeakBytes > memoryLimitBytes) throw new Error(`Vector turn estimates ${estimatedPeakBytes} peak bytes; limit ${memoryLimitBytes}`);
  const counts = topology.source.preflight, deals = ranges.compatibleDeals;
  const preflight = Object.freeze({ compatibleDeals: deals, legalRiversPerDeal: 44 as const, dealRiverPairs: deals * 44,
    rangeEntries: Object.freeze(ranges.players.map(range => range.hands.length)), blockedCombos: ranges.blockedCombos,
    publicStates: p, totalStates: 1 + deals * (counts.totalStates - 1),
    chanceNodes: 1 + deals * (counts.chanceNodes - 1), decisionNodes: deals * counts.decisionNodes,
    terminalNodes: deals * counts.terminalNodes, informationSetUpperBound,
    estimatedPeakBytes, memoryLimitBytes, vectorNodeHandSlots: p * hands });
  for (const n of [preflight.totalStates, informationSetUpperBound, p * hands]) {
    if (!Number.isSafeInteger(n) || n < 0 || n >= 2 ** 31) throw new Error("Vector turn count/index overflow");
  }
  return { topology, ranges, preflight };
}
export function preflightVectorTurn(request: TurnRequest, memoryLimitBytes = VECTOR_MEMORY_LIMIT) {
  return prepare(request, memoryLimitBytes).preflight;
}

export function vectorInformationKey(request: TurnRequest, state: TurnState, player: 0 | 1, hand: RiverCombo) {
  return `turn-v1:p${player}:${riverComboKey(hand)}:board=${request.board.join("")}`
    + `:river=${state.street === 0 ? "hidden" : state.river}:street=${state.street}`
    + `:turn=${state.histories[0].join("-") || "start"}:river-actions=${state.histories[1].join("-") || "start"}`;
}
export interface VectorTurnGame {
  readonly version: 1;
  readonly request: TurnRequest;
  readonly ranges: VectorRanges;
  readonly preflight: ReturnType<typeof preflightVectorTurn>;
  readonly index: GameTreeIndex<TurnAction>;
  readonly publicStates: Topology["publicStates"];
  readonly actions: Topology["actions"];
  readonly nodeKinds: Uint8Array;
  readonly nodePlayers: Int8Array;
  readonly nodeRivers: Int8Array;
  readonly nodeEdgeStarts: Int32Array;
  readonly nodeEdgeCounts: Uint8Array;
  readonly postorder: Int32Array;
  readonly edgeChildren: Int32Array;
  readonly terminalScale: Float64Array;
  readonly terminalFoldSign: Int8Array;
  readonly lookup: readonly [Int32Array, Int32Array];
  readonly infoNodes: Int32Array;
  readonly infoHands: Uint16Array;
  readonly infoPlayers: Int8Array;
  readonly actionStarts: Int32Array;
  readonly actionCounts: Uint8Array;
  readonly actionSlotCount: number;
  readonly rootNormalizer: number;
  readonly maximumDepth: number;
  readonly gameIdentity: string;
  readonly typedStorageBytes: number;
}

/** Trusted internal float64 compilation, with no pair × node storage. */
export function compileVectorTurn(input: TurnRequest, memoryLimitBytes = VECTOR_MEMORY_LIMIT): VectorTurnGame {
  const { topology, ranges, preflight } = prepare(input, memoryLimitBytes);
  const request: TurnRequest = Object.freeze({ id: input.id, board: Object.freeze([...input.board]) as TurnRequest["board"],
    rangeText: Object.freeze([...input.rangeText]) as TurnRequest["rangeText"], committedPerPlayer: input.committedPerPlayer,
    stackBehind: Object.freeze([...input.stackBehind]) as TurnRequest["stackBehind"], betSizes: Object.freeze([...input.betSizes]) as TurnRequest["betSizes"] });
  const definitions = [];
  for (let n = 0; n < topology.nodeKinds.length; n++) {
    if (topology.nodeKinds[n] !== TURN_PLAYER) continue;
    const player = topology.nodePlayers[n] as 0 | 1, own = ranges.players[player];
    for (let h = 0; h < own.hands.length; h++) {
      const stateCount = own.compatibleCounts[(topology.nodeRivers[n] + 1) * own.hands.length + h];
      if (stateCount === 0) continue;
      definitions.push({ node: n, hand: h, key: vectorInformationKey(request, topology.publicStates[n], player, own.hands[h]),
        player, actions: topology.actions[n], stateCount });
    }
  }
  definitions.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const informationSets = Object.freeze(definitions.map(({ key, player, actions, stateCount }) => Object.freeze({ key, player, actions, stateCount })));
  const byKey = new Map(informationSets.map(info => [info.key, info]));
  if (byKey.size !== definitions.length || definitions.length > preflight.informationSetUpperBound) throw new Error("Vector information-set index mismatch");
  const index: GameTreeIndex<TurnAction> = Object.freeze({ gameId: request.id, totalStates: preflight.totalStates,
    chanceNodes: preflight.chanceNodes, decisionNodes: preflight.decisionNodes, terminalNodes: preflight.terminalNodes,
    informationSets, informationSetByKey: byKey });
  const lookup = ranges.players.map(range => new Int32Array(preflight.publicStates * range.hands.length).fill(-1)) as [Int32Array, Int32Array];
  const actionStarts = new Int32Array(definitions.length);
  let actionSlotCount = 0;
  definitions.forEach((info, i) => {
    lookup[info.player][info.node * ranges.players[info.player].hands.length + info.hand] = i;
    actionStarts[i] = actionSlotCount; actionSlotCount += info.actions.length;
  });
  const compatibleMass = new Float64Array(ranges.players[0].hands.length);
  vectorTerminalValues(ranges, 0, -1, ranges.players[1].weights, 1, 1, compatibleMass,
    createVectorKernelScratch(ranges.players[1].hands.length));
  let rootNormalizer = 0;
  for (let h = 0; h < compatibleMass.length; h++) rootNormalizer += ranges.players[0].weights[h] * compatibleMass[h];
  if (!(rootNormalizer > 0) || !Number.isFinite(rootNormalizer)) throw new Error("Invalid vector root normalizer");
  const depth = new Uint16Array(preflight.publicStates);
  for (let n = 0; n < depth.length; n++) for (let a = 0; a < topology.nodeEdgeCounts[n]; a++) {
    depth[topology.edgeChildren[topology.nodeEdgeStarts[n] + a]] = depth[n] + 1;
  }
  const arrays = { nodeKinds: topology.nodeKinds, nodePlayers: topology.nodePlayers, nodeRivers: topology.nodeRivers,
    nodeEdgeStarts: topology.nodeEdgeStarts, nodeEdgeCounts: topology.nodeEdgeCounts, postorder: topology.postorder,
    edgeChildren: topology.edgeChildren, terminalScale: topology.terminalScale, terminalFoldSign: topology.terminalFoldSign,
    infoNodes: Int32Array.from(definitions.map(info => info.node)), infoHands: Uint16Array.from(definitions.map(info => info.hand)),
    infoPlayers: Int8Array.from(definitions.map(info => info.player)), actionStarts,
    actionCounts: Uint8Array.from(definitions.map(info => info.actions.length)) };
  const rangeArrays = ranges.players.flatMap(range => [range.weights, range.card0, range.card1, range.sameOpponent,
    range.compatibleCounts, range.ranks, ...range.rankOrders]);
  const typedStorageBytes = [...Object.values(arrays), ...lookup, ...rangeArrays, ranges.riverCardIds].reduce((sum, array) => sum + array.byteLength, 0);
  const gameIdentity = JSON.stringify({ backend: "vector-turn", version: VECTOR_TURN_VERSION, rules: "turn-v1",
    request: { ...request, rangeText: ranges.players.map(range => range.hands.map((hand, h) => `${riverComboKey(hand)}:${range.weights[h]}`).join(" ")) },
    publicStates: topology.publicStates, actions: topology.actions });
  return Object.freeze({ version: VECTOR_TURN_VERSION, request, ranges, preflight, index, ...arrays,
    publicStates: topology.publicStates, actions: topology.actions, lookup: Object.freeze(lookup),
    actionSlotCount, rootNormalizer, maximumDepth: Math.max(...depth), gameIdentity, typedStorageBytes });
}

export function encodeVectorPolicy(game: VectorTurnGame, policy: BehavioralStrategy<TurnAction>): Float64Array {
  validateStrategy(game.index, policy);
  const flat = new Float64Array(game.actionSlotCount);
  game.index.informationSets.forEach((info, i) => {
    const entry = policy.get(info.key)!;
    entry.probabilities.forEach((p, a) => {
      if (p < 0 || p > 1) throw new Error("Vector strategy probabilities must be in [0,1]");
      flat[game.actionStarts[i] + a] = p;
    });
  });
  return flat;
}
export function decodeVectorPolicy(game: VectorTurnGame, flat: Float64Array): BehavioralStrategy<TurnAction> {
  if (flat.length !== game.actionSlotCount) throw new Error("Vector policy size mismatch");
  const result = new Map(game.index.informationSets.map((info, i) => [info.key, { actions: [...info.actions],
    probabilities: Array.from(flat.subarray(game.actionStarts[i], game.actionStarts[i] + game.actionCounts[i])) }]));
  validateStrategy(game.index, result);
  return result;
}
