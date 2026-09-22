import type { ConfigurableRiverRequest } from "../configurable/solve";

/** Locked exact fixture above the repeated compact engine's 50,000-state ceiling. */
export const FACTORIZED_RIVER_WIDE_REQUEST = {
  id: "factorized-wide-fixture",
  board: ["2c", "3d", "4h", "7s", "9c"],
  rangeText: [
    "AA KK QQ JJ TT 88 66 55 AKs AQs AJs ATs KQs KJs QJs",
    "AA KK QQ JJ TT 88 66 55 AKs AQs AJs ATs KQs KJs QJs",
  ],
  committed: [50, 50],
  stackBehind: [100, 100],
  openingBetSizes: [50, 100],
  raiseToSizes: [100],
} as const satisfies ConfigurableRiverRequest;
