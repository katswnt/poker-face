import type { GameTreeIndex } from "../../toy/game";
import { riverComboKey } from "../../river/cards";
import { TURN_CHANCE, TURN_PLAYER, TURN_TERMINAL } from "../compact-turn";
import type { VectorCoreGame } from "../vector/core";
import { compileVectorRanges } from "../vector/ranges";
import { createVectorKernelScratch, vectorTerminalValues } from "../vector/kernels";
import { initialTurnV2State, nextTurnV2Action, nextTurnV2River, turnV2Actions, turnV2InformationKey,
  validateTurnV2Request, type TurnV2Action, type TurnV2Request, type TurnV2State } from "./rules";

export const TURN_V2_MEMORY_LIMIT = 2 * 1024 ** 3;
export const TURN_V2_CHECKPOINT_LIMIT = 32 * 1024 ** 2;
export const TURN_V2_PUBLIC_LIMIT = 20_000;

function prepare(input: unknown, memoryLimitBytes: number) {
  const request = validateTurnV2Request(input);
  if (!Number.isSafeInteger(memoryLimitBytes) || memoryLimitBytes < 1 || memoryLimitBytes > TURN_V2_MEMORY_LIMIT) {
    throw new Error(`Turn v2 memory limit must be 1..${TURN_V2_MEMORY_LIMIT} bytes`);
  }
  const ranges = compileVectorRanges(request);
  let publicStates = 0, perDealStates = 0, chanceNodes = 0, decisionNodes = 0, terminalNodes = 0;
  let informationSetUpperBound = 0, actionSlotUpperBound = 0;
  // Betting does not depend on river rank/suit. Count ONE continuation with two
  // exact multiplicities, before any public-node × range allocation.
  const count = (state: TurnV2State, publicCopies: number, dealCopies: number) => {
    publicStates += publicCopies; perDealStates += dealCopies;
    if (publicStates > TURN_V2_PUBLIC_LIMIT) throw new Error(`Turn v2 exceeds ${TURN_V2_PUBLIC_LIMIT} public states`);
    if (state.phase === "terminal") { terminalNodes += dealCopies; return; }
    if (state.phase === "river-card") {
      chanceNodes += dealCopies;
      count(nextTurnV2River(request, state, ranges.rivers[0]), publicCopies * 48, dealCopies * 44); return;
    }
    decisionNodes += dealCopies;
    const actions = turnV2Actions(request, state);
    informationSetUpperBound += publicCopies * ranges.players[state.actor!].hands.length;
    actionSlotUpperBound += publicCopies * ranges.players[state.actor!].hands.length * actions.length;
    if (informationSetUpperBound > 250_000 || actionSlotUpperBound > 750_000) throw new Error("Turn v2 information-set/action-slot admission limit exceeded");
    for (const action of actions) count(nextTurnV2Action(request, state, action), publicCopies, dealCopies);
  };
  count(initialTurnV2State(request), 1, 1);
  const hands = ranges.players[0].hands.length + ranges.players[1].hands.length;
  // Two JSON number arrays, including delimiters and worst finite float64 text.
  // Identity is compact canonical input, not a repeated serialized public tree.
  const estimatedCheckpointBytes = 256 * 1024 + actionSlotUpperBound * 52;
  if (estimatedCheckpointBytes > TURN_V2_CHECKPOINT_LIMIT) throw new Error("Turn v2 estimated checkpoint exceeds 32 MiB");
  const estimatedPeakBytes = 256 * 1024 * 1024 + informationSetUpperBound * 6000 + publicStates * hands * 80 + hands * 48 * 128;
  if (estimatedPeakBytes > memoryLimitBytes) throw new Error(`Turn v2 estimates ${estimatedPeakBytes} peak bytes; limit ${memoryLimitBytes}`);
  const deals = ranges.compatibleDeals;
  const preflight = Object.freeze({ compatibleDeals: deals, legalRiversPerDeal: 44 as const, dealRiverPairs: deals * 44,
    rangeEntries: Object.freeze(ranges.players.map(range => range.hands.length)), blockedCombos: ranges.blockedCombos,
    publicStates, totalStates: 1 + deals * perDealStates, chanceNodes: 1 + deals * chanceNodes,
    decisionNodes: deals * decisionNodes, terminalNodes: deals * terminalNodes, informationSetUpperBound,
    actionSlotUpperBound, estimatedCheckpointBytes, estimatedPeakBytes, memoryLimitBytes, vectorNodeHandSlots: publicStates * hands });
  for (const n of [preflight.totalStates, actionSlotUpperBound, publicStates * hands]) {
    if (!Number.isSafeInteger(n) || n < 0 || n >= 2 ** 31) throw new Error("Turn v2 count/index overflow");
  }
  return { request, ranges, preflight };
}
export function preflightTurnV2(input: unknown, memoryLimitBytes = TURN_V2_MEMORY_LIMIT) {
  return prepare(input, memoryLimitBytes).preflight;
}
export interface TurnV2Game extends VectorCoreGame<TurnV2Action> {
  readonly version: 2;
  readonly request: TurnV2Request;
  readonly preflight: ReturnType<typeof preflightTurnV2>;
  readonly publicStates: readonly TurnV2State[];
  readonly typedStorageBytes: number;
}

/** Public tree × each player's own range; no private-pair × node table. */
export function compileTurnV2(input: unknown, memoryLimitBytes = TURN_V2_MEMORY_LIMIT): TurnV2Game {
  const { request, ranges, preflight } = prepare(input, memoryLimitBytes);
  const states: TurnV2State[] = [], actions: (readonly TurnV2Action[])[] = [];
  const kinds: number[] = [], players: number[] = [], rivers: number[] = [], starts: number[] = [], counts: number[] = [];
  const edges: number[] = [], postorder: number[] = [], scales: number[] = [], folds: number[] = [], depths: number[] = [];
  const visit = (state: TurnV2State, depth: number): number => {
    const id = states.length;
    if (id >= preflight.publicStates) throw new Error("Turn v2 topology exceeded preflight");
    states.push(state); depths.push(depth); players.push(state.actor ?? -1);
    rivers.push(state.river === null ? -1 : ranges.rivers.indexOf(state.river));
    scales.push(request.committedPerPlayer + state.carried + Math.min(...state.streetPaid));
    folds.push(state.folded === null ? 0 : state.folded === 0 ? -1 : 1);
    const menu = Object.freeze([...turnV2Actions(request, state)]);
    actions.push(menu); starts.push(edges.length);
    kinds.push(state.phase === "terminal" ? TURN_TERMINAL : state.phase === "river-card" ? TURN_CHANCE : TURN_PLAYER);
    const count = state.phase === "river-card" ? 48 : menu.length;
    counts.push(count);
    const start = edges.length;
    edges.push(...Array<number>(count).fill(-1));
    if (state.phase === "river-card") ranges.rivers.forEach((card, i) => { edges[start + i] = visit(nextTurnV2River(request, state, card), depth + 1); });
    else menu.forEach((action, i) => { edges[start + i] = visit(nextTurnV2Action(request, state, action), depth + 1); });
    postorder.push(id); return id;
  };
  visit(initialTurnV2State(request), 0);
  if (states.length !== preflight.publicStates) throw new Error("Turn v2 topology count mismatch");
  const definitions = [];
  for (let n = 0; n < states.length; n++) {
    if (kinds[n] !== TURN_PLAYER) continue;
    const player = players[n] as 0 | 1, own = ranges.players[player];
    for (let h = 0; h < own.hands.length; h++) {
      const stateCount = own.compatibleCounts[(rivers[n] + 1) * own.hands.length + h];
      if (!stateCount) continue;
      definitions.push({ node: n, hand: h, key: turnV2InformationKey(request, states[n], player, own.hands[h]), player, actions: actions[n], stateCount });
    }
  }
  definitions.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const informationSets = Object.freeze(definitions.map(({ key, player, actions, stateCount }) => Object.freeze({ key, player, actions, stateCount })));
  const byKey = new Map(informationSets.map(info => [info.key, info]));
  if (byKey.size !== definitions.length || definitions.length > preflight.informationSetUpperBound) throw new Error("Turn v2 information-set index mismatch");
  const index: GameTreeIndex<TurnV2Action> = Object.freeze({ gameId: request.id, totalStates: preflight.totalStates,
    chanceNodes: preflight.chanceNodes, decisionNodes: preflight.decisionNodes, terminalNodes: preflight.terminalNodes,
    informationSets, informationSetByKey: byKey });
  const lookup = ranges.players.map(range => new Int32Array(states.length * range.hands.length).fill(-1)) as [Int32Array, Int32Array];
  const actionStarts = new Int32Array(definitions.length);
  let actionSlotCount = 0;
  definitions.forEach((info, i) => {
    lookup[info.player][info.node * ranges.players[info.player].hands.length + info.hand] = i;
    actionStarts[i] = actionSlotCount; actionSlotCount += info.actions.length;
  });
  if (actionSlotCount > preflight.actionSlotUpperBound) throw new Error("Turn v2 action-slot count mismatch");
  const mass = new Float64Array(ranges.players[0].hands.length);
  vectorTerminalValues(ranges, 0, -1, ranges.players[1].weights, 1, 1, mass, createVectorKernelScratch(ranges.players[1].hands.length));
  let rootNormalizer = 0;
  for (let h = 0; h < mass.length; h++) rootNormalizer += ranges.players[0].weights[h] * mass[h];
  if (!(rootNormalizer > 0) || !Number.isFinite(rootNormalizer)) throw new Error("Invalid turn v2 root normalizer");
  const arrays = { nodeKinds: Uint8Array.from(kinds), nodePlayers: Int8Array.from(players), nodeRivers: Int8Array.from(rivers),
    nodeEdgeStarts: Int32Array.from(starts), nodeEdgeCounts: Uint8Array.from(counts), postorder: Int32Array.from(postorder),
    edgeChildren: Int32Array.from(edges), terminalScale: Float64Array.from(scales), terminalFoldSign: Int8Array.from(folds),
    infoNodes: Int32Array.from(definitions.map(info => info.node)), infoHands: Uint16Array.from(definitions.map(info => info.hand)),
    infoPlayers: Int8Array.from(definitions.map(info => info.player)), actionStarts, actionCounts: Uint8Array.from(definitions.map(info => info.actions.length)) };
  const rangeArrays = ranges.players.flatMap(range => [range.weights, range.card0, range.card1, range.sameOpponent,
    range.compatibleCounts, range.ranks, ...range.rankOrders]);
  const typedStorageBytes = [...Object.values(arrays), ...lookup, ...rangeArrays, ranges.riverCardIds].reduce((sum, a) => sum + a.byteLength, 0);
  const gameIdentity = JSON.stringify({ backend: "vector-turn", version: 1, rules: "turn-v2",
    request: { ...request, rangeText: ranges.players.map(range => range.hands.map((hand, h) => `${riverComboKey(hand)}:${range.weights[h]}`).join(" ")) },
    publicStates: states.length, actionSlots: actionSlotCount });
  return Object.freeze({ version: 2, request, ranges, preflight, index, ...arrays, publicStates: Object.freeze(states),
    actions: Object.freeze(actions), lookup: Object.freeze(lookup), actionSlotCount, rootNormalizer,
    maximumDepth: Math.max(...depths), gameIdentity, typedStorageBytes });
}
