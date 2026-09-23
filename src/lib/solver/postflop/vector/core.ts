import { validateStrategy, type BehavioralStrategy, type GameTreeIndex } from "../../toy/game";
import type { VectorRanges } from "./ranges";

/** The numeric backend knows public topology and money, not a betting-rule version. */
export interface VectorCoreGame<Action extends string> {
  readonly request: { readonly committedPerPlayer: number; readonly stackBehind: readonly [number, number] };
  readonly ranges: VectorRanges;
  readonly index: GameTreeIndex<Action>;
  readonly actions: readonly (readonly Action[])[];
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
}

export function encodeVectorPolicy<Action extends string>(game: VectorCoreGame<Action>, policy: BehavioralStrategy<Action>): Float64Array {
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
export function decodeVectorPolicy<Action extends string>(game: VectorCoreGame<Action>, flat: Float64Array): BehavioralStrategy<Action> {
  if (flat.length !== game.actionSlotCount) throw new Error("Vector policy size mismatch");
  const result = new Map(game.index.informationSets.map((info, i) => [info.key, { actions: [...info.actions],
    probabilities: Array.from(flat.subarray(game.actionStarts[i], game.actionStarts[i] + game.actionCounts[i])) }]));
  validateStrategy(game.index, result);
  return result;
}
