import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  exhaustiveBestResponse,
  gradeStrategy,
  informationSetBestResponse,
} from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import {
  uniformStrategy,
  type BehavioralStrategy,
  type SolverPlayer,
} from "../src/lib/solver/toy/game";
import { parseRiverCombo } from "../src/lib/solver/river/cards";
import {
  compileCompactGame,
  solveCompactCfr,
} from "../src/lib/solver/river/compact/cfr";
import {
  compileCompactScorekeeper,
  gradeCompactStrategy,
} from "../src/lib/solver/river/compact/scorekeeper";
import {
  createConfigurableRiverGame,
  type ConfigurableRiverAction,
  type ConfigurableRiverGame,
  type ConfigurableRiverState,
} from "../src/lib/solver/river/configurable/game";
import {
  CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO,
  configurableRiverV2DemoGame,
} from "../src/lib/solver/river/configurable/fixture";
import { prepareConfigurableRiver } from "../src/lib/solver/river/configurable/solve";
import {
  solveCompiledFactorizedRiverCfr,
} from "../src/lib/solver/river/factorized/cfr";
import { FACTORIZED_RIVER_WIDE_REQUEST } from "../src/lib/solver/river/factorized/fixture";
import {
  compileFactorizedRiverGame,
} from "../src/lib/solver/river/factorized/game";
import {
  compileFactorizedRiverScorekeeper,
  evaluateFactorizedRiverStrategy,
  factorizedRiverInformationSetBestResponse,
  gradeFactorizedRiverStrategy,
} from "../src/lib/solver/river/factorized/scorekeeper";
import {
  FACTORIZED_CONFIGURABLE_RIVER_LIMITS,
  solveFactorizedConfigurableRiver,
} from "../src/lib/solver/river/factorized/solve";

const TOLERANCE = 1e-10;

function reducedRiverGame(): ConfigurableRiverGame {
  return createConfigurableRiverGame({
    ...CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO,
    id: "factorized-scorekeeper-reduced",
    ranges: [
      [
        { cards: parseRiverCombo("AsQs"), weight: 1 },
        { cards: parseRiverCombo("KhQh"), weight: 1 },
      ],
      [
        { cards: parseRiverCombo("Ts7s"), weight: 1 },
        { cards: parseRiverCombo("KdQd"), weight: 1 },
      ],
    ],
  });
}

function deterministicStrategy(
  index: ReturnType<typeof compileFactorizedRiverGame>["index"],
  seed: number,
): BehavioralStrategy<ConfigurableRiverAction> {
  return new Map(index.informationSets.map((definition, informationSet) => {
    const weights = definition.actions.map((_, action) =>
      1 + ((seed * 17 + informationSet * 11 + action * 7) % 29));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return [definition.key, {
      actions: [...definition.actions],
      probabilities: weights.map(weight => weight / total),
    }] as const;
  }));
}

function maximumDifference(left: number, right: number): number {
  return Math.abs(left - right);
}

function assertStrategiesNear(
  left: BehavioralStrategy<ConfigurableRiverAction>,
  right: BehavioralStrategy<ConfigurableRiverAction>,
): void {
  assert.deepEqual([...right.keys()], [...left.keys()]);
  for (const [key, leftEntry] of left) {
    const rightEntry = right.get(key);
    assert.ok(rightEntry);
    assert.deepEqual(rightEntry.actions, leftEntry.actions);
    leftEntry.probabilities.forEach((probability, action) => {
      assert.ok(maximumDifference(probability, rightEntry.probabilities[action]) <= TOLERANCE);
    });
  }
}

function assertRegretsNear(
  left: ReadonlyMap<string, readonly number[]>,
  right: ReadonlyMap<string, readonly number[]>,
): void {
  assert.deepEqual([...right.keys()], [...left.keys()]);
  for (const [key, values] of left) {
    const other = right.get(key);
    assert.ok(other);
    values.forEach((value, action) => {
      assert.ok(maximumDifference(value, other[action]) <= TOLERANCE);
    });
  }
}

function orderedChoices(choices: ReadonlyMap<string, ConfigurableRiverAction>) {
  return [...choices].sort(([left], [right]) => left.localeCompare(right));
}

function assertGradesNear(
  readable: ReturnType<typeof gradeStrategy<unknown, ConfigurableRiverAction, unknown>>,
  factorized: ReturnType<typeof gradeFactorizedRiverStrategy>,
): void {
  const numbers = [
    [readable.value[0], factorized.value[0]],
    [readable.value[1], factorized.value[1]],
    [readable.gains[0], factorized.gains[0]],
    [readable.gains[1], factorized.gains[1]],
    [readable.nashGap, factorized.nashGap],
    [readable.exploitability, factorized.exploitability],
    [readable.bestResponses[0].value, factorized.bestResponses[0].value],
    [readable.bestResponses[1].value, factorized.bestResponses[1].value],
  ];
  numbers.forEach(([left, right]) => assert.ok(maximumDifference(left, right) <= TOLERANCE));
  for (const player of [0, 1] as const) {
    assert.deepEqual(
      orderedChoices(factorized.bestResponses[player].choices),
      orderedChoices(readable.bestResponses[player].choices),
    );
  }
}

function cheatingValue(
  game: ConfigurableRiverGame,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
  player: SolverPlayer,
  state: ConfigurableRiverState = game.initialState(),
): number {
  const node = game.node(state);
  if (node.kind === "terminal") return node.utility[player];
  if (node.kind === "chance") {
    return node.outcomes.reduce((sum, child) => sum + child.probability * cheatingValue(
      game,
      strategy,
      player,
      game.nextChance(state, child.outcome),
    ), 0);
  }
  const children = node.actions.map(action => cheatingValue(
    game,
    strategy,
    player,
    game.nextAction(state, action),
  ));
  if (node.player === player) return Math.max(...children);
  const entry = strategy.get(game.informationSet(state, node.player));
  if (!entry) throw new Error("Missing strategy in factorized cheating regression");
  return children.reduce(
    (sum, value, action) => sum + value * entry.probabilities[action],
    0,
  );
}

test("factorized compilation exactly preserves the readable game index", () => {
  const factorized = compileFactorizedRiverGame(configurableRiverV2DemoGame);
  const repeated = compileCompactGame(configurableRiverV2DemoGame);
  assert.deepEqual(factorized.index, repeated.index);
  assert.equal(factorized.publicNodeCount, 21);
  assert.equal(factorized.dealProbabilities.length, configurableRiverV2DemoGame.deals.length);
  assert.equal(factorized.equivalentRepeatedStates, 3_697);
  assert.ok(Math.abs(
    factorized.dealProbabilities.reduce((sum, probability) => sum + probability, 0) - 1,
  ) <= 1e-12);
  assert.ok(factorized.typedStorageBytes < repeated.storageBytes);
});

test("factorized ordinary CFR matches readable and repeated compact CFR", () => {
  const options = { iterations: 400, checkpointIterations: [1, 17, 400] } as const;
  const readable = solveCfr(configurableRiverV2DemoGame, options);
  const repeated = solveCompactCfr(configurableRiverV2DemoGame, options);
  const factorized = solveCompiledFactorizedRiverCfr(
    compileFactorizedRiverGame(configurableRiverV2DemoGame),
    options,
  );
  assertStrategiesNear(readable.currentStrategy, factorized.currentStrategy);
  assertStrategiesNear(readable.averageStrategy, factorized.averageStrategy);
  assertRegretsNear(readable.cumulativeRegrets, factorized.cumulativeRegrets);
  assertStrategiesNear(repeated.currentStrategy, factorized.currentStrategy);
  factorized.checkpoints.forEach((checkpoint, index) => {
    assertStrategiesNear(readable.checkpoints[index].averageStrategy, checkpoint.averageStrategy);
  });
});

test("factorized value and legal best responses match both independent scorekeepers", () => {
  const compiled = compileFactorizedRiverGame(configurableRiverV2DemoGame);
  const scorekeeper = compileFactorizedRiverScorekeeper(compiled);
  const repeated = compileCompactGame(configurableRiverV2DemoGame);
  for (let seed = 1; seed <= 20; seed += 1) {
    const strategy = deterministicStrategy(compiled.index, seed);
    const readable = gradeStrategy(configurableRiverV2DemoGame, strategy, repeated.index);
    const compact = gradeCompactStrategy(compileCompactScorekeeper(repeated), strategy);
    const factorized = gradeFactorizedRiverStrategy(scorekeeper, strategy);
    assertGradesNear(readable, factorized);
    assert.deepEqual(factorized.value, evaluateFactorizedRiverStrategy(scorekeeper, strategy));
    assert.ok(maximumDifference(compact.exploitability, factorized.exploitability) <= TOLERANCE);
  }
});

test("factorized grading agrees with the readable checker across generated mixed profiles", () => {
  const compiled = compileFactorizedRiverGame(configurableRiverV2DemoGame);
  const scorekeeper = compileFactorizedRiverScorekeeper(compiled);
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 1_000_000 }),
    seed => {
      const strategy = deterministicStrategy(compiled.index, seed);
      assertGradesNear(
        gradeStrategy(configurableRiverV2DemoGame, strategy, compiled.index),
        gradeFactorizedRiverStrategy(scorekeeper, strategy),
      );
    },
  ), { numRuns: 40 });
});

test("factorized responses match exhaustive pure strategies on a reduced river", () => {
  const game = reducedRiverGame();
  const compiled = compileFactorizedRiverGame(game);
  const scorekeeper = compileFactorizedRiverScorekeeper(compiled);
  const strategy = uniformStrategy(compiled.index);
  for (const player of [0, 1] as const) {
    const factorized = factorizedRiverInformationSetBestResponse(scorekeeper, strategy, player);
    const readable = informationSetBestResponse(game, strategy, player, compiled.index);
    const exhaustive = exhaustiveBestResponse(game, strategy, player, compiled.index, {
      maxPureStrategies: 2_000,
    });
    assert.ok(maximumDifference(factorized.value, exhaustive.value) <= TOLERANCE);
    assert.ok(maximumDifference(factorized.value, readable.value) <= TOLERANCE);
    assert.deepEqual(orderedChoices(factorized.choices), orderedChoices(readable.choices));
  }
});

test("factorized best response cannot condition separately on hidden opponent hands", () => {
  const game = reducedRiverGame();
  const compiled = compileFactorizedRiverGame(game);
  const scorekeeper = compileFactorizedRiverScorekeeper(compiled);
  const strategy = uniformStrategy(compiled.index);
  let strictCheatingAdvantage = false;
  for (const player of [0, 1] as const) {
    const legal = factorizedRiverInformationSetBestResponse(scorekeeper, strategy, player);
    const cheating = cheatingValue(game, strategy, player);
    assert.ok(cheating + TOLERANCE >= legal.value);
    if (cheating > legal.value + TOLERANCE) strictCheatingAdvantage = true;
  }
  assert.equal(strictCheatingAdvantage, true);
});

test("factorized CFR+ is deterministic, finite, and improves its independently measured result", () => {
  const compiled = compileFactorizedRiverGame(configurableRiverV2DemoGame);
  const scorekeeper = compileFactorizedRiverScorekeeper(compiled);
  const short = solveCompiledFactorizedRiverCfr(compiled, {
    iterations: 25,
    algorithm: "cfr-plus",
  });
  const input = {
    iterations: 400,
    algorithm: "cfr-plus",
    averagingDelay: 20,
    checkpointIterations: [20, 400],
  } as const;
  const first = solveCompiledFactorizedRiverCfr(compiled, input);
  const second = solveCompiledFactorizedRiverCfr(compiled, input);
  assert.deepEqual(second.currentStrategy, first.currentStrategy);
  assert.deepEqual(second.averageStrategy, first.averageStrategy);
  assert.deepEqual(second.cumulativeRegrets, first.cumulativeRegrets);
  for (const regrets of first.cumulativeRegrets.values()) {
    regrets.forEach(regret => assert.ok(Number.isFinite(regret) && regret >= 0));
  }
  const shortGrade = gradeFactorizedRiverStrategy(scorekeeper, short.averageStrategy);
  const longerGrade = gradeFactorizedRiverStrategy(scorekeeper, first.averageStrategy);
  assert.ok(longerGrade.exploitability < shortGrade.exploitability);
  assert.ok(longerGrade.exploitability < 0.25);
});

test("factorized entry point admits and grades a locked game above 50,000 repeated states", () => {
  assert.throws(
    () => prepareConfigurableRiver(FACTORIZED_RIVER_WIDE_REQUEST, {
      maxCompatibleDeals: 2_000,
      maxProjectedStates: 50_000,
    }),
    /compatible deals; exact limit is 2000/,
  );
  const solved = solveFactorizedConfigurableRiver(FACTORIZED_RIVER_WIDE_REQUEST, {
    iterations: 400,
    algorithm: "cfr-plus",
    averagingDelay: 20,
    includeDecisionFacts: false,
  });
  assert.deepEqual(solved.game.preflight.limits, FACTORIZED_CONFIGURABLE_RIVER_LIMITS);
  assert.equal(solved.game.preflight.compatibleDeals, 5_052);
  assert.equal(solved.game.preflight.projectedFullStates, 106_093);
  assert.equal(solved.result.compiled.publicNodeCount, 21);
  assert.ok(solved.result.compiled.typedStorageBytes < 250_000);
  assert.ok(solved.grade.exploitability < 0.25);
  assert.equal(solved.decisions, null);
});

test("factorized limits and ambiguous options fail closed", () => {
  assert.throws(
    () => prepareConfigurableRiver(FACTORIZED_RIVER_WIDE_REQUEST, {
      ...FACTORIZED_CONFIGURABLE_RIVER_LIMITS,
      maxCompatibleDeals: 5_000,
    }),
    /5052 compatible deals; exact limit is 5000/,
  );
  const compiled = compileFactorizedRiverGame(configurableRiverV2DemoGame);
  assert.throws(
    () => solveCompiledFactorizedRiverCfr(compiled, {
      iterations: 1,
      algorithm: "vanilla",
      averagingDelay: 1,
    }),
    /does not use an averaging delay/,
  );
  assert.throws(
    () => solveCompiledFactorizedRiverCfr(compiled, { iterations: 0 }),
    /positive safe integer/,
  );
});
