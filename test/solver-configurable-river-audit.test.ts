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
  type BehavioralStrategy,
  type SolverPlayer,
} from "../src/lib/solver/toy/game";
import { parseRiverCombo } from "../src/lib/solver/river/cards";
import { configurableRiverDecisionFacts } from "../src/lib/solver/river/configurable/explain";
import {
  createConfigurableRiverGame,
  type ConfigurableRiverAction,
  type ConfigurableRiverGame,
  type ConfigurableRiverState,
} from "../src/lib/solver/river/configurable/game";
import {
  CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO,
  configurableRiverV1AdapterGame,
} from "../src/lib/solver/river/configurable/fixture";
import { auditConfigurableRiverRules } from "../src/lib/solver/river/configurable/oracle";
import { RIVER_V1_SCENARIO, riverV1Game } from "../src/lib/solver/river/fixture";
import { RIVER_TERMINAL_HISTORIES } from "../src/lib/solver/river/oracle";

const TOLERANCE = 1e-10;

const ACTION_MAP = {
  check: "check",
  "bet-half": "bet-to-50",
  "bet-pot": "bet-to-100",
  fold: "fold",
  call: "call",
  "raise-all-in": "raise-to-100",
} as const satisfies Record<string, ConfigurableRiverAction>;

function reducedGame(): ConfigurableRiverGame {
  return createConfigurableRiverGame({
    ...CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO,
    id: "configurable-river-reduced",
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
  const childValues = node.actions.map(action =>
    cheatingValue(game, strategy, player, game.nextAction(state, action)));
  if (node.player === player) return Math.max(...childValues);
  const entry = strategy.get(game.informationSet(state, node.player));
  if (!entry) throw new Error("Missing strategy in cheating audit");
  return childValues.reduce((sum, value, index) => sum + value * entry.probabilities[index], 0);
}

test("the independent configurable-river oracle checks every v1-adapter terminal", () => {
  assert.deepEqual(auditConfigurableRiverRules(configurableRiverV1AdapterGame), {
    dealsChecked: 61,
    publicTerminals: 13,
    terminalsChecked: 793,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("the configurable adapter preserves every v1 chance edge and terminal utility", () => {
  assert.equal(configurableRiverV1AdapterGame.deals.length, riverV1Game.deals.length);
  const nextDeals = new Map(configurableRiverV1AdapterGame.deals.map(deal => [
    deal.outcome.hands.map(cards => cards.join("")).join("|"),
    deal,
  ]));
  for (const oldDeal of riverV1Game.deals) {
    const key = oldDeal.outcome.hands.map(cards => cards.join("")).join("|");
    const nextDeal = nextDeals.get(key);
    assert.ok(nextDeal);
    assert.equal(nextDeal.probability, oldDeal.probability);
    for (const oldHistory of RIVER_TERMINAL_HISTORIES) {
      const nextHistory = oldHistory.map(action => ACTION_MAP[action]);
      let oldState = riverV1Game.nextChance(riverV1Game.initialState(), oldDeal.outcome);
      for (const action of oldHistory) oldState = riverV1Game.nextAction(oldState, action);
      let nextState = configurableRiverV1AdapterGame.nextChance(
        configurableRiverV1AdapterGame.initialState(),
        nextDeal.outcome,
      );
      for (const action of nextHistory) {
        nextState = configurableRiverV1AdapterGame.nextAction(nextState, action);
      }
      const oldNode = riverV1Game.node(oldState);
      const nextNode = configurableRiverV1AdapterGame.node(nextState);
      assert.equal(oldNode.kind, "terminal");
      assert.equal(nextNode.kind, "terminal");
      if (oldNode.kind !== "terminal" || nextNode.kind !== "terminal") throw new Error("Expected terminals");
      assert.deepEqual(nextNode.utility, oldNode.utility);
    }
  }
});

test("v2 and v1 produce the same profile value and grade with equal solver settings", () => {
  const oldResult = solveCfr(riverV1Game, { iterations: 400 });
  const nextResult = solveCfr(configurableRiverV1AdapterGame, { iterations: 400 });
  const oldGrade = gradeStrategy(riverV1Game, oldResult.averageStrategy, oldResult.index);
  const nextGrade = gradeStrategy(
    configurableRiverV1AdapterGame,
    nextResult.averageStrategy,
    nextResult.index,
  );
  assert.ok(Math.abs(oldGrade.value[0] - nextGrade.value[0]) < TOLERANCE);
  assert.ok(Math.abs(oldGrade.exploitability - nextGrade.exploitability) < TOLERANCE);
  assert.ok(Math.abs(nextGrade.gains[0] - oldGrade.gains[0]) < TOLERANCE);
  assert.ok(Math.abs(nextGrade.gains[1] - oldGrade.gains[1]) < TOLERANCE);
});

test("the scalable v2 best response matches exhaustive hidden-information grading", () => {
  const game = reducedGame();
  const index = buildGameTreeIndex(game);
  const strategy = solveCfr(game, { iterations: 19 }).averageStrategy;
  for (const player of [0, 1] as const) {
    const scalable = informationSetBestResponse(game, strategy, player, index);
    const exhaustive = exhaustiveBestResponse(game, strategy, player, index, {
      maxPureStrategies: 2_000,
    });
    assert.ok(Math.abs(scalable.value - exhaustive.value) < TOLERANCE);
    assert.equal(exhaustive.pureStrategiesChecked, 1_296);
  }
});

test("the v2 checker refuses to choose separately for hidden opponent hands", () => {
  const game = reducedGame();
  const strategy = uniformStrategy(buildGameTreeIndex(game));
  let strictAdvantage = false;
  for (const player of [0, 1] as const) {
    const real = informationSetBestResponse(game, strategy, player);
    const cheating = cheatingValue(game, strategy, player);
    assert.ok(cheating >= real.value - TOLERANCE);
    if (cheating > real.value + TOLERANCE) strictAdvantage = true;
  }
  assert.equal(strictAdvantage, true);
});

test("structured v2 teaching facts normalize ranges, actions, responses, and outcomes", () => {
  const result = solveCfr(configurableRiverV1AdapterGame, { iterations: 100 });
  const facts = configurableRiverDecisionFacts(
    configurableRiverV1AdapterGame,
    result.averageStrategy,
  );
  assert.equal(facts.length, 64);
  for (const fact of facts) {
    const strategy = result.averageStrategy.get(fact.informationSet);
    assert.ok(strategy);
    assert.ok(Math.abs(fact.actions.reduce((sum, action) => sum + action.frequency, 0) - 1) < 1e-10);
    if (!fact.offPath) {
      assert.ok(Math.abs(fact.opponentRange.reduce(
        (sum, item) => sum + (item.probability ?? 0),
        0,
      ) - 1) < 1e-10);
    }
    for (const action of fact.actions) {
      if (action.expectedValue === null) continue;
      const outcomeTotal = Object.values(action.outcomes).reduce(
        (sum, value) => sum + (value ?? 0),
        0,
      );
      assert.ok(Math.abs(outcomeTotal - 1) < 1e-10);
      const responseTotal = action.immediateOpponentResponses.reduce(
        (sum, response) => sum + response.probability,
        0,
      );
      assert.ok(responseTotal === 0 || Math.abs(responseTotal - 1) < 1e-10);
      assert.equal(
        action.expectedAdditionalValue,
        action.expectedValue + fact.contributions[fact.player],
      );
    }
  }
});

test("v2 scenario input remains isolated from the accepted v1 scenario", () => {
  assert.equal(RIVER_V1_SCENARIO.version, 1);
  assert.equal(CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO.version, 2);
  assert.notEqual(configurableRiverV1AdapterGame.id, riverV1Game.id);
});
