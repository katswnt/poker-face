import { RIVER_DECK, riverComboKey, riverHandScore, type RiverCard, type RiverCombo } from "../../river/cards";
import { parseConfigurableRiverRange } from "../../river/configurable/range";
import { createVectorKernelScratch, naiveTerminalValues, vectorTerminalValues, type VectorKernelScratch } from "../vector/kernels";
import type { VectorRange, VectorRanges } from "../vector/ranges";
import type { FlopRequest } from "./rules";

export function prepareFlopRanges(request: FlopRequest) {
  const parsed = request.rangeText.map(text => {
    const r = parseConfigurableRiverRange(text, request.board);
    if (r.entries.length > 64) throw new Error("Vector flop exceeds 64 hands/player");
    return r;
  });
  const players = parsed.map(r => {
    const maximum = Math.max(...r.entries.map(e => e.weight));
    const weights = Float64Array.from(r.entries.map(e => e.weight / maximum));
    if (weights.some(w => !Number.isFinite(w) || w < 1e-12)) throw new Error("Flop relative weights must be at least 1e-12");
    const hands = Object.freeze(r.entries.map(e => Object.freeze([...e.cards]) as RiverCombo));
    return { hands, weights, card0: Uint8Array.from(hands.map(h => RIVER_DECK.indexOf(h[0]))),
      card1: Uint8Array.from(hands.map(h => RIVER_DECK.indexOf(h[1]))), sameOpponent: new Int32Array(hands.length).fill(-1) };
  }) as [Pick<VectorRange, "hands" | "weights" | "card0" | "card1" | "sameOpponent">, Pick<VectorRange, "hands" | "weights" | "card0" | "card1" | "sameOpponent">];
  for (const p of [0, 1] as const) {
    const ids = new Map(players[1 - p].hands.map((h, i) => [riverComboKey(h), i]));
    players[p].hands.forEach((h, i) => { players[p].sameOpponent[i] = ids.get(riverComboKey(h)) ?? -1; });
  }
  const deck = Object.freeze(RIVER_DECK.filter(c => !request.board.includes(c)));
  const seed = { players, deck, blockedCombos: parsed.map(r => r.blockedComboCount) };
  const root = flopBoardView(request, seed, null, null);
  const compatibleDeals = root.players[0].compatibleCounts.subarray(0, players[0].hands.length).reduce((s, n) => s + n, 0);
  if (!compatibleDeals) throw new Error("Vector flop ranges have no compatible private deals");
  const mass = new Float64Array(players[0].hands.length);
  vectorTerminalValues(root, 0, -1, players[1].weights, 1, 1, mass, createVectorKernelScratch(players[1].hands.length));
  let rootNormalizer = 0; players[0].weights.forEach((w, i) => { rootNormalizer += w * mass[i]; });
  if (!(rootNormalizer > 0) || !Number.isFinite(rootNormalizer)) throw new Error("Invalid flop root normalization");
  return Object.freeze({ ...seed, root, compatibleDeals, rootNormalizer });
}
type Seed = { players: readonly Pick<VectorRange, "hands" | "weights" | "card0" | "card1" | "sameOpponent">[]; deck: readonly RiverCard[] };
/** Board-local adapter to the unchanged audited terminal kernel. Both cards are masked. */
function flopBoardView(request: FlopRequest, seed: Seed, turn: RiverCard | null, river: RiverCard | null): VectorRanges {
  const blocked = new Set([turn, river]);
  const players = seed.players.map((own, p) => {
    const other = seed.players[1 - p], counts = new Uint16Array(52); let total = 0;
    for (let j = 0; j < other.hands.length; j++) {
      if (other.hands[j].some(c => blocked.has(c))) continue;
      total++; counts[other.card0[j]]++; counts[other.card1[j]]++;
    }
    const compatibleCounts = new Uint16Array(2 * own.hands.length), ranks = new Float64Array(own.hands.length), order: number[] = [];
    for (let h = 0; h < own.hands.length; h++) {
      if (own.hands[h].some(c => blocked.has(c))) continue;
      const count = total - counts[own.card0[h]] - counts[own.card1[h]] + Number(own.sameOpponent[h] >= 0);
      compatibleCounts[h] = count; compatibleCounts[own.hands.length + h] = count;
      if (turn && river) { ranks[h] = riverHandScore(own.hands[h], [...request.board, turn, river]); order.push(h); }
    }
    return Object.freeze({ ...own, compatibleCounts, ranks,
      rankOrders: Object.freeze([Int32Array.from(order.sort((a, b) => ranks[a] - ranks[b] || a - b))]) });
  }) as [VectorRange, VectorRange];
  return Object.freeze({ players: Object.freeze(players), rivers: river ? [river] : [],
    riverCardIds: Uint8Array.from(river ? [RIVER_DECK.indexOf(river)] : []), blockedCombos: [0, 0] as const,
    compatibleDeals: players[0].compatibleCounts.subarray(0, players[0].hands.length).reduce((s, n) => s + n, 0) });
}
export function compileFlopRanges(request: FlopRequest, seed = prepareFlopRanges(request)) {
  const boards: { turn: RiverCard | null; river: RiverCard | null; view: VectorRanges }[] = [{ turn: null, river: null, view: seed.root }];
  for (const turn of seed.deck) boards.push({ turn, river: null, view: flopBoardView(request, seed, turn, null) });
  for (const turn of seed.deck) for (const river of seed.deck) if (turn !== river) boards.push({ turn, river, view: flopBoardView(request, seed, turn, river) });
  const byCards = new Map(boards.map((b, i) => [`${b.turn ?? "-"}/${b.river ?? "-"}`, i]));
  return Object.freeze({ ...seed, boards: Object.freeze(boards), byCards });
}
export type FlopRanges = ReturnType<typeof compileFlopRanges>;
export function flopTerminalValues(ranges: FlopRanges, player: 0 | 1, board: number, opponentWeights: Float64Array,
  scale: number, fold: number, output: Float64Array, scratch: VectorKernelScratch, masked: Float64Array, naive = false) {
  const context = ranges.boards[board];
  if (!context || (!fold && !context.river)) throw new Error("Invalid flop terminal board");
  const opponent = context.view.players[1 - player];
  if (masked.length !== opponentWeights.length) throw new Error("Flop terminal dimensions disagree");
  for (let h = 0; h < masked.length; h++) masked[h] = opponent.compatibleCounts[h] ? opponentWeights[h] : 0;
  if (naive) naiveTerminalValues(context.view, player, fold ? -1 : 0, masked, scale, fold, output);
  else vectorTerminalValues(context.view, player, fold ? -1 : 0, masked, scale, fold, output, scratch);
  // The old naive fold oracle only knows one revealed card. Apply this board's full own mask too.
  if (naive) for (let h = 0; h < output.length; h++) if (!context.view.players[player].compatibleCounts[h]) output[h] = 0;
}
