import { MULTIWAY_RIVER_V1_SCENARIO } from "./fixture";
import { createRaisedRiverGame, type RaisedRiverScenario } from "./raised-river-game";

export const RAISED_RIVER_V1_SCENARIO: RaisedRiverScenario = {
  id: "three-player-raised-river-v1",
  version: 1,
  board: MULTIWAY_RIVER_V1_SCENARIO.board,
  ranges: MULTIWAY_RIVER_V1_SCENARIO.ranges,
  committed: MULTIWAY_RIVER_V1_SCENARIO.committed,
  stackBehind: MULTIWAY_RIVER_V1_SCENARIO.stackBehind,
  positions: MULTIWAY_RIVER_V1_SCENARIO.positions,
  actionOrder: MULTIWAY_RIVER_V1_SCENARIO.actionOrder,
  betSize: 30,
  raiseTo: 60,
  maxRaises: 1,
};

export const raisedRiverV1Game = createRaisedRiverGame(RAISED_RIVER_V1_SCENARIO);
