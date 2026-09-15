import { MULTIWAY_RIVER_V1_SCENARIO } from "./fixture";
import { createSidePotRiverGame, type SidePotRiverScenario } from "./side-pot-river-game";

export const SIDE_POT_RIVER_V1_SCENARIO: SidePotRiverScenario = {
  id: "three-player-side-pot-river-v1",
  version: 1,
  board: MULTIWAY_RIVER_V1_SCENARIO.board,
  ranges: MULTIWAY_RIVER_V1_SCENARIO.ranges,
  committed: MULTIWAY_RIVER_V1_SCENARIO.committed,
  stackBehind: [30, 60, 60],
  positions: MULTIWAY_RIVER_V1_SCENARIO.positions,
  actionOrder: MULTIWAY_RIVER_V1_SCENARIO.actionOrder,
  smallBet: 30,
  allInBet: 60,
  maxRaises: 1,
};

export const sidePotRiverV1Game = createSidePotRiverGame(SIDE_POT_RIVER_V1_SCENARIO);
