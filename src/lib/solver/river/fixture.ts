import { parseRiverCombo } from "./cards";
import { createRiverGame, type RiverRangeEntry, type RiverScenario } from "./game";

function range(combos: readonly string[]): readonly RiverRangeEntry[] {
  return combos.map(combo => ({ cards: parseRiverCombo(combo), weight: 1 }));
}

export const RIVER_V1_SCENARIO: RiverScenario = {
  id: "river-holdem-v1",
  version: 1,
  board: ["Ks", "8s", "4s", "2c", "9d"],
  ranges: [
    range(["AsQs", "QsJs", "KhQh", "KcJc", "9h9c", "AhQh", "QhJh", "7h6h"]),
    range(["AsJs", "Ts7s", "KdQd", "8h8c", "9c8c", "AcQc", "QdJd", "6c5c"]),
  ],
  committed: [50, 50],
  stackBehind: [100, 100],
  positions: ["out-of-position", "in-position"],
  betSizes: { halfPot: 50, pot: 100 },
  maxRaises: 1,
};

export const riverV1Game = createRiverGame(RIVER_V1_SCENARIO);
