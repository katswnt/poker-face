import type { FlopRequest } from "./rules";
import { canonicalRiverCombo, RIVER_DECK } from "../../river/cards";

/** Locked before acceptance; handcrafted illustrative ranges, not preflop advice. */
export const FLOP_REFERENCE_REQUEST: FlopRequest = {
  id: "heads-up-flop-v1", board: ["Ks", "8s", "4d"],
  rangeText: ["AsQs:0.5 KdKh", "QsJs 9h9d:2"], committedPerPlayer: 50,
  stackBehind: [75, 75], betSizes: [25, 25, 25],
};
export const FLOP_REFERENCE_RUN = Object.freeze({ iterations: 1024, algorithm: "cfr-plus" as const,
  averagingDelay: 20, checkpointIterations: [256, 1024], maximumExploitability: 0.25 });

const wideBoard = ["9c", "7d", "4h"] as const;
const deck = RIVER_DECK.filter(c => !(wideBoard as readonly string[]).includes(c));
const combos = deck.flatMap((a, i) => deck.slice(i + 1).map(b => canonicalRiverCombo([a, b])));
const range = (offset: number) => Array.from({ length: 64 }, (_, i) => `${combos[(offset + 17 * i) % combos.length].join("")}:${1 + i % 4}`).join(" ");
export const FLOP_WIDE_REQUEST: FlopRequest = {
  id: "flop-vector-wide-64", board: wideBoard, rangeText: [range(0), range(7)],
  committedPerPlayer: 50, stackBehind: [75, 75], betSizes: [25, 25, 25],
};
