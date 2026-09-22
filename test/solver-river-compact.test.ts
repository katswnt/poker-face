import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import type { ExtensiveFormGame } from "../src/lib/solver/toy/game";
import { kuhnGame } from "../src/lib/solver/toy/kuhn";
import {
  compileCompactGame,
  solveCompactCfr,
} from "../src/lib/solver/river/compact/cfr";
import { configurableRiverV2DemoGame } from "../src/lib/solver/river/configurable/fixture";
import { prepareConfigurableRiver } from "../src/lib/solver/river/configurable/solve";
import {
  COMPACT_CONFIGURABLE_RIVER_LIMITS,
  solveCompactConfigurableRiver,
} from "../src/lib/solver/river/compact/solve";
import { COMPACT_RIVER_WIDER_REQUEST } from "../src/lib/solver/river/compact/fixture";

test("compact compilation preserves the accepted river tree's public counts", () => {
  const compiled = compileCompactGame(configurableRiverV2DemoGame);
  assert.equal(compiled.index.totalStates, 3_697);
  assert.equal(compiled.index.decisionNodes, 1_408);
  assert.equal(compiled.index.terminalNodes, 2_288);
  assert.equal(compiled.index.informationSets.length, 112);
  assert.equal(compiled.edgeChildren.length, compiled.index.totalStates - 1);
  assert.equal(compiled.nodeEdgeCounts[0], configurableRiverV2DemoGame.deals.length);
  assert.deepEqual(
    Array.from(compiled.edgeChanceProbabilities.subarray(0, configurableRiverV2DemoGame.deals.length)),
    configurableRiverV2DemoGame.deals.map(deal => deal.probability),
  );
  assert.ok(compiled.storageBytes < configurableRiverV2DemoGame.preflight.roughTreeMemoryBytes);
});

test("compact ordinary CFR exactly matches the readable solver", () => {
  const options = { iterations: 400, checkpointIterations: [1, 17, 400] } as const;
  const readable = solveCfr(configurableRiverV2DemoGame, options);
  const compact = solveCompactCfr(configurableRiverV2DemoGame, options);
  assert.deepEqual(compact.currentStrategy, readable.currentStrategy);
  assert.deepEqual(compact.averageStrategy, readable.averageStrategy);
  assert.deepEqual(compact.cumulativeRegrets, readable.cumulativeRegrets);
  assert.deepEqual(
    compact.checkpoints.map(checkpoint => checkpoint.averageStrategy),
    readable.checkpoints.map(checkpoint => checkpoint.averageStrategy),
  );

  const readableGrade = gradeStrategy(
    configurableRiverV2DemoGame,
    readable.averageStrategy,
    readable.index,
  );
  const compactGrade = gradeStrategy(
    configurableRiverV2DemoGame,
    compact.averageStrategy,
    compact.index,
  );
  assert.deepEqual(compactGrade.value, readableGrade.value);
  assert.equal(compactGrade.exploitability, readableGrade.exploitability);
});

test("compact solving is deterministic", () => {
  const options = {
    iterations: 137,
    algorithm: "cfr-plus",
    averagingDelay: 20,
    checkpointIterations: [20, 137],
  } as const;
  const first = solveCompactCfr(configurableRiverV2DemoGame, options);
  const second = solveCompactCfr(configurableRiverV2DemoGame, options);
  assert.deepEqual(second.currentStrategy, first.currentStrategy);
  assert.deepEqual(second.averageStrategy, first.averageStrategy);
  assert.deepEqual(second.cumulativeRegrets, first.cumulativeRegrets);
  assert.deepEqual(second.checkpoints, first.checkpoints);
});

test("CFR+ keeps regrets non-negative and independently converges", () => {
  const short = solveCompactCfr(configurableRiverV2DemoGame, {
    iterations: 25,
    algorithm: "cfr-plus",
  });
  const longer = solveCompactCfr(configurableRiverV2DemoGame, {
    iterations: 400,
    algorithm: "cfr-plus",
    checkpointIterations: [100, 400],
  });
  for (const regrets of longer.cumulativeRegrets.values()) {
    regrets.forEach(regret => assert.ok(Number.isFinite(regret) && regret >= 0));
  }
  const shortGrade = gradeStrategy(
    configurableRiverV2DemoGame,
    short.averageStrategy,
    short.index,
  );
  const longerGrade = gradeStrategy(
    configurableRiverV2DemoGame,
    longer.averageStrategy,
    longer.index,
  );
  assert.ok(longerGrade.exploitability < shortGrade.exploitability);
  assert.ok(longerGrade.exploitability < 0.25);
  assert.equal(longer.fullTreeRegretPasses, 800);
  assert.equal(longer.reachOnlyPasses, 400);
});

test("compact CFR+ recovers Kuhn poker's known value", () => {
  const result = solveCompactCfr(kuhnGame, {
    iterations: 1_000,
    algorithm: "cfr-plus",
  });
  const grade = gradeStrategy(kuhnGame, result.averageStrategy, result.index);
  assert.ok(Math.abs(grade.value[0] + 1 / 18) < 1e-5);
  assert.ok(grade.exploitability < 0.0001);
});

test("the compact entry point safely admits a wider exact range game", () => {
  assert.throws(
    () => prepareConfigurableRiver(COMPACT_RIVER_WIDER_REQUEST),
    /750 compatible deals; exact limit is 500/,
  );
  const solved = solveCompactConfigurableRiver(COMPACT_RIVER_WIDER_REQUEST, {
    iterations: 400,
    algorithm: "cfr-plus",
    includeDecisionFacts: false,
  });
  assert.deepEqual(solved.game.preflight.limits, COMPACT_CONFIGURABLE_RIVER_LIMITS);
  assert.equal(solved.game.preflight.compatibleDeals, 750);
  assert.equal(solved.result.index.totalStates, 15_751);
  assert.ok(solved.grade.exploitability < 0.25);
  assert.equal(solved.decisions, null);
});

type ForgetfulState = "root" | "left" | "right" | "terminal";

const imperfectRecallGame: ExtensiveFormGame<ForgetfulState, "left" | "right" | "end", never> = {
  id: "imperfect-recall-regression",
  initialState: () => "root",
  node: state => state === "terminal"
    ? { kind: "terminal", utility: [0, 0] }
    : { kind: "player", player: 0, actions: state === "root" ? ["left", "right"] : ["end"] },
  nextChance: () => {
    throw new Error("No chance node");
  },
  nextAction: (state, action) => {
    if (state === "root") return action === "left" ? "left" : "right";
    return "terminal";
  },
  informationSet: state => state === "root" ? "root" : "forgot-own-action",
};

test("compact compilation rejects imperfect recall", () => {
  assert.throws(
    () => compileCompactGame(imperfectRecallGame),
    /violates perfect recall/,
  );
});

test("compact options reject ambiguous algorithm settings", () => {
  assert.throws(
    () => solveCompactCfr(configurableRiverV2DemoGame, {
      iterations: 1,
      algorithm: "vanilla",
      averagingDelay: 1,
    }),
    /does not use an averaging delay/,
  );
  assert.throws(
    () => solveCompactCfr(configurableRiverV2DemoGame, { iterations: 0 }),
    /positive safe integer/,
  );
});
