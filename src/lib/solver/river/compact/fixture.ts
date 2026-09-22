import type { ConfigurableRiverRequest } from "../configurable/solve";

/** Locked fixture just beyond the readable engine's 500-compatible-deal ceiling. */
export const COMPACT_RIVER_WIDER_REQUEST = {
  id: "compact-wide-fixture",
  board: ["2c", "3d", "4h", "7s", "9c"],
  rangeText: ["AA KK QQ JJ TT", "AA KK QQ JJ TT"],
  committed: [50, 50],
  stackBehind: [100, 100],
  openingBetSizes: [50, 100],
  raiseToSizes: [100],
} as const satisfies ConfigurableRiverRequest;
