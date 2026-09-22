import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exhaustiveBestResponse,
  gradeStrategy,
  informationSetBestResponse,
} from "../src/lib/solver/toy/best-response";
import {
  uniformStrategy,
  type BehavioralStrategy,
  type SolverPlayer,
} from "../src/lib/solver/toy/game";
import { kuhnGame } from "../src/lib/solver/toy/kuhn";
import { parseRiverCombo } from "../src/lib/solver/river/cards";
import {
  compileCompactGame,
  solveCompactCfr,
} from "../src/lib/solver/river/compact/cfr";
import {
  compactInformationSetBestResponse,
  compileCompactScorekeeper,
  evaluateCompactStrategy,
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

function reducedRiverGame(): ConfigurableRiverGame {
  return createConfigurableRiverGame({
    ...CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO,
    id: "compact-scorekeeper-reduced",
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
  seed: number,
): BehavioralStrategy<ConfigurableRiverAction> {
  const index = compileCompactGame(configurableRiverV2DemoGame).index;
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

function assertSameGrade<Action extends string>(
  readable: ReturnType<typeof gradeStrategy<unknown, Action, unknown>>,
  compact: ReturnType<typeof gradeCompactStrategy<Action>>,
): void {
  const orderedChoices = (choices: ReadonlyMap<string, Action>) => [...choices]
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(compact.value, readable.value);
  assert.deepEqual(compact.gains, readable.gains);
  assert.equal(compact.nashGap, readable.nashGap);
  assert.equal(compact.exploitability, readable.exploitability);
  for (const player of [0, 1] as const) {
    assert.equal(compact.bestResponses[player].value, readable.bestResponses[player].value);
    assert.deepEqual(
      orderedChoices(compact.bestResponses[player].choices),
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
  if (!entry) throw new Error("Missing strategy in compact cheating regression");
  return children.reduce(
    (sum, value, action) => sum + value * entry.probabilities[action],
    0,
  );
}

test("compact scorekeeper indexes every decision state exactly once", () => {
  const compiled = compileCompactGame(configurableRiverV2DemoGame);
  const scorekeeper = compileCompactScorekeeper(compiled);
  assert.equal(scorekeeper.informationSetNodes.length, compiled.index.decisionNodes);
  assert.equal(
    scorekeeper.informationSetNodeCounts.reduce((sum, count) => sum + count, 0),
    compiled.index.decisionNodes,
  );
  compiled.index.informationSets.forEach((definition, informationSet) => {
    assert.equal(scorekeeper.informationSetNodeCounts[informationSet], definition.stateCount);
  });
});

test("compact value and best responses exactly match the readable scorekeeper", () => {
  const solved = solveCompactCfr(configurableRiverV2DemoGame, {
    iterations: 137,
    algorithm: "cfr-plus",
  });
  const scorekeeper = compileCompactScorekeeper(solved.compiled);
  const readable = gradeStrategy(
    configurableRiverV2DemoGame,
    solved.averageStrategy,
    solved.index,
  );
  const compact = gradeCompactStrategy(scorekeeper, solved.averageStrategy);
  assert.deepEqual(
    evaluateCompactStrategy(scorekeeper, solved.averageStrategy),
    readable.value,
  );
  assertSameGrade(readable, compact);
});

test("compact grading matches across varied deterministic mixed profiles", () => {
  const compiled = compileCompactGame(configurableRiverV2DemoGame);
  const scorekeeper = compileCompactScorekeeper(compiled);
  for (let seed = 1; seed <= 20; seed += 1) {
    const strategy = deterministicStrategy(seed);
    assertSameGrade(
      gradeStrategy(configurableRiverV2DemoGame, strategy, compiled.index),
      gradeCompactStrategy(scorekeeper, strategy),
    );
  }
});

test("compact responses match exhaustive pure strategies on a reduced river game", () => {
  const game = reducedRiverGame();
  const compiled = compileCompactGame(game);
  const scorekeeper = compileCompactScorekeeper(compiled);
  const strategy = uniformStrategy(compiled.index);
  for (const player of [0, 1] as const) {
    const compact = compactInformationSetBestResponse(scorekeeper, strategy, player);
    const readable = informationSetBestResponse(game, strategy, player, compiled.index);
    const exhaustive = exhaustiveBestResponse(game, strategy, player, compiled.index, {
      maxPureStrategies: 2_000,
    });
    assert.equal(compact.value, readable.value);
    assert.equal(compact.value, exhaustive.value);
    const ordered = (choices: ReadonlyMap<string, ConfigurableRiverAction>) => [...choices]
      .sort(([left], [right]) => left.localeCompare(right));
    assert.deepEqual(ordered(compact.choices), ordered(readable.choices));
  }
});

test("compact grading recovers Kuhn's independently checked information-set response", () => {
  const compiled = compileCompactGame(kuhnGame);
  const scorekeeper = compileCompactScorekeeper(compiled);
  const solved = solveCompactCfr(kuhnGame, { iterations: 1_000, algorithm: "cfr-plus" });
  assertSameGrade(
    gradeStrategy(kuhnGame, solved.averageStrategy, compiled.index),
    gradeCompactStrategy(scorekeeper, solved.averageStrategy),
  );
});

test("compact best response never receives the cheating hidden-state advantage", () => {
  const game = reducedRiverGame();
  const compiled = compileCompactGame(game);
  const scorekeeper = compileCompactScorekeeper(compiled);
  const strategy = uniformStrategy(compiled.index);
  let strictAdvantage = false;
  for (const player of [0, 1] as const) {
    const compact = compactInformationSetBestResponse(scorekeeper, strategy, player);
    const cheating = cheatingValue(game, strategy, player);
    assert.ok(cheating >= compact.value);
    if (cheating > compact.value) strictAdvantage = true;
  }
  assert.equal(strictAdvantage, true);
});

test("compact grading rejects invalid strategies and is deterministic", () => {
  const compiled = compileCompactGame(configurableRiverV2DemoGame);
  const scorekeeper = compileCompactScorekeeper(compiled);
  const strategy = deterministicStrategy(71);
  const first = gradeCompactStrategy(scorekeeper, strategy);
  const second = gradeCompactStrategy(scorekeeper, strategy);
  assert.deepEqual(second, first);

  const missing = new Map(strategy);
  missing.delete(compiled.index.informationSets[0].key);
  assert.throws(() => gradeCompactStrategy(scorekeeper, missing), /strategy has 111 information sets/);

  const malformed = new Map(strategy);
  const definition = compiled.index.informationSets[0];
  malformed.set(definition.key, {
    actions: [...definition.actions],
    probabilities: definition.actions.map((_, action) => action === 0 ? Number.NaN : 0),
  });
  assert.throws(() => gradeCompactStrategy(scorekeeper, malformed), /must be finite/);
});
