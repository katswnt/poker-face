import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { buildGameTreeIndex } from "../src/lib/solver/toy/game";
import { parseRiverCombo, riverComboKey, type RiverCard } from "../src/lib/solver/river/cards";
import { RIVER_V1_SCENARIO, riverV1Game } from "../src/lib/solver/river/fixture";
import {
  createRiverGame,
  riverState,
  type RiverAction,
  type RiverRangeEntry,
  type RiverScenario,
} from "../src/lib/solver/river/game";
import {
  RIVER_TERMINAL_HISTORIES,
  auditRiverRules,
  oracleRiverContributions,
} from "../src/lib/solver/river/oracle";

const DEAL = [parseRiverCombo("KhQh"), parseRiverCombo("KdQd")] as const;

function decision(history: readonly RiverAction[]) {
  const node = riverV1Game.node(riverState(riverV1Game, DEAL, history));
  assert.equal(node.kind, "player");
  if (node.kind !== "player") throw new Error("Expected a river decision");
  return node;
}

function withRanges(
  ranges: readonly [readonly RiverRangeEntry[], readonly RiverRangeEntry[]],
): RiverScenario {
  return { ...RIVER_V1_SCENARIO, id: "river-test", ranges };
}

test("river v1 removes blocked hand pairs and renormalizes the joint range", () => {
  assert.equal(riverV1Game.deals.length, 61);
  assert.ok(riverV1Game.deals.every(deal => Number.isFinite(deal.probability) && deal.probability > 0));
  assert.ok(Math.abs(riverV1Game.deals.reduce((sum, deal) => sum + deal.probability, 0) - 1) < 1e-12);
  assert.ok(riverV1Game.deals.every(deal => deal.probability === 1 / 61));

  const keys = new Set(riverV1Game.deals.map(deal =>
    `${riverComboKey(deal.outcome.hands[0])}|${riverComboKey(deal.outcome.hands[1])}`,
  ));
  assert.ok(!keys.has("AsQs|AsJs"));
  assert.ok(!keys.has("QsJs|AsJs"));
  assert.ok(!keys.has("9h9c|9c8c"));
});

test("river v1 has the independently derived complete-tree shape", () => {
  const index = buildGameTreeIndex(riverV1Game);
  assert.deepEqual({
    totalStates: index.totalStates,
    chanceNodes: index.chanceNodes,
    decisionNodes: index.decisionNodes,
    terminalNodes: index.terminalNodes,
    informationSets: index.informationSets.length,
  }, {
    totalStates: 1_282,
    chanceNodes: 1,
    decisionNodes: 488,
    terminalNodes: 793,
    informationSets: 64,
  });
  assert.equal(index.informationSets.filter(definition => definition.player === 0).length, 32);
  assert.equal(index.informationSets.filter(definition => definition.player === 1).length, 32);
  assert.equal(index.informationSets.filter(definition => definition.stateCount === 6).length, 4);
  assert.equal(index.informationSets.filter(definition => definition.stateCount === 7).length, 16);
  assert.equal(index.informationSets.filter(definition => definition.stateCount === 8).length, 44);
});

test("river v1 legal actions lock its sizes, action order, and one-raise cap", () => {
  assert.deepEqual(decision([]), {
    kind: "player", player: 0, actions: ["check", "bet-half", "bet-pot"],
  });
  assert.deepEqual(decision(["check"]), {
    kind: "player", player: 1, actions: ["check", "bet-half", "bet-pot"],
  });
  assert.deepEqual(decision(["bet-half"]), {
    kind: "player", player: 1, actions: ["fold", "call", "raise-all-in"],
  });
  assert.deepEqual(decision(["check", "bet-half", "raise-all-in"]), {
    kind: "player", player: 1, actions: ["fold", "call"],
  });
  assert.deepEqual(decision(["bet-pot"]), {
    kind: "player", player: 1, actions: ["fold", "call"],
  });

  assert.throws(
    () => riverV1Game.nextAction(riverState(riverV1Game, DEAL), "call"),
    /Illegal river action call/,
  );
  assert.throws(
    () => riverV1Game.nextAction(riverState(riverV1Game, DEAL, ["bet-pot"]), "raise-all-in"),
    /Illegal river action raise-all-in/,
  );
  assert.throws(
    () => riverV1Game.nextAction(riverState(riverV1Game, DEAL, ["bet-half", "call"]), "check"),
    /Cannot play check at a terminal/,
  );
});

test("river contributions keep prior chips separate and price every terminal branch", () => {
  const expected = new Map<string, readonly [number, number]>([
    ["check-check", [50, 50]],
    ["bet-half-fold", [100, 50]],
    ["bet-half-call", [100, 100]],
    ["bet-half-raise-all-in-fold", [100, 150]],
    ["bet-half-raise-all-in-call", [150, 150]],
    ["bet-pot-fold", [150, 50]],
    ["bet-pot-call", [150, 150]],
    ["check-bet-half-fold", [50, 100]],
    ["check-bet-half-call", [100, 100]],
    ["check-bet-half-raise-all-in-fold", [150, 100]],
    ["check-bet-half-raise-all-in-call", [150, 150]],
    ["check-bet-pot-fold", [50, 150]],
    ["check-bet-pot-call", [150, 150]],
  ]);
  for (const history of RIVER_TERMINAL_HISTORIES) {
    const key = history.join("-");
    assert.deepEqual(riverV1Game.totalContributions(riverState(riverV1Game, DEAL, history)), expected.get(key));
    assert.deepEqual(oracleRiverContributions(RIVER_V1_SCENARIO, history), expected.get(key));
  }
});

test("the independent slow oracle agrees on every chance edge and all 793 terminals", () => {
  assert.deepEqual(auditRiverRules(riverV1Game), {
    dealsChecked: 61,
    terminalsChecked: 793,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("river information sets reveal only the acting player's hand and public actions", () => {
  const sameOwnA = riverV1Game.informationSet(riverState(riverV1Game, [
    parseRiverCombo("KhQh"), parseRiverCombo("KdQd"),
  ]), 0);
  const sameOwnB = riverV1Game.informationSet(riverState(riverV1Game, [
    parseRiverCombo("QhKh"), parseRiverCombo("8h8c"),
  ]), 0);
  assert.equal(sameOwnA, sameOwnB);
  assert.ok(sameOwnA.includes("hand=KhQh"));
  assert.ok(!sameOwnA.includes("KdQd"));
  assert.notEqual(sameOwnA, riverV1Game.informationSet(riverState(riverV1Game, [
    parseRiverCombo("KcJc"), parseRiverCombo("KdQd"),
  ]), 0));
  assert.notEqual(
    riverV1Game.informationSet(riverState(riverV1Game, DEAL), 0),
    riverV1Game.informationSet(riverState(riverV1Game, DEAL, ["check", "bet-half"]), 0),
  );
});

test("river scenario validation rejects impossible or ambiguous inputs", () => {
  assert.throws(
    () => createRiverGame({
      ...RIVER_V1_SCENARIO,
      board: ["Ks", "8s", "4s", "2c"] as unknown as RiverScenario["board"],
    }),
    /requires five board cards/,
  );
  assert.throws(
    () => createRiverGame({ ...RIVER_V1_SCENARIO, id: "Bad id" }),
    /Invalid river scenario id/,
  );
  assert.throws(
    () => createRiverGame({
      ...RIVER_V1_SCENARIO,
      board: ["Ks", "Ks", "4s", "2c", "9d"] as readonly RiverCard[] as RiverScenario["board"],
    }),
    /duplicate cards/,
  );
  assert.throws(
    () => createRiverGame(withRanges([[], RIVER_V1_SCENARIO.ranges[1]])),
    /range is empty/,
  );
  assert.throws(
    () => createRiverGame(withRanges([[
      { cards: parseRiverCombo("AsQs"), weight: 1 },
      { cards: parseRiverCombo("QsAs"), weight: 1 },
    ], RIVER_V1_SCENARIO.ranges[1]])),
    /repeats combo AsQs/,
  );
  assert.throws(
    () => createRiverGame(withRanges([[
      { cards: parseRiverCombo("AsQs"), weight: 0 },
    ], RIVER_V1_SCENARIO.ranges[1]])),
    /invalid weight 0/,
  );
  assert.throws(
    () => createRiverGame(withRanges([[
      { cards: parseRiverCombo("KsQs"), weight: 1 },
    ], RIVER_V1_SCENARIO.ranges[1]])),
    /collides with the board/,
  );
  assert.throws(
    () => createRiverGame(withRanges([[
      { cards: parseRiverCombo("AsQs"), weight: 1 },
    ], [
      { cards: parseRiverCombo("AsJs"), weight: 1 },
    ]])),
    /no compatible private-hand pairs/,
  );
});

test("positive range weights always form one exact, zero-sum game", () => {
  fc.assert(fc.property(
    fc.tuple(
      fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 8, maxLength: 8 }),
      fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 8, maxLength: 8 }),
    ),
    ([leftWeights, rightWeights]) => {
      const game = createRiverGame({
        ...RIVER_V1_SCENARIO,
        id: "river-weight-property",
        ranges: [
          RIVER_V1_SCENARIO.ranges[0].map((entry, index) => ({ ...entry, weight: leftWeights[index] })),
          RIVER_V1_SCENARIO.ranges[1].map((entry, index) => ({ ...entry, weight: rightWeights[index] })),
        ],
      });
      assert.equal(game.deals.length, 61);
      assert.ok(Math.abs(game.deals.reduce((sum, deal) => sum + deal.probability, 0) - 1) < 1e-12);
      const audit = auditRiverRules(game);
      assert.equal(audit.terminalsChecked, 793);
      assert.ok(audit.maximumProbabilityDifference < 1e-12);
      assert.equal(audit.maximumUtilityDifference, 0);
      assert.equal(audit.maximumZeroSumError, 0);
    },
  ), { numRuns: 50 });
});
