import { test } from "node:test";
import assert from "node:assert/strict";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import type { RiverCard } from "../src/lib/solver/river/cards";
import { solveCompactCfr } from "../src/lib/solver/river/compact/cfr";
import {
  prepareConfigurableRiver,
  type ConfigurableRiverRequest,
} from "../src/lib/solver/river/configurable/solve";

const requests: readonly ConfigurableRiverRequest[] = [
  {
    id: "compact-differential-weighted",
    board: ["2c", "7d", "9h", "Js", "Kc"],
    rangeText: ["AsQh:50% AcTc 8s8d", "AdJd KhTh:25% 6c6h"],
    committed: [35, 35],
    stackBehind: [80, 120],
    openingBetSizes: [20, 80, 120],
    raiseToSizes: [40, 80, 120],
  },
  {
    id: "compact-differential-classes",
    board: ["Ah", "Kd", "Qc", "7s", "2h"],
    rangeText: ["JJ T9s", "AKo 88"],
    committed: [50, 50],
    stackBehind: [100, 100],
    openingBetSizes: [25, 75, 100],
    raiseToSizes: [50, 100],
  },
  {
    id: "compact-differential-paired-board",
    board: ["5c", "5d", "9s", "Th", "Qh"],
    rangeText: ["AA KQs", "JJ ATo"],
    committed: [60, 60],
    stackBehind: [80, 120],
    openingBetSizes: [25, 80, 120],
    raiseToSizes: [50, 80, 120],
  },
  {
    id: "compact-differential-short-all-in",
    board: ["3c", "6d", "8h", "Ts", "Qd"],
    rangeText: ["AcKc JhJc", "AsKs 9h9c"],
    committed: [25, 25],
    stackBehind: [40, 100],
    openingBetSizes: [25, 40, 100],
    raiseToSizes: [40, 50, 100],
  },
  {
    id: "compact-differential-flush-board",
    board: ["2s", "5s", "8s", "Jd", "Kh"],
    rangeText: ["AsQs AdQd 7h7c", "Ts9s AhJh 6d6c"],
    committed: [45, 45],
    stackBehind: [90, 65],
    openingBetSizes: [30, 65, 90],
    raiseToSizes: [60, 65, 90],
  },
];

test("compact ordinary CFR matches the readable engine across varied river games", () => {
  for (const request of requests) {
    const { game } = prepareConfigurableRiver(request);
    const options = { iterations: 37, checkpointIterations: [1, 7, 37] } as const;
    const readable = solveCfr(game, options);
    const compact = solveCompactCfr(game, options);
    assert.deepEqual(compact.index, readable.index, request.id);
    assert.deepEqual(compact.currentStrategy, readable.currentStrategy, request.id);
    assert.deepEqual(compact.averageStrategy, readable.averageStrategy, request.id);
    assert.deepEqual(compact.cumulativeRegrets, readable.cumulativeRegrets, request.id);
    assert.deepEqual(
      compact.checkpoints.map(checkpoint => checkpoint.averageStrategy),
      readable.checkpoints.map(checkpoint => checkpoint.averageStrategy),
      request.id,
    );
  }
});

test("card order changes do not change compact ordinary-CFR output", () => {
  const original = requests[0];
  const reversedBoard = [...original.board].reverse() as [
    RiverCard,
    RiverCard,
    RiverCard,
    RiverCard,
    RiverCard,
  ];
  const reordered: ConfigurableRiverRequest = {
    ...original,
    id: "compact-differential-weighted-reordered",
    board: reversedBoard,
    rangeText: ["8d8s TcAc QhAs:50%", "6h6c ThKh:25% JdAd"],
  };
  const first = prepareConfigurableRiver(original).game;
  const second = prepareConfigurableRiver(reordered).game;
  const firstResult = solveCompactCfr(first, { iterations: 53 });
  const secondResult = solveCompactCfr(second, { iterations: 53 });

  const stripScenario = (key: string): string => key.slice(key.indexOf(":p"));
  const normalized = (strategy: typeof firstResult.averageStrategy) => [...strategy]
    .map(([key, value]) => [stripScenario(key), value] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(normalized(secondResult.averageStrategy), normalized(firstResult.averageStrategy));
});
