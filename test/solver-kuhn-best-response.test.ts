import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGameTreeIndex,
  uniformStrategy,
  type BehavioralStrategy,
  type ExtensiveFormGame,
  type SolverPlayer,
} from "../src/lib/solver/toy/game";
import {
  exhaustiveBestResponse,
  gradeStrategy,
  informationSetBestResponse,
} from "../src/lib/solver/toy/best-response";
import { kuhnGame, type KuhnAction, type KuhnState } from "../src/lib/solver/toy/kuhn";

const index = buildGameTreeIndex(kuhnGame);
const TOLERANCE = 1e-12;

function close(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= TOLERANCE,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function deterministicStrategy(seed: number): BehavioralStrategy<KuhnAction> {
  let state = seed >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };

  return new Map(index.informationSets.map(definition => {
    const firstProbability = random();
    return [definition.key, {
      actions: [...definition.actions],
      probabilities: [firstProbability, 1 - firstProbability],
    }] as const;
  }));
}

function fullStateCheatingValue(
  strategy: BehavioralStrategy<KuhnAction>,
  player: SolverPlayer,
  state: KuhnState = kuhnGame.initialState(),
): number {
  const node = kuhnGame.node(state);
  if (node.kind === "terminal") return node.utility[player];
  if (node.kind === "chance") {
    return node.outcomes.reduce(
      (sum, { outcome, probability }) =>
        sum + probability * fullStateCheatingValue(
          strategy,
          player,
          kuhnGame.nextChance(state, outcome),
        ),
      0,
    );
  }

  const childValues = node.actions.map(action =>
    fullStateCheatingValue(strategy, player, kuhnGame.nextAction(state, action))
  );
  if (node.player === player) return Math.max(...childValues);
  const informationSet = kuhnGame.informationSet(state, node.player);
  const entry = strategy.get(informationSet);
  if (!entry) throw new Error(`Missing strategy at ${informationSet}`);
  return childValues.reduce(
    (sum, childValue, actionIndex) => sum + entry.probabilities[actionIndex] * childValue,
    0,
  );
}

test("information-set best responses match exhaustive Kuhn grading", () => {
  for (let sample = 1; sample <= 100; sample += 1) {
    const strategy = deterministicStrategy(sample);
    const dynamicGrade = gradeStrategy(kuhnGame, strategy, index);
    const exhaustiveGrade = gradeStrategy(kuhnGame, strategy, index, {
      bestResponseMethod: "exhaustive",
    });

    for (const player of [0, 1] as const) {
      close(
        dynamicGrade.bestResponses[player].value,
        exhaustiveGrade.bestResponses[player].value,
        `sample ${sample}, player ${player} best response`,
      );
      close(
        dynamicGrade.gains[player],
        exhaustiveGrade.gains[player],
        `sample ${sample}, player ${player} gain`,
      );
    }
    close(dynamicGrade.nashGap, exhaustiveGrade.nashGap, `sample ${sample} Nash gap`);
    close(
      dynamicGrade.exploitability,
      exhaustiveGrade.exploitability,
      `sample ${sample} exploitability`,
    );
  }
});

test("the scalable grader chooses once per information set instead of seeing hidden cards", () => {
  const strategy = uniformStrategy(index);
  let foundStrictCheatingAdvantage = false;

  for (const player of [0, 1] as const) {
    const response = informationSetBestResponse(kuhnGame, strategy, player, index);
    const cheatingValue = fullStateCheatingValue(strategy, player);
    assert.ok(cheatingValue >= response.value - TOLERANCE);
    if (cheatingValue > response.value + TOLERANCE) foundStrictCheatingAdvantage = true;
    assert.equal(response.method, "information-set");
    assert.equal(response.informationSetsOptimized, 6);
    assert.equal(response.choices.size, 6);
    assert.equal(response.pureStrategiesChecked, null);
  }

  assert.equal(
    foundStrictCheatingAdvantage,
    true,
    "the test profile must expose the hidden-information cheating bug",
  );
});

test("the exhaustive Kuhn oracle remains available and independent", () => {
  const strategy = deterministicStrategy(20260903);
  for (const player of [0, 1] as const) {
    const response = exhaustiveBestResponse(kuhnGame, strategy, player, index);
    assert.equal(response.method, "exhaustive");
    assert.equal(response.informationSetsOptimized, 6);
    assert.equal(response.choices.size, 6);
    assert.equal(response.pureStrategiesChecked, 64);
  }
});

type ForgetfulAction = "left" | "right" | "up" | "down";
interface ForgetfulState {
  readonly history: readonly ForgetfulAction[];
}

const forgetfulGame: ExtensiveFormGame<ForgetfulState, ForgetfulAction, never> = {
  id: "forgetful-test-game",
  initialState: () => ({ history: [] }),
  node: state => {
    if (state.history.length === 0) {
      return { kind: "player", player: 0, actions: ["left", "right"] };
    }
    if (state.history.length === 1) {
      return { kind: "player", player: 0, actions: ["up", "down"] };
    }
    const matchingDirections =
      (state.history[0] === "left" && state.history[1] === "up") ||
      (state.history[0] === "right" && state.history[1] === "down");
    const player0 = matchingDirections ? 1 : -1;
    return { kind: "terminal", utility: [player0, -player0] };
  },
  nextChance: () => {
    throw new Error("This test game has no chance node");
  },
  nextAction: (state, action) => ({ history: [...state.history, action] }),
  informationSet: state => state.history.length === 0 ? "p0:first" : "p0:forgot-first-action",
};

test("the scalable grader rejects games where a player forgets an earlier choice", () => {
  const forgetfulIndex = buildGameTreeIndex(forgetfulGame);
  const strategy = uniformStrategy(forgetfulIndex);
  assert.throws(
    () => informationSetBestResponse(forgetfulGame, strategy, 0, forgetfulIndex),
    /violates perfect recall/,
  );
});

type LongGameAction = "stop" | "continue";
interface LongGameState {
  readonly stage: number;
  readonly stopped: boolean;
}

const longGame: ExtensiveFormGame<LongGameState, LongGameAction, never> = {
  id: "long-best-response-test-game",
  initialState: () => ({ stage: 0, stopped: false }),
  node: state => {
    if (state.stopped || state.stage === 21) {
      return { kind: "terminal", utility: [state.stage, -state.stage] };
    }
    return { kind: "player", player: 0, actions: ["stop", "continue"] };
  },
  nextChance: () => {
    throw new Error("This test game has no chance node");
  },
  nextAction: (state, action) => action === "stop"
    ? { stage: state.stage, stopped: true }
    : { stage: state.stage + 1, stopped: false },
  informationSet: state => `p0:stage:${state.stage}`,
};

test("the scalable grader handles a game whose pure-strategy search is over the limit", () => {
  const longIndex = buildGameTreeIndex(longGame);
  const strategy = uniformStrategy(longIndex);
  assert.equal(longIndex.informationSets.length, 21);
  assert.throws(
    () => exhaustiveBestResponse(longGame, strategy, 0, longIndex),
    /2097152 pure strategies/,
  );

  const response = informationSetBestResponse(longGame, strategy, 0, longIndex);
  assert.equal(response.value, 21);
  assert.equal(response.informationSetsOptimized, 21);
  assert.equal(response.choices.size, 21);
  assert.ok([...response.choices.values()].every(action => action === "continue"));
});
