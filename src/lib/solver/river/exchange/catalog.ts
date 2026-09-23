import type { ConfigurableRiverV3Request } from "../configurable-v3/solve";

export const RIVER_BENCHMARK_SUITE_VERSION = 1;

export interface RiverBenchmark {
  readonly id: string;
  readonly description: string;
  readonly request: ConfigurableRiverV3Request;
  readonly solver: { readonly iterations: number; readonly algorithm: "cfr-plus"; readonly averagingDelay: number };
}

const base: ConfigurableRiverV3Request = {
  id: "river-configurable-v3",
  board: ["Ks", "8s", "4s", "2c", "9d"],
  rangeText: ["AA AQs 76s", "JJ ATs 65s"],
  committed: [50, 50], stackBehind: [200, 200],
  openingBetSizes: [50, 100, 200], raiseToSizes: [100, 150, 200], maxRaises: 2,
};
const solver = { iterations: 1_000, algorithm: "cfr-plus", averagingDelay: 20 } as const;

/** Small, fixed reference games, not a representative test of full hold'em strength. */
export const RIVER_BENCHMARKS: readonly RiverBenchmark[] = [
  {
    id: "v3-two-raise",
    description: "The accepted v3 example: several sizes and two raises.",
    request: base, solver,
  },
  {
    id: "weighted-blockers",
    description: "Unequal range weights, shared private cards, and one raise.",
    request: {
      ...base, id: "exchange-weighted-blockers-v1",
      rangeText: ["AsQs:3 AhAd:2 7h6h:1", "AsTs:2 JhJd:3 6c5c:1"],
      stackBehind: [100, 100], openingBetSizes: [50, 100], raiseToSizes: [100], maxRaises: 1,
    }, solver,
  },
  {
    id: "short-all-in",
    description: "Unequal stacks, a short all-in raise, and returned uncalled chips.",
    request: {
      ...base, id: "exchange-short-all-in-v1",
      rangeText: ["AsQs KhQh", "Ts7s KdQd"], stackBehind: [120, 200],
      openingBetSizes: [50, 200], raiseToSizes: [100, 120, 200],
    }, solver,
  },
  {
    id: "board-ties",
    description: "The board plays for everyone; blockers still affect compatible deals.",
    request: {
      ...base, id: "exchange-board-ties-v1", board: ["As", "Ks", "Qs", "Js", "Ts"],
      rangeText: ["2c2d 3c3d", "2c4d 4c4h"], stackBehind: [100, 150],
      openingBetSizes: [50, 100], raiseToSizes: [100, 150], maxRaises: 1,
    }, solver,
  },
];

export function riverBenchmark(id: string): RiverBenchmark {
  const benchmark = RIVER_BENCHMARKS.find(entry => entry.id === id);
  if (!benchmark) throw new Error(`Unknown river benchmark ${id}; use list to see available games`);
  return benchmark;
}
