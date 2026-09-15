import { MULTIWAY_RIVER_V1_SCENARIO } from "./fixture";
import { createTwoSizeRiverGame, type TwoSizeRiverScenario } from "./two-size-river-game";

export const TWO_SIZE_RIVER_V1_SCENARIO: TwoSizeRiverScenario = {
  id: "three-player-two-size-river-v1",
  version: 1,
  board: MULTIWAY_RIVER_V1_SCENARIO.board,
  ranges: MULTIWAY_RIVER_V1_SCENARIO.ranges,
  committed: MULTIWAY_RIVER_V1_SCENARIO.committed,
  stackBehind: MULTIWAY_RIVER_V1_SCENARIO.stackBehind,
  positions: MULTIWAY_RIVER_V1_SCENARIO.positions,
  actionOrder: MULTIWAY_RIVER_V1_SCENARIO.actionOrder,
  smallBet: 30,
  allInBet: 60,
  maxRaises: 1,
};

export const twoSizeRiverV1Game = createTwoSizeRiverGame(TWO_SIZE_RIVER_V1_SCENARIO);
