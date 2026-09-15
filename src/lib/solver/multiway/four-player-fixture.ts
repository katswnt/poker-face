import { parseRiverCombo } from "../river/cards";
import {
  createFourPlayerRiverGame,
  type FourPlayerRiverScenario,
} from "./four-player-river-game";

function weighted(entries: readonly (readonly [string, number])[]) {
  return entries.map(([cards, weight]) => ({ cards: parseRiverCombo(cards), weight }));
}

export const FOUR_PLAYER_RIVER_V1_SCENARIO: FourPlayerRiverScenario = {
  id: "four-player-river-v1",
  version: 1,
  board: ["Ks", "8s", "4s", "2c", "9d"],
  ranges: [
    weighted([["AsQs", 3], ["QsJs", 2], ["KhQh", 4], ["KcJc", 3]]),
    weighted([["AsJs", 2], ["Ts7s", 2], ["KdQd", 4], ["8h8c", 1]]),
    weighted([["Js9s", 2], ["AcKc", 4], ["4h4d", 1], ["Ah9h", 3]]),
    weighted([["QcTc", 3], ["9c8c", 2], ["7c6c", 2], ["AdJd", 4]]),
  ],
  committed: [30, 30, 30, 30],
  stackBehind: [60, 60, 60, 60],
  positions: ["first", "second", "third", "last"],
  actionOrder: [0, 1, 2, 3],
  betSize: 30,
  maxRaises: 0,
};

export const fourPlayerRiverV1Game = createFourPlayerRiverGame(FOUR_PLAYER_RIVER_V1_SCENARIO);
