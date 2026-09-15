import assert from "node:assert/strict";
import test from "node:test";
import { buildMultiwayGameTreeIndex } from "../src/lib/solver/multiway/game";
import {
  FOUR_PLAYER_RIVER_V1_SCENARIO,
  fourPlayerRiverV1Game,
} from "../src/lib/solver/multiway/four-player-fixture";
import {
  createFourPlayerRiverGame,
  fourPlayerRiverState,
} from "../src/lib/solver/multiway/four-player-river-game";
import {
  auditFourPlayerRules,
  FOUR_PLAYER_TERMINAL_HISTORIES,
} from "../src/lib/solver/multiway/four-player-oracle";

test("the locked four-player fixture has the specified exact tree", () => {
  const index = buildMultiwayGameTreeIndex(fourPlayerRiverV1Game);
  assert.equal(fourPlayerRiverV1Game.deals.length, 174);
  assert.deepEqual({
    totalStates: index.totalStates,
    chanceNodes: index.chanceNodes,
    decisionNodes: index.decisionNodes,
    terminalNodes: index.terminalNodes,
    informationSets: index.informationSets.length,
    informationSetsByPlayer: [0, 1, 2, 3].map(player =>
      index.informationSets.filter(definition => definition.player === player).length),
  }, {
    totalStates: 11_311,
    chanceNodes: 1,
    decisionNodes: 5_568,
    terminalNodes: 5_742,
    informationSets: 128,
    informationSetsByPlayer: [32, 32, 32, 32],
  });
  assert.equal(FOUR_PLAYER_TERMINAL_HISTORIES.length, 33);
});

test("the separate four-player oracle agrees on every deal and ending", () => {
  assert.deepEqual(auditFourPlayerRules(fourPlayerRiverV1Game), {
    dealsChecked: 174,
    terminalsChecked: 5_742,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumAwardDifference: 0,
    maximumPotDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("a four-player bet remains open until all three opponents answer", () => {
  const hands = fourPlayerRiverV1Game.deals[0].outcome.hands;
  let state = fourPlayerRiverState(fourPlayerRiverV1Game, hands, ["bet-30", "call", "fold"]);
  let node = fourPlayerRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.equal(node.player, 3);
  state = fourPlayerRiverV1Game.nextAction(state, "call");
  node = fourPlayerRiverV1Game.node(state);
  assert.equal(node.kind, "terminal");
  assert.deepEqual(state.public.active, [true, true, false, true]);
  assert.deepEqual(fourPlayerRiverV1Game.totalContributions(state), [60, 60, 30, 60]);
});

test("a player who checked before a later bet still has to answer", () => {
  const hands = fourPlayerRiverV1Game.deals[0].outcome.hands;
  const state = fourPlayerRiverState(
    fourPlayerRiverV1Game,
    hands,
    ["check", "check", "check", "bet-30", "fold", "call", "fold"],
  );
  const node = fourPlayerRiverV1Game.node(state);
  assert.equal(node.kind, "terminal");
  assert.deepEqual(state.public.active, [false, true, false, true]);
});

test("a four-way board tie splits the pot four ways", () => {
  const game = createFourPlayerRiverGame({
    ...FOUR_PLAYER_RIVER_V1_SCENARIO,
    id: "four-player-board-tie-test",
    board: ["As", "Ks", "Qs", "Js", "Ts"],
    ranges: [
      [{ cards: ["3c", "2d"], weight: 1 }],
      [{ cards: ["5c", "4d"], weight: 1 }],
      [{ cards: ["7c", "6d"], weight: 1 }],
      [{ cards: ["9c", "8d"], weight: 1 }],
    ],
  });
  const state = fourPlayerRiverState(game, game.deals[0].outcome.hands, ["check", "check", "check", "check"]);
  const settlement = game.settlement(state);
  assert.equal(settlement.pot, 120);
  assert.deepEqual(settlement.winners, [0, 1, 2, 3]);
  assert.deepEqual(settlement.awards, [30, 30, 30, 30]);
  assert.deepEqual(settlement.utility, [0, 0, 0, 0]);
});

test("four-player information sets hide all six opponent cards", () => {
  const ownHand = fourPlayerRiverV1Game.scenario.ranges[2][0].cards;
  const deals = fourPlayerRiverV1Game.deals.map(deal => deal.outcome.hands)
    .filter(hands => hands[2].join("") === ownHand.join(""));
  assert.ok(deals.length > 1);
  const keys = deals.map(hands => {
    const state = fourPlayerRiverState(fourPlayerRiverV1Game, hands, ["check", "check"]);
    return fourPlayerRiverV1Game.informationSet(state, 2);
  });
  assert.equal(new Set(keys).size, 1);
  for (const hands of deals) {
    assert.ok(!keys[0].includes(hands[0].join("")));
    assert.ok(!keys[0].includes(hands[1].join("")));
    assert.ok(!keys[0].includes(hands[3].join("")));
  }
});

test("the four-player engine follows a validated permuted action order", () => {
  const game = createFourPlayerRiverGame({
    ...FOUR_PLAYER_RIVER_V1_SCENARIO,
    id: "four-player-permuted-order-test",
    positions: ["second", "last", "first", "third"],
    actionOrder: [2, 0, 3, 1],
  });
  const hands = game.deals[0].outcome.hands;
  let state = fourPlayerRiverState(game, hands);
  for (const expected of [2, 0, 3, 1]) {
    const node = game.node(state);
    assert.equal(node.kind, "player");
    if (node.kind === "player") assert.equal(node.player, expected);
    state = game.nextAction(state, "check");
  }
  assert.equal(game.node(state).kind, "terminal");
});

test("four-player v1 rejects changed money or malformed seat order", () => {
  assert.throws(() => createFourPlayerRiverGame({
    ...FOUR_PLAYER_RIVER_V1_SCENARIO,
    id: "bad-four-player-bet",
    betSize: 29 as 30,
  }), /locks the bet at 30/);
  assert.throws(() => createFourPlayerRiverGame({
    ...FOUR_PLAYER_RIVER_V1_SCENARIO,
    id: "bad-four-player-order",
    actionOrder: [0, 1, 1, 3],
  }), /must contain seats 0,1,2,3 exactly once/);
});
