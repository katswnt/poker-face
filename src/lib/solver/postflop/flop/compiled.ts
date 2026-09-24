import { riverComboKey } from "../../river/cards";
import { compileFlopRanges, prepareFlopRanges } from "./ranges";
import { countFlopSkeleton, flopActions, initialFlopState, nextFlopAction, nextFlopCard, validateFlopRequest,
  type FlopRequest, type FlopState } from "./rules";

export const FLOP_VECTOR_MEMORY_LIMIT = 2 * 1024 ** 3;
export const FLOP_TERMINAL = 0, FLOP_CHANCE = 1, FLOP_PLAYER = 2;
function prepare(input: FlopRequest, memoryLimitBytes: number) {
  const request = validateFlopRequest(input), seed = prepareFlopRanges(request);
  if (!Number.isSafeInteger(memoryLimitBytes) || memoryLimitBytes < 1 || memoryLimitBytes > FLOP_VECTOR_MEMORY_LIMIT) throw new Error("Invalid vector flop memory limit");
  const publicCounts = countFlopSkeleton(request, true), privateCounts = countFlopSkeleton(request);
  if (publicCounts.totalStates > 250000) throw new Error("Vector flop exceeds 250,000 public states");
  let actionSlots = 0;
  const count = (state: FlopState, copies: number) => {
    if (state.phase === "terminal") return;
    if (state.phase === "card") {
      const card = seed.deck.find(c => c !== state.turn)!;
      count(nextFlopCard(request, state, card), copies * (state.street === 0 ? 49 : 48)); return;
    }
    actionSlots += 2 * seed.players[state.actor!].hands.length * copies;
    flopActions(state).forEach(a => count(nextFlopAction(request, state, a), copies));
  };
  count(initialFlopState(request), 1);
  if (actionSlots > 12000000) throw new Error("Vector flop exceeds 12,000,000 action slots");
  const nodeHandSlots = publicCounts.totalStates * seed.players.reduce((s, p) => s + p.hands.length, 0);
  const estimatedPeakBytes = 384 * 1024 ** 2 + 56 * actionSlots + 16 * nodeHandSlots + 400 * publicCounts.totalStates + 32 * 1024 ** 2;
  if (estimatedPeakBytes > memoryLimitBytes) throw new Error(`Vector flop estimates ${estimatedPeakBytes} peak bytes; limit ${memoryLimitBytes}`);
  for (const n of [nodeHandSlots, actionSlots, publicCounts.totalStates]) if (!Number.isSafeInteger(n) || n >= 2 ** 31) throw new Error("Vector flop array index overflow");
  const repeated = Object.fromEntries(Object.entries(privateCounts).map(([k, n]) => [k, n * seed.compatibleDeals + (k === "totalStates" || k === "chanceNodes" ? 1 : 0)]));
  if (Object.values(repeated).some(n => !Number.isSafeInteger(n))) throw new Error("Vector flop equivalent count overflow");
  const preflight = Object.freeze({ rangeEntries: seed.players.map(p => p.hands.length), blockedCombos: seed.blockedCombos,
    compatibleDeals: seed.compatibleDeals, orderedRunoutsPerDeal: 1980, dealRunoutPairs: seed.compatibleDeals * 1980,
    publicStates: publicCounts.totalStates, equivalentCounts: repeated, actionSlots, nodeHandSlots, estimatedPeakBytes, memoryLimitBytes });
  return { request, seed, preflight };
}
export const preflightVectorFlop = (input: FlopRequest, memoryLimitBytes = FLOP_VECTOR_MEMORY_LIMIT) => prepare(input, memoryLimitBytes).preflight;

export function compileVectorFlop(input: FlopRequest, memoryLimitBytes = FLOP_VECTOR_MEMORY_LIMIT) {
  const { request, seed, preflight } = prepare(input, memoryLimitBytes), ranges = compileFlopRanges(request, seed), size = preflight.publicStates;
  const states: FlopState[] = [], kinds = new Uint8Array(size), players = new Int8Array(size).fill(-1), boards = new Uint16Array(size);
  const edgeStarts = new Int32Array(size), edgeCounts = new Uint8Array(size), edges = new Int32Array(size - 1),
    actionStarts = new Int32Array(size).fill(-1), scales = new Float64Array(size), folds = new Int8Array(size), depths = new Uint8Array(size);
  let nextEdge = 0, slots = 0, informationSets = 0, maximumDepth = 0;
  const visit = (state: FlopState, depth: number): number => {
    const n = states.length; if (n >= size) throw new Error("Flop topology exceeds preflight");
    states.push(state); depths[n] = depth; maximumDepth = Math.max(maximumDepth, depth);
    boards[n] = ranges.byCards.get(`${state.turn ?? "-"}/${state.river ?? "-"}`)!;
    scales[n] = request.committedPerPlayer + Math.min(...state.put); folds[n] = state.folded === null ? 0 : state.folded === 0 ? -1 : 1;
    if (state.phase === "terminal") return n;
    kinds[n] = state.phase === "card" ? FLOP_CHANCE : FLOP_PLAYER; players[n] = state.actor ?? -1;
    const cards = state.phase === "card" ? ranges.deck.filter(c => c !== state.turn) : [];
    const actions = flopActions(state), count = state.phase === "card" ? cards.length : actions.length;
    const start = nextEdge; edgeStarts[n] = start; edgeCounts[n] = count; nextEdge += count;
    if (state.phase === "play") {
      actionStarts[n] = slots; const own = ranges.boards[boards[n]].view.players[state.actor!];
      slots += 2 * own.hands.length;
      for (let h = 0; h < own.hands.length; h++) if (own.compatibleCounts[h]) informationSets++;
    }
    if (state.phase === "card") cards.forEach((card, i) => { edges[start + i] = visit(nextFlopCard(request, state, card), depth + 1); });
    else actions.forEach((a, i) => { edges[start + i] = visit(nextFlopAction(request, state, a), depth + 1); });
    return n;
  };
  visit(initialFlopState(request), 0);
  if (states.length !== size || nextEdge !== edges.length || slots !== preflight.actionSlots) throw new Error("Flop topology count mismatch");
  const arrays = { kinds, players, boards, edgeStarts, edgeCounts, edges, actionStarts, scales, folds, depths };
  const seedBytes = ranges.players.reduce((s, p) => s + p.weights.byteLength + p.card0.byteLength + p.card1.byteLength + p.sameOpponent.byteLength, 0);
  const rangeBytes = ranges.boards.reduce((s, b) => s + b.view.riverCardIds.byteLength + b.view.players.reduce((t, p) => t + p.compatibleCounts.byteLength + p.ranks.byteLength + p.rankOrders[0].byteLength, 0), seedBytes);
  const typedStorageBytes = Object.values(arrays).reduce((s, a) => s + a.byteLength, rangeBytes);
  const gameIdentity = JSON.stringify({ backend: "vector-flop", version: 1, rules: "flop-v1", request: { ...request,
    rangeText: ranges.players.map(p => p.hands.map((h, i) => `${riverComboKey(h)}:${p.weights[i]}`).join(" ")) }, publicStates: size, actionSlots: slots });
  return Object.freeze({ request, preflight, ranges, states: Object.freeze(states), ...arrays, informationSets, maximumDepth, typedStorageBytes, gameIdentity });
}
export type VectorFlop = ReturnType<typeof compileVectorFlop>;
