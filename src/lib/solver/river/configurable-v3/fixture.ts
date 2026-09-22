import { parseConfigurableRiverRange } from "../configurable/range";
import {
  createConfigurableRiverV3Game,
  type ConfigurableRiverV3Scenario,
} from "./game";

const BOARD = ["Ks", "8s", "4s", "2c", "9d"] as const;

/** Locked two-raise fixture used for v3 differential and money audits. */
export const CONFIGURABLE_RIVER_V3_DEMO_SCENARIO: ConfigurableRiverV3Scenario = {
  id: "river-configurable-v3",
  version: 3,
  board: BOARD,
  ranges: [
    parseConfigurableRiverRange("AA AQs 76s", BOARD).entries,
    parseConfigurableRiverRange("JJ ATs 65s", BOARD).entries,
  ],
  committed: [50, 50],
  stackBehind: [200, 200],
  positions: ["out-of-position", "in-position"],
  actionOrder: [0, 1],
  openingBetSizes: [50, 100, 200],
  raiseToSizes: [100, 150, 200],
  maxRaises: 2,
};

export const configurableRiverV3DemoGame = createConfigurableRiverV3Game(
  CONFIGURABLE_RIVER_V3_DEMO_SCENARIO,
);
