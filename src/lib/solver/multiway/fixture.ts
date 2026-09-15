import { parseRiverCombo, type RiverCard } from "../river/cards";
import {
  createMultiwayRiverGame,
  type MultiwayRiverRangeEntry,
  type MultiwayRiverScenario,
} from "./river-game";

function entry(cards: string, weight: number): MultiwayRiverRangeEntry {
  return { cards: parseRiverCombo(cards), weight };
}

export const MULTIWAY_RIVER_V1_SCENARIO: MultiwayRiverScenario = {
  id: "three-player-river-v1",
  version: 1,
  board: ["Ks", "8s", "4s", "2c", "9d"] satisfies readonly RiverCard[],
  ranges: [
    [
      entry("AsQs", 3), entry("QsJs", 2), entry("KhQh", 4),
      entry("KcJc", 3), entry("9h9c", 1), entry("7h6h", 2),
    ],
    [
      entry("AsJs", 2), entry("Ts7s", 2), entry("KdQd", 4),
      entry("8h8c", 1), entry("9c8c", 3), entry("6c5c", 2),
    ],
    [
      entry("Js9s", 2), entry("AcKc", 4), entry("4h4d", 1),
      entry("Ah9h", 3), entry("QdTd", 2), entry("7c6d", 2),
    ],
  ],
  committed: [30, 30, 30],
  stackBehind: [60, 60, 60],
  positions: ["first", "middle", "last"],
  actionOrder: [0, 1, 2],
  betSize: 30,
  maxRaises: 0,
};

export const multiwayRiverV1Game = createMultiwayRiverGame(MULTIWAY_RIVER_V1_SCENARIO);
