import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import {
  type BehavioralStrategy,
  type GameTreeIndex,
  type SolverPlayer,
} from "../src/lib/solver/toy/game";
import { parseRiverCombo } from "../src/lib/solver/river/cards";
import {
  createConfigurableRiverGame,
  type ConfigurableRiverAction,
  type ConfigurableRiverState,
} from "../src/lib/solver/river/configurable/game";
import {
  CONFIGURABLE_RIVER_V2_DEMO_SCENARIO,
} from "../src/lib/solver/river/configurable/fixture";
import {
  CONFIGURABLE_RIVER_V3_DEMO_SCENARIO,
  configurableRiverV3DemoGame,
} from "../src/lib/solver/river/configurable-v3/fixture";
import {
  configurableRiverV3State,
  createConfigurableRiverV3Game,
  type ConfigurableRiverV3Game,
  type ConfigurableRiverV3Scenario,
  type ConfigurableRiverV3State,
} from "../src/lib/solver/river/configurable-v3/game";
import { auditConfigurableRiverV3Rules } from "../src/lib/solver/river/configurable-v3/oracle";
import {
  prepareConfigurableRiverV3,
  solveConfigurableRiverV3,
  type ConfigurableRiverV3Request,
} from "../src/lib/solver/river/configurable-v3/solve";
import { solveCompiledFactorizedRiverCfr } from "../src/lib/solver/river/factorized/cfr";
import { FACTORIZED_RIVER_WIDE_REQUEST } from "../src/lib/solver/river/factorized/fixture";
import { compileFactorizedRiverGame } from "../src/lib/solver/river/factorized/game";
import {
  compileFactorizedRiverScorekeeper,
  factorizedRiverInformationSetBestResponse,
  gradeFactorizedRiverStrategy,
} from "../src/lib/solver/river/factorized/scorekeeper";

const TOLERANCE = 1e-10;

function firstHands(game: ConfigurableRiverV3Game) {
  const hands = game.deals[0]?.outcome.hands;
  if (!hands) throw new Error("Test game has no deals");
  return hands;
}

function at(
  game: ConfigurableRiverV3Game,
  history: readonly ConfigurableRiverAction[],
): ConfigurableRiverV3State {
  return configurableRiverV3State(game, firstHands(game), history);
}

function actionsAt(
  game: ConfigurableRiverV3Game,
  history: readonly ConfigurableRiverAction[],
): readonly ConfigurableRiverAction[] {
  const node = game.node(at(game, history));
  if (node.kind !== "player") throw new Error(`Expected player node after ${history.join("-")}`);
  return node.actions;
}

function reducedV3Game(): ConfigurableRiverV3Game {
  return createConfigurableRiverV3Game({
    ...CONFIGURABLE_RIVER_V3_DEMO_SCENARIO,
    id: "river-v3-reduced",
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
    openingBetSizes: [50, 100],
    raiseToSizes: [100, 150, 200],
  });
}

function shortAllInGame(): ConfigurableRiverV3Game {
  return createConfigurableRiverV3Game({
    ...CONFIGURABLE_RIVER_V3_DEMO_SCENARIO,
    id: "river-v3-short-all-in",
    stackBehind: [120, 200],
    openingBetSizes: [50, 200],
    raiseToSizes: [100, 120, 200],
  });
}

function deterministicStrategy(
  index: GameTreeIndex<ConfigurableRiverAction>,
  seed: number,
): BehavioralStrategy<ConfigurableRiverAction> {
  return new Map(index.informationSets.map((definition, informationSet) => {
    const weights = definition.actions.map((_, action) =>
      1 + ((seed * 19 + informationSet * 13 + action * 7) % 31));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return [definition.key, {
      actions: [...definition.actions],
      probabilities: weights.map(weight => weight / total),
    }] as const;
  }));
}

function orderedChoices(choices: ReadonlyMap<string, ConfigurableRiverAction>) {
  return [...choices].sort(([left], [right]) => left.localeCompare(right));
}

function assertGradesNear(
  readable: ReturnType<typeof gradeStrategy<unknown, ConfigurableRiverAction, unknown>>,
  factorized: ReturnType<typeof gradeFactorizedRiverStrategy>,
): void {
  const pairs = [
    [readable.value[0], factorized.value[0]],
    [readable.value[1], factorized.value[1]],
    [readable.gains[0], factorized.gains[0]],
    [readable.gains[1], factorized.gains[1]],
    [readable.nashGap, factorized.nashGap],
    [readable.exploitability, factorized.exploitability],
    [readable.bestResponses[0].value, factorized.bestResponses[0].value],
    [readable.bestResponses[1].value, factorized.bestResponses[1].value],
  ];
  pairs.forEach(([left, right]) => assert.ok(Math.abs(left - right) <= TOLERANCE));
  for (const player of [0, 1] as const) {
    assert.deepEqual(
      orderedChoices(factorized.bestResponses[player].choices),
      orderedChoices(readable.bestResponses[player].choices),
    );
  }
}

function cheatingValue(
  game: ConfigurableRiverV3Game,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
  player: SolverPlayer,
  state: ConfigurableRiverV3State = game.initialState(),
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
  if (!entry) throw new Error("Missing v3 strategy in cheating regression");
  return children.reduce((sum, value, action) =>
    sum + value * entry.probabilities[action], 0);
}

function normalizeV2Key(key: string): string {
  return key.replace(":v2:", ":v3:");
}

test("v3 locked fixture has the declared exact finite tree", () => {
  assert.deepEqual(configurableRiverV3DemoGame.preflight.rangeEntries, [14, 14]);
  assert.equal(configurableRiverV3DemoGame.preflight.compatibleDeals, 176);
  assert.equal(configurableRiverV3DemoGame.preflight.publicStatesPerDeal, 63);
  assert.equal(configurableRiverV3DemoGame.preflight.publicDecisionStatesPerDeal, 22);
  assert.equal(configurableRiverV3DemoGame.preflight.publicTerminalStatesPerDeal, 41);
  assert.equal(configurableRiverV3DemoGame.preflight.projectedFullStates, 11_089);
  const compiled = compileFactorizedRiverGame(configurableRiverV3DemoGame);
  assert.equal(compiled.index.informationSets.length, 308);
  assert.equal(compiled.publicNodeCount, 63);
});

test("v3 permits a full re-raise and then enforces the two-raise cap", () => {
  assert.deepEqual(actionsAt(configurableRiverV3DemoGame, []), [
    "check", "bet-to-50", "bet-to-100", "bet-to-200",
  ]);
  assert.deepEqual(
    actionsAt(configurableRiverV3DemoGame, ["bet-to-50"]),
    ["fold", "call", "raise-to-100", "raise-to-150", "raise-to-200"],
  );
  assert.deepEqual(
    actionsAt(
      configurableRiverV3DemoGame,
      ["bet-to-50", "raise-to-100"],
    ),
    ["fold", "call", "raise-to-150", "raise-to-200"],
  );
  assert.deepEqual(
    actionsAt(
      configurableRiverV3DemoGame,
      ["bet-to-50", "raise-to-100", "raise-to-150"],
    ),
    ["fold", "call"],
  );
});

test("v3 enforces minimum raises but permits a short all-in without reopening action", () => {
  assert.deepEqual(
    actionsAt(configurableRiverV3DemoGame, ["bet-to-100"]),
    ["fold", "call", "raise-to-200"],
  );
  const game = shortAllInGame();
  assert.deepEqual(
    actionsAt(game, ["bet-to-50", "raise-to-100"]),
    ["fold", "call", "raise-to-120"],
  );
  const afterShortAllIn = at(game, ["bet-to-50", "raise-to-100", "raise-to-120"]);
  assert.equal(afterShortAllIn.public.lastFullRaise, 50);
  const response = game.node(afterShortAllIn);
  assert.equal(response.kind, "player");
  if (response.kind !== "player") throw new Error("Expected response to short all-in");
  assert.deepEqual(response.actions, ["fold", "call"]);
});

test("v3 returns unmatched chips when the shorter stack calls", () => {
  const game = shortAllInGame();
  const state = at(game, ["check", "bet-to-200", "call"]);
  const settlement = game.settlement(state);
  assert.deepEqual(settlement.contributions, [170, 250]);
  assert.deepEqual(settlement.returnedUncalled, [0, 80]);
  assert.equal(settlement.contestablePot, 340);
  assert.equal(settlement.utility[0] + settlement.utility[1], 0);
});

test("the independent v3 oracle agrees on every deal and terminal", () => {
  const audit = auditConfigurableRiverV3Rules(configurableRiverV3DemoGame);
  assert.deepEqual(audit, {
    dealsChecked: 176,
    publicTerminals: 41,
    terminalsChecked: 7_216,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("v3 with one raise reduces to the accepted v2 rules", () => {
  const v2 = createConfigurableRiverGame(CONFIGURABLE_RIVER_V2_DEMO_SCENARIO);
  const v3Scenario: ConfigurableRiverV3Scenario = {
    ...CONFIGURABLE_RIVER_V2_DEMO_SCENARIO,
    version: 3,
  };
  const v3 = createConfigurableRiverV3Game(v3Scenario);
  const left = compileFactorizedRiverGame(v2);
  const right = compileFactorizedRiverGame(v3);
  assert.deepEqual(right.publicActions, left.publicActions);
  assert.deepEqual(right.publicHistories, left.publicHistories);
  assert.deepEqual(right.nodeKinds, left.nodeKinds);
  assert.deepEqual(right.nodePlayers, left.nodePlayers);
  assert.deepEqual(right.edgeChildren, left.edgeChildren);
  assert.deepEqual(right.terminalShowdown, left.terminalShowdown);
  assert.deepEqual(right.terminalUtility0Win, left.terminalUtility0Win);
  assert.deepEqual(right.terminalUtility0Tie, left.terminalUtility0Tie);
  assert.deepEqual(right.terminalUtility0Loss, left.terminalUtility0Loss);
  assert.deepEqual(right.dealProbabilities, left.dealProbabilities);
  assert.deepEqual(right.dealShowdown, left.dealShowdown);
  assert.deepEqual(
    right.index.informationSets.map(definition => ({ ...definition, key: definition.key })),
    left.index.informationSets.map(definition => ({
      ...definition,
      key: normalizeV2Key(definition.key),
    })),
  );

  const leftSolve = solveCompiledFactorizedRiverCfr(left, { iterations: 200 });
  const rightSolve = solveCompiledFactorizedRiverCfr(right, { iterations: 200 });
  for (const [key, leftEntry] of leftSolve.averageStrategy) {
    const rightEntry = rightSolve.averageStrategy.get(normalizeV2Key(key));
    assert.ok(rightEntry);
    assert.deepEqual(rightEntry, leftEntry);
  }
  assert.deepEqual(
    gradeFactorizedRiverStrategy(
      compileFactorizedRiverScorekeeper(right),
      rightSolve.averageStrategy,
    ).value,
    gradeFactorizedRiverStrategy(
      compileFactorizedRiverScorekeeper(left),
      leftSolve.averageStrategy,
    ).value,
  );
});

test("factorized ordinary CFR exactly matches readable CFR on the two-raise game", () => {
  const options = { iterations: 200, checkpointIterations: [1, 17, 200] } as const;
  const readable = solveCfr(configurableRiverV3DemoGame, options);
  const factorized = solveCompiledFactorizedRiverCfr(
    compileFactorizedRiverGame(configurableRiverV3DemoGame),
    options,
  );
  assert.deepEqual(factorized.currentStrategy, readable.currentStrategy);
  assert.deepEqual(factorized.averageStrategy, readable.averageStrategy);
  assert.deepEqual(factorized.cumulativeRegrets, readable.cumulativeRegrets);
  assert.deepEqual(
    factorized.checkpoints.map(checkpoint => checkpoint.averageStrategy),
    readable.checkpoints.map(checkpoint => checkpoint.averageStrategy),
  );
});

test("v3 factorized grading matches the readable scorekeeper across generated profiles", () => {
  const compiled = compileFactorizedRiverGame(configurableRiverV3DemoGame);
  const scorekeeper = compileFactorizedRiverScorekeeper(compiled);
  fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), seed => {
    const strategy = deterministicStrategy(compiled.index, seed);
    assertGradesNear(
      gradeStrategy(configurableRiverV3DemoGame, strategy, compiled.index),
      gradeFactorizedRiverStrategy(scorekeeper, strategy),
    );
  }), { numRuns: 30 });
});

test("v3 legal best response cannot inspect the hidden opponent hand", () => {
  const game = reducedV3Game();
  const compiled = compileFactorizedRiverGame(game);
  const scorekeeper = compileFactorizedRiverScorekeeper(compiled);
  const strategy = deterministicStrategy(compiled.index, 83);
  let strictAdvantage = false;
  for (const player of [0, 1] as const) {
    const legal = factorizedRiverInformationSetBestResponse(scorekeeper, strategy, player);
    const cheating = cheatingValue(game, strategy, player);
    assert.ok(cheating + TOLERANCE >= legal.value);
    if (cheating > legal.value + TOLERANCE) strictAdvantage = true;
  }
  assert.equal(strictAdvantage, true);
});

test("v3 CFR+ is reproducible, independently graded, and below its quality gate", () => {
  const compiled = compileFactorizedRiverGame(configurableRiverV3DemoGame);
  const input = {
    iterations: 400,
    algorithm: "cfr-plus",
    averagingDelay: 20,
    checkpointIterations: [100, 400],
  } as const;
  const first = solveCompiledFactorizedRiverCfr(compiled, input);
  const second = solveCompiledFactorizedRiverCfr(compiled, input);
  assert.deepEqual(second.currentStrategy, first.currentStrategy);
  assert.deepEqual(second.averageStrategy, first.averageStrategy);
  assert.deepEqual(second.cumulativeRegrets, first.cumulativeRegrets);
  for (const regrets of first.cumulativeRegrets.values()) {
    regrets.forEach(regret => assert.ok(Number.isFinite(regret) && regret >= 0));
  }
  const grade = gradeFactorizedRiverStrategy(
    compileFactorizedRiverScorekeeper(compiled),
    first.averageStrategy,
  );
  assert.ok(grade.exploitability < 0.25);
  assert.equal(first.fullDealRegretPasses, 800);
  assert.equal(first.reachOnlyPasses, 400);
});

test("v3 public entry point returns exact preflight, actions, solve, and grade", () => {
  const solved = solveConfigurableRiverV3({
    id: "river-v3-public-test",
    board: CONFIGURABLE_RIVER_V3_DEMO_SCENARIO.board,
    rangeText: ["AA AQs 76s", "JJ ATs 65s"],
    committed: [50, 50],
    stackBehind: [200, 200],
    openingBetSizes: [50, 100, 200],
    raiseToSizes: [100, 150, 200],
    maxRaises: 2,
  }, { iterations: 100, algorithm: "cfr-plus" });
  assert.equal(solved.game.preflight.compatibleDeals, 176);
  assert.equal(solved.result.compiled.publicNodeCount, 63);
  assert.ok(solved.actions.includes("raise-to-150"));
  assert.ok(Number.isFinite(solved.grade.exploitability));
  assert.equal(solved.decisions, null);

  const withTeaching = solveConfigurableRiverV3({
    id: "river-v3-public-teaching-test",
    board: CONFIGURABLE_RIVER_V3_DEMO_SCENARIO.board,
    rangeText: ["AA AQs 76s", "JJ ATs 65s"],
    committed: [50, 50],
    stackBehind: [200, 200],
    openingBetSizes: [50, 100, 200],
    raiseToSizes: [100, 150, 200],
    maxRaises: 2,
  }, { iterations: 20, algorithm: "cfr-plus", includeDecisionFacts: true });
  assert.equal(withTeaching.decisions?.length, withTeaching.result.compiled.index.informationSets.length);
  const reached = withTeaching.decisions?.find(decision => !decision.offPath);
  assert.ok(reached);
  assert.ok(reached.actions.every(action =>
    action.expectedValue !== null && action.differenceFromBest !== null));
});

test("v3 validates menu and resource limits before solving", () => {
  const base = {
    id: "river-v3-limit-test",
    board: CONFIGURABLE_RIVER_V3_DEMO_SCENARIO.board,
    rangeText: ["AA", "KK"],
    committed: [50, 50] as const,
    stackBehind: [200, 200] as const,
    openingBetSizes: [10, 25, 50, 100, 150, 200],
    raiseToSizes: [100],
    maxRaises: 2 as const,
  } as const satisfies ConfigurableRiverV3Request;
  assert.throws(() => prepareConfigurableRiverV3(base), /6 amounts; v3 limit is 5/);
  assert.throws(() => prepareConfigurableRiverV3({
    ...base,
    openingBetSizes: [50],
  }, { maxProjectedStates: 100 }), /projects .* repeated states; limit is 100/);
  assert.throws(() => createConfigurableRiverV3Game({
    ...CONFIGURABLE_RIVER_V3_DEMO_SCENARIO,
    maxRaises: 3,
  } as unknown as ConfigurableRiverV3Scenario), /exceeds the limit 2/);
  assert.throws(() => solveConfigurableRiverV3({
    ...FACTORIZED_RIVER_WIDE_REQUEST,
    id: "river-v3-teaching-limit",
    maxRaises: 1,
  }, {
    iterations: 1,
    includeDecisionFacts: true,
  }), /106093 states; teaching limit is 100000/);
});

test("random legal v3 endings conserve chips and remain zero-sum", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 1_000_000 }), seed => {
    let cursor = seed;
    const deal = configurableRiverV3DemoGame.deals[cursor % configurableRiverV3DemoGame.deals.length];
    let state = configurableRiverV3DemoGame.nextChance(
      configurableRiverV3DemoGame.initialState(),
      deal.outcome,
    );
    while (true) {
      const node = configurableRiverV3DemoGame.node(state);
      if (node.kind === "terminal") {
        const settlement = configurableRiverV3DemoGame.settlement(state);
        assert.equal(settlement.awards[0] + settlement.awards[1],
          settlement.contributions[0] + settlement.contributions[1]);
        assert.equal(settlement.utility[0] + settlement.utility[1], 0);
        return;
      }
      assert.equal(node.kind, "player");
      cursor = (cursor * 1_664_525 + 1_013_904_223) >>> 0;
      state = configurableRiverV3DemoGame.nextAction(state, node.actions[cursor % node.actions.length]);
    }
  }), { numRuns: 200 });
});

// Compile-time regression: the accepted v2 state remains a valid, separate type.
const _v2StateTypeCheck: ConfigurableRiverState | null = null;
void _v2StateTypeCheck;
