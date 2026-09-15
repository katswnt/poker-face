import assert from "node:assert/strict";
import test from "node:test";
import riverArtifactData from "../src/lib/solver/river/artifacts/river-v1.json" with { type: "json" };
import { deserializeRiverStrategy, type RiverSolveArtifact } from "../src/lib/solver/river/artifact";
import { verifyRiverArtifactHash } from "../src/lib/solver/river/artifact-node";
import { riverV1Game } from "../src/lib/solver/river/fixture";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import {
  evaluateMultiwayStrategy,
  exhaustiveMultiwayBestResponse,
  informationSetMultiwayBestResponse,
} from "../src/lib/solver/multiway/best-response";
import { solveMultiwayCfr } from "../src/lib/solver/multiway/cfr";
import {
  adaptHeadsUpGame,
  adaptHeadsUpStrategy,
  buildMultiwayGameTreeIndex,
  uniformMultiwayStrategy,
  type MultiwayBehavioralStrategy,
  type MultiwayExtensiveFormGame,
} from "../src/lib/solver/multiway/game";
import { MULTIWAY_RIVER_V1_SCENARIO, multiwayRiverV1Game } from "../src/lib/solver/multiway/fixture";
import { createMultiwayRiverGame, type MultiwayRiverScenario } from "../src/lib/solver/multiway/river-game";

function reducedRiverGame() {
  const scenario: MultiwayRiverScenario = {
    ...MULTIWAY_RIVER_V1_SCENARIO,
    id: "three-player-river-reduced-test",
    ranges: [
      [MULTIWAY_RIVER_V1_SCENARIO.ranges[0][2], MULTIWAY_RIVER_V1_SCENARIO.ranges[0][4]],
      MULTIWAY_RIVER_V1_SCENARIO.ranges[1].slice(0, 2),
      [MULTIWAY_RIVER_V1_SCENARIO.ranges[2][1], MULTIWAY_RIVER_V1_SCENARIO.ranges[2][2]],
    ],
  };
  return createMultiwayRiverGame(scenario);
}

function omniscientResponseValue<State, Action extends string, ChanceOutcome>(
  game: MultiwayExtensiveFormGame<State, Action, ChanceOutcome>,
  strategy: MultiwayBehavioralStrategy<Action>,
  respondingPlayer: number,
): number {
  const visit = (state: State): number => {
    const node = game.node(state);
    if (node.kind === "terminal") return node.utility[respondingPlayer];
    if (node.kind === "chance") {
      return node.outcomes.reduce(
        (sum, edge) => sum + edge.probability * visit(game.nextChance(state, edge.outcome)),
        0,
      );
    }
    const values = node.actions.map(action => visit(game.nextAction(state, action)));
    if (node.player === respondingPlayer) return Math.max(...values);
    const entry = strategy.get(game.informationSet(state, node.player));
    if (!entry) throw new Error("Missing strategy in cheating audit helper");
    return values.reduce((sum, value, actionIndex) =>
      sum + entry.probabilities[actionIndex] * value, 0);
  };
  return visit(game.initialState());
}

test("the scalable best response matches exhaustive pure strategies across reduced profiles", () => {
  const game = reducedRiverGame();
  const index = buildMultiwayGameTreeIndex(game);
  const uniform = uniformMultiwayStrategy(index);
  const hash = (value: string) => [...value].reduce((total, character) =>
    (total * 31 + character.charCodeAt(0)) >>> 0, 0);
  for (let profileIndex = 0; profileIndex < 8; profileIndex += 1) {
    const strategy = new Map([...uniform].map(([key, entry]) => {
      const first = ((hash(key) + profileIndex * 137) % 900 + 50) / 1_000;
      return [key, { actions: entry.actions, probabilities: [first, 1 - first] }] as const;
    }));
    for (let player = 0; player < 3; player += 1) {
      const scalable = informationSetMultiwayBestResponse(game, strategy, player, index);
      const exhaustive = exhaustiveMultiwayBestResponse(game, strategy, player, index);
      assert.ok(Math.abs(scalable.value - exhaustive.value) <= 1e-9);
      const decisionCount = index.informationSets.filter(definition => definition.player === player).length;
      assert.equal(exhaustive.pureStrategiesChecked, 2 ** decisionCount);
      assert.equal(exhaustive.pureStrategiesChecked, 256);
    }
  }
});

test("the real best response cannot condition on hidden opponent hands", () => {
  const index = buildMultiwayGameTreeIndex(multiwayRiverV1Game);
  const strategy = uniformMultiwayStrategy(index);
  const honest = informationSetMultiwayBestResponse(multiwayRiverV1Game, strategy, 0, index);
  const cheating = omniscientResponseValue(multiwayRiverV1Game, strategy, 0);
  assert.ok(cheating > honest.value + 0.01, `${cheating} should exceed ${honest.value}`);
});

test("the N-player adapter preserves the shipped heads-up river result", () => {
  const artifact = riverArtifactData as unknown as RiverSolveArtifact;
  assert.equal(verifyRiverArtifactHash(artifact), true);
  const headsUpStrategy = deserializeRiverStrategy(artifact.strategy);
  const headsUpGrade = gradeStrategy(riverV1Game, headsUpStrategy);
  const adaptedGame = adaptHeadsUpGame(riverV1Game);
  const adaptedStrategy = adaptHeadsUpStrategy(headsUpStrategy);
  const adaptedIndex = buildMultiwayGameTreeIndex(adaptedGame);
  const value = evaluateMultiwayStrategy(adaptedGame, adaptedStrategy, adaptedIndex);
  assert.deepEqual({
    states: adaptedIndex.totalStates,
    informationSets: adaptedIndex.informationSets.length,
  }, {
    states: artifact.tree.totalStates,
    informationSets: artifact.tree.informationSets,
  });
  assert.ok(Math.abs(value[0] - headsUpGrade.value[0]) <= 1e-12);
  assert.ok(Math.abs(value[1] - headsUpGrade.value[1]) <= 1e-12);
  for (let player = 0; player < 2; player += 1) {
    const response = informationSetMultiwayBestResponse(adaptedGame, adaptedStrategy, player, adaptedIndex);
    assert.ok(Math.abs(response.value - headsUpGrade.bestResponses[player].value) <= 1e-9);
  }
});

test("multiway CFR is deterministic and keeps utilities zero-sum", () => {
  const left = solveMultiwayCfr(multiwayRiverV1Game, { iterations: 256 });
  const right = solveMultiwayCfr(multiwayRiverV1Game, { iterations: 256 });
  assert.deepEqual([...left.averageStrategy], [...right.averageStrategy]);
  const value = evaluateMultiwayStrategy(multiwayRiverV1Game, left.averageStrategy, left.index);
  assert.ok(Math.abs(value.reduce((sum, playerValue) => sum + playerValue, 0)) <= 1e-9);
});
