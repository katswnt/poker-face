import { canonicalRiverCombo, RIVER_DECK, type RiverCombo } from "../river/cards";
import { TURN_DEMO_REQUEST } from "../turn/fixture";
import type { TurnRequest } from "../turn/game";

export const COMPACT_TURN_BOUNDARY: TurnRequest = {
  id: "compact-turn-boundary-16",
  board: ["9c", "7d", "4h", "2s"],
  rangeText: ["AcQc AdQd AhQh AsQs", "JcTc JdTd JhTh JsTs"],
  committedPerPlayer: 50, stackBehind: [150, 150], betSizes: [50, 100],
};
export const COMPACT_TURN_FIXTURES: readonly TurnRequest[] = [
  TURN_DEMO_REQUEST,
  COMPACT_TURN_BOUNDARY,
  { ...TURN_DEMO_REQUEST, id: "compact-turn-short-call", stackBehind: [17, 5] },
  { ...TURN_DEMO_REQUEST, id: "compact-turn-zero-stack", stackBehind: [0, 150] },
  { ...COMPACT_TURN_BOUNDARY, id: "compact-turn-tie-board", board: ["Ac", "Kd", "Qh", "Js"],
    rangeText: ["2c3c 2d3d", "4c5c 4d5d"], stackBehind: [3, 7], betSizes: [2, 5] },
];

// Synthetic M2 probe, locked before its first acceptance solve. Not a playing range.
const deck = RIVER_DECK.filter(card => !COMPACT_TURN_BOUNDARY.board.includes(card));
const combinations: RiverCombo[] = [];
for (let a = 0; a < deck.length; a++) for (let b = a + 1; b < deck.length; b++) {
  combinations.push(canonicalRiverCombo([deck[a], deck[b]]));
}
const strideRange = (offset: number) => Array.from({ length: 64 }, (_, i) =>
  `${combinations[(offset + i * 17) % combinations.length].join("")}:${1 + i % 4}`,
).join(" ");
export const POSTFLOP_M2_PROBE: TurnRequest = {
  ...COMPACT_TURN_BOUNDARY, id: "postflop-m2-64-by-64",
  rangeText: [strideRange(0), strideRange(7)],
};
