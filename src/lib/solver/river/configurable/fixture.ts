import { RIVER_V1_SCENARIO } from "../fixture";
import { createConfigurableRiverGame, type ConfigurableRiverScenario } from "./game";
import { parseConfigurableRiverRange } from "./range";

export const CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO: ConfigurableRiverScenario = {
  id: "river-holdem-v1-adapter",
  version: 2,
  board: [...RIVER_V1_SCENARIO.board],
  ranges: [
    RIVER_V1_SCENARIO.ranges[0].map(entry => ({ ...entry })),
    RIVER_V1_SCENARIO.ranges[1].map(entry => ({ ...entry })),
  ],
  committed: [...RIVER_V1_SCENARIO.committed],
  stackBehind: [...RIVER_V1_SCENARIO.stackBehind],
  positions: [...RIVER_V1_SCENARIO.positions],
  actionOrder: [0, 1],
  openingBetSizes: [50, 100],
  raiseToSizes: [100],
  maxRaises: 1,
};

export const configurableRiverV1AdapterGame = createConfigurableRiverGame(
  CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO,
);

const DEMO_BOARD = ["Ks", "8s", "4s", "2c", "9d"] as const;

/** A second, parser-built scenario proving v2 is not only a renamed v1 fixture. */
export const CONFIGURABLE_RIVER_V2_DEMO_SCENARIO: ConfigurableRiverScenario = {
  id: "river-configurable-v2",
  version: 2,
  board: DEMO_BOARD,
  ranges: [
    parseConfigurableRiverRange("AA AQs 76s", DEMO_BOARD).entries,
    parseConfigurableRiverRange("JJ ATs 65s", DEMO_BOARD).entries,
  ],
  committed: [50, 50],
  stackBehind: [100, 100],
  positions: ["out-of-position", "in-position"],
  actionOrder: [0, 1],
  openingBetSizes: [50, 100],
  raiseToSizes: [100],
  maxRaises: 1,
};

export const configurableRiverV2DemoGame = createConfigurableRiverGame(
  CONFIGURABLE_RIVER_V2_DEMO_SCENARIO,
);
