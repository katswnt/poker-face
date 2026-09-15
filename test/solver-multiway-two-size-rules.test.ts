import assert from "node:assert/strict";
import test from "node:test";
import { buildMultiwayGameTreeIndex } from "../src/lib/solver/multiway/game";
import { twoSizeRiverV1Game } from "../src/lib/solver/multiway/two-size-fixture";
import {
  auditTwoSizeRiverRules,
  TWO_SIZE_RIVER_TERMINAL_HISTORIES,
} from "../src/lib/solver/multiway/two-size-oracle";
import {
  createTwoSizeRiverGame,
  twoSizeRiverState,
} from "../src/lib/solver/multiway/two-size-river-game";

test("the locked two-size fixture has the specified exact tree", () => {
  const index = buildMultiwayGameTreeIndex(twoSizeRiverV1Game);
  assert.equal(twoSizeRiverV1Game.deals.length, 172);
  assert.deepEqual({
    totalStates: index.totalStates,
    chanceNodes: index.chanceNodes,
    decisionNodes: index.decisionNodes,
    terminalNodes: index.terminalNodes,
    informationSets: index.informationSets.length,
    informationSetsByPlayer: [0, 1, 2].map(player =>
      index.informationSets.filter(definition => definition.player === player).length),
  }, {
    totalStates: 16_685,
    chanceNodes: 1,
    decisionNodes: 7_224,
    terminalNodes: 9_460,
    informationSets: 252,
    informationSetsByPlayer: [84, 84, 84],
  });
  assert.equal(TWO_SIZE_RIVER_TERMINAL_HISTORIES.length, 55);
});

test("the separate two-size oracle agrees on every deal, ending, return, and pot", () => {
  assert.deepEqual(auditTwoSizeRiverRules(twoSizeRiverV1Game), {
    dealsChecked: 172,
    terminalsChecked: 9_460,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumReturnedUncalledDifference: 0,
    maximumContestablePotDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("an all-in opening bet cannot be raised", () => {
  const hands = twoSizeRiverV1Game.deals[0].outcome.hands;
  const state = twoSizeRiverState(twoSizeRiverV1Game, hands, ["bet-all-in"]);
  const node = twoSizeRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") {
    assert.equal(node.player, 1);
    assert.deepEqual(node.actions, ["fold", "call"]);
  }
  assert.throws(() => twoSizeRiverV1Game.nextAction(state, "raise-all-in"), /Illegal raise-all-in/);
});

test("an all-in opening bet stays open until both opponents answer", () => {
  const hands = twoSizeRiverV1Game.deals[0].outcome.hands;
  let state = twoSizeRiverState(twoSizeRiverV1Game, hands, ["bet-all-in", "call"]);
  let node = twoSizeRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.equal(node.player, 2);
  state = twoSizeRiverV1Game.nextAction(state, "fold");
  node = twoSizeRiverV1Game.node(state);
  assert.equal(node.kind, "terminal");
  assert.deepEqual(twoSizeRiverV1Game.totalContributions(state), [90, 90, 30]);
  assert.deepEqual(state.public.active, [true, true, false]);
});

test("an uncalled all-in opening bet is fully returned before the old pot is won", () => {
  const hands = twoSizeRiverV1Game.deals[0].outcome.hands;
  const state = twoSizeRiverState(twoSizeRiverV1Game, hands, ["bet-all-in", "fold", "fold"]);
  const settlement = twoSizeRiverV1Game.settlement(state);
  assert.deepEqual(settlement.contributions, [90, 30, 30]);
  assert.deepEqual(settlement.returnedUncalled, [60, 0, 0]);
  assert.equal(settlement.contestablePot, 90);
  assert.deepEqual(settlement.winners, [0]);
  assert.deepEqual(settlement.utility, [60, -30, -30]);
});

test("the smaller bet still allows one raise and reopens an earlier caller", () => {
  const hands = twoSizeRiverV1Game.deals[0].outcome.hands;
  let state = twoSizeRiverState(
    twoSizeRiverV1Game,
    hands,
    ["bet-30", "call", "raise-all-in"],
  );
  let node = twoSizeRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.equal(node.player, 0);
  state = twoSizeRiverV1Game.nextAction(state, "call");
  node = twoSizeRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.equal(node.player, 1);
});

test("a tied all-in showdown splits the contestable pot", () => {
  const game = createTwoSizeRiverGame({
    ...twoSizeRiverV1Game.scenario,
    id: "three-player-two-size-river-tie-test",
    board: ["As", "Ks", "Qs", "Js", "Ts"],
    ranges: [
      [{ cards: ["3c", "2d"], weight: 1 }],
      [{ cards: ["5c", "4d"], weight: 1 }],
      [{ cards: ["7c", "6d"], weight: 1 }],
    ],
  });
  const hands = game.deals[0].outcome.hands;
  const state = twoSizeRiverState(game, hands, ["bet-all-in", "call", "fold"]);
  const settlement = game.settlement(state);
  assert.equal(settlement.contestablePot, 210);
  assert.deepEqual(settlement.winners, [0, 1]);
  assert.deepEqual(settlement.utility, [15, 15, -30]);
});

test("two-size information sets expose only the acting player's cards", () => {
  const ownHand = twoSizeRiverV1Game.scenario.ranges[1][0].cards;
  const deals = twoSizeRiverV1Game.deals
    .map(deal => deal.outcome.hands)
    .filter(hands => hands[1].join("") === ownHand.join(""));
  assert.ok(deals.length > 1);
  const keys = deals.map(hands => {
    const state = twoSizeRiverState(twoSizeRiverV1Game, hands, ["bet-all-in"]);
    return twoSizeRiverV1Game.informationSet(state, 1);
  });
  assert.equal(new Set(keys).size, 1);
  assert.match(keys[0], new RegExp(`hand=${ownHand.join("")}`));
  for (const hands of deals) {
    assert.ok(!keys[0].includes(hands[0].join("")));
    assert.ok(!keys[0].includes(hands[2].join("")));
  }
});

test("two-size validation rejects an all-in that does not use the whole stack", () => {
  assert.throws(() => createTwoSizeRiverGame({
    ...twoSizeRiverV1Game.scenario,
    id: "bad-two-size-all-in",
    allInBet: 59,
  }), /locks opening bets at 30 and 60 chips/);
  assert.throws(() => createTwoSizeRiverGame({
    ...twoSizeRiverV1Game.scenario,
    id: "bad-two-size-small-bet",
    smallBet: 29,
  }), /locks opening bets at 30 and 60 chips/);
});
