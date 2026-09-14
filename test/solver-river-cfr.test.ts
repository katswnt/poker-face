import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exhaustiveBestResponse,
  gradeStrategy,
  informationSetBestResponse,
} from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import {
  buildGameTreeIndex,
  uniformStrategy,
  validateStrategy,
  type BehavioralStrategy,
  type SolverPlayer,
} from "../src/lib/solver/toy/game";
import { parseRiverCombo } from "../src/lib/solver/river/cards";
import { RIVER_V1_SCENARIO, riverV1Game } from "../src/lib/solver/river/fixture";
import {
  createRiverGame,
  type RiverAction,
  type RiverGame,
  type RiverState,
} from "../src/lib/solver/river/game";

const TOLERANCE = 1e-10;

function reducedRiverGame(): RiverGame {
  return createRiverGame({
    ...RIVER_V1_SCENARIO,
    id: "river-reduced-check",
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

function fullStateCheatingValue(
  game: RiverGame,
  strategy: BehavioralStrategy<RiverAction>,
  player: SolverPlayer,
  state: RiverState = game.initialState(),
): number {
  const node = game.node(state);
  if (node.kind === "terminal") return node.utility[player];
  if (node.kind === "chance") {
    return node.outcomes.reduce(
      (sum, { outcome, probability }) => sum + probability * fullStateCheatingValue(
        game,
        strategy,
        player,
        game.nextChance(state, outcome),
      ),
      0,
    );
  }
  const childValues = node.actions.map(action =>
    fullStateCheatingValue(game, strategy, player, game.nextAction(state, action))
  );
  if (node.player === player) return Math.max(...childValues);
  const key = game.informationSet(state, node.player);
  const entry = strategy.get(key);
  if (!entry) throw new Error(`Missing river strategy at ${key}`);
  return childValues.reduce(
    (sum, childValue, index) => sum + entry.probabilities[index] * childValue,
    0,
  );
}

test("generic CFR and the information-set scorekeeper run on the river game", () => {
  const result = solveCfr(riverV1Game, {
    iterations: 25,
    checkpointIterations: [1, 25],
  });
  assert.equal(result.gameId, "river-holdem-v1");
  assert.equal(result.index.informationSets.length, 64);
  validateStrategy(result.index, result.averageStrategy);

  const grade = gradeStrategy(riverV1Game, result.averageStrategy, result.index);
  assert.ok(grade.value.every(Number.isFinite));
  assert.ok(Math.abs(grade.value[0] + grade.value[1]) < TOLERANCE);
  assert.ok(grade.gains.every(gain => gain >= 0));
  assert.equal(grade.exploitability, grade.nashGap / 2);
  assert.equal(grade.bestResponses[0].informationSetsOptimized, 32);
  assert.equal(grade.bestResponses[1].informationSetsOptimized, 32);
});

test("a short river solve is byte-for-byte reproducible", () => {
  const first = solveCfr(riverV1Game, { iterations: 12 });
  const second = solveCfr(riverV1Game, { iterations: 12 });
  assert.deepEqual([...first.averageStrategy], [...second.averageStrategy]);
  assert.deepEqual([...first.cumulativeRegrets], [...second.cumulativeRegrets]);
});

test("the scalable river best response matches exhaustive pure-strategy grading", () => {
  const game = reducedRiverGame();
  const index = buildGameTreeIndex(game);
  const strategy = solveCfr(game, { iterations: 19 }).averageStrategy;
  for (const player of [0, 1] as const) {
    const scalable = informationSetBestResponse(game, strategy, player, index);
    const exhaustive = exhaustiveBestResponse(game, strategy, player, index, {
      maxPureStrategies: 2_000,
    });
    assert.ok(
      Math.abs(scalable.value - exhaustive.value) <= TOLERANCE,
      `player ${player}: scalable ${scalable.value}, exhaustive ${exhaustive.value}`,
    );
    assert.equal(exhaustive.pureStrategiesChecked, 1_296);
  }
});

test("the real river scorekeeper refuses the advantage of seeing hidden cards", () => {
  const game = reducedRiverGame();
  const index = buildGameTreeIndex(game);
  const strategy = uniformStrategy(index);
  let strictCheatingAdvantage = false;
  for (const player of [0, 1] as const) {
    const real = informationSetBestResponse(game, strategy, player, index);
    const cheating = fullStateCheatingValue(game, strategy, player);
    assert.ok(cheating >= real.value - TOLERANCE);
    if (cheating > real.value + TOLERANCE) strictCheatingAdvantage = true;
    assert.equal(real.choices.size, 8);
  }
  assert.equal(strictCheatingAdvantage, true, "fixture must expose a hidden-card cheating gain");
});
