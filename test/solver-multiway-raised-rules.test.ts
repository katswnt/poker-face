import assert from "node:assert/strict";
import test from "node:test";
import { buildMultiwayGameTreeIndex } from "../src/lib/solver/multiway/game";
import { raisedRiverV1Game } from "../src/lib/solver/multiway/raised-fixture";
import {
  auditRaisedRiverRules,
  RAISED_RIVER_TERMINAL_HISTORIES,
} from "../src/lib/solver/multiway/raised-oracle";
import {
  createRaisedRiverGame,
  raisedRiverState,
} from "../src/lib/solver/multiway/raised-river-game";

test("the locked raised fixture has the specified exact tree", () => {
  const index = buildMultiwayGameTreeIndex(raisedRiverV1Game);
  assert.equal(raisedRiverV1Game.deals.length, 172);
  assert.deepEqual({
    totalStates: index.totalStates,
    chanceNodes: index.chanceNodes,
    decisionNodes: index.decisionNodes,
    terminalNodes: index.terminalNodes,
    informationSets: index.informationSets.length,
    informationSetsByPlayer: [0, 1, 2].map(player =>
      index.informationSets.filter(definition => definition.player === player).length),
  }, {
    totalStates: 13_073,
    chanceNodes: 1,
    decisionNodes: 5_676,
    terminalNodes: 7_396,
    informationSets: 198,
    informationSetsByPlayer: [66, 66, 66],
  });
  assert.equal(RAISED_RIVER_TERMINAL_HISTORIES.length, 43);
});

test("the separate raised oracle agrees on every deal, terminal, return, and pot", () => {
  assert.deepEqual(auditRaisedRiverRules(raisedRiverV1Game), {
    dealsChecked: 172,
    terminalsChecked: 7_396,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumReturnedUncalledDifference: 0,
    maximumContestablePotDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("a raise reopens action for an earlier caller in cyclic seat order", () => {
  const hands = raisedRiverV1Game.deals[0].outcome.hands;
  let state = raisedRiverState(raisedRiverV1Game, hands, ["bet", "call", "raise-all-in"]);
  let node = raisedRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") {
    assert.equal(node.player, 0);
    assert.deepEqual(node.actions, ["fold", "call"]);
  }
  state = raisedRiverV1Game.nextAction(state, "call");
  node = raisedRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.equal(node.player, 1);
  state = raisedRiverV1Game.nextAction(state, "call");
  assert.equal(raisedRiverV1Game.node(state).kind, "terminal");
  assert.deepEqual(raisedRiverV1Game.totalContributions(state), [90, 90, 90]);
});

test("an unmatched part of an all-in raise is returned and not called winnings", () => {
  const hands = raisedRiverV1Game.deals[0].outcome.hands;
  const state = raisedRiverState(
    raisedRiverV1Game,
    hands,
    ["bet", "fold", "raise-all-in", "fold"],
  );
  const settlement = raisedRiverV1Game.settlement(state);
  assert.deepEqual(settlement.contributions, [60, 30, 90]);
  assert.deepEqual(settlement.returnedUncalled, [0, 0, 30]);
  assert.equal(settlement.contestablePot, 150);
  assert.deepEqual(settlement.winners, [2]);
  assert.deepEqual(settlement.utility, [-60, -30, 90]);
});

test("a prior caller who folds to the raise is not charged for folding again", () => {
  const hands = raisedRiverV1Game.deals[0].outcome.hands;
  const before = raisedRiverState(
    raisedRiverV1Game,
    hands,
    ["bet", "call", "raise-all-in", "call"],
  );
  assert.equal(before.public.actingPlayer, 1);
  assert.deepEqual(raisedRiverV1Game.totalContributions(before), [90, 60, 90]);
  const after = raisedRiverV1Game.nextAction(before, "fold");
  assert.deepEqual(raisedRiverV1Game.totalContributions(after), [90, 60, 90]);
  assert.deepEqual(after.public.active, [true, false, true]);
});

test("a board tie splits only the contestable pot after a return", () => {
  const game = createRaisedRiverGame({
    ...raisedRiverV1Game.scenario,
    id: "three-player-raised-river-tie-test",
    board: ["As", "Ks", "Qs", "Js", "Ts"],
    ranges: [
      [{ cards: ["3c", "2d"], weight: 1 }],
      [{ cards: ["5c", "4d"], weight: 1 }],
      [{ cards: ["7c", "6d"], weight: 1 }],
    ],
  });
  const hands = game.deals[0].outcome.hands;
  const state = raisedRiverState(game, hands, ["bet", "fold", "raise-all-in", "call"]);
  const settlement = game.settlement(state);
  assert.deepEqual(settlement.contributions, [90, 30, 90]);
  assert.deepEqual(settlement.returnedUncalled, [0, 0, 0]);
  assert.equal(settlement.contestablePot, 210);
  assert.deepEqual(settlement.winners, [0, 2]);
  assert.deepEqual(settlement.utility, [15, -30, 15]);
});

test("raised information sets expose only the acting player's cards", () => {
  const ownHand = raisedRiverV1Game.scenario.ranges[0][0].cards;
  const deals = raisedRiverV1Game.deals
    .map(deal => deal.outcome.hands)
    .filter(hands => hands[0].join("") === ownHand.join(""));
  assert.ok(deals.length > 1);
  const keys = deals.map(hands => {
    const state = raisedRiverState(raisedRiverV1Game, hands, ["bet", "call", "raise-all-in"]);
    return raisedRiverV1Game.informationSet(state, 0);
  });
  assert.equal(new Set(keys).size, 1);
  assert.match(keys[0], new RegExp(`hand=${ownHand.join("")}`));
  for (const hands of deals) {
    assert.ok(!keys[0].includes(hands[1].join("")));
    assert.ok(!keys[0].includes(hands[2].join("")));
  }
});

test("the one-raise limit rejects another raise and unopened folds", () => {
  const hands = raisedRiverV1Game.deals[0].outcome.hands;
  const root = raisedRiverState(raisedRiverV1Game, hands);
  assert.throws(() => raisedRiverV1Game.nextAction(root, "fold"), /Illegal fold/);
  const raised = raisedRiverState(raisedRiverV1Game, hands, ["bet", "raise-all-in"]);
  const node = raisedRiverV1Game.node(raised);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.deepEqual(node.actions, ["fold", "call"]);
  assert.throws(() => raisedRiverV1Game.nextAction(raised, "raise-all-in"), /Illegal raise-all-in/);
});
