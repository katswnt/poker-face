import assert from "node:assert/strict";
import test from "node:test";
import { buildMultiwayGameTreeIndex } from "../src/lib/solver/multiway/game";
import { sidePotRiverV1Game } from "../src/lib/solver/multiway/side-pot-fixture";
import {
  auditSidePotRules,
  SIDE_POT_RIVER_TERMINAL_HISTORIES,
} from "../src/lib/solver/multiway/side-pot-oracle";
import {
  createSidePotRiverGame,
  sidePotRiverState,
} from "../src/lib/solver/multiway/side-pot-river-game";

test("the locked side-pot fixture has the specified exact tree", () => {
  const index = buildMultiwayGameTreeIndex(sidePotRiverV1Game);
  assert.equal(sidePotRiverV1Game.deals.length, 172);
  assert.deepEqual({
    totalStates: index.totalStates,
    chanceNodes: index.chanceNodes,
    decisionNodes: index.decisionNodes,
    terminalNodes: index.terminalNodes,
    informationSets: index.informationSets.length,
    informationSetsByPlayer: [0, 1, 2].map(player =>
      index.informationSets.filter(definition => definition.player === player).length),
  }, {
    totalStates: 9_977,
    chanceNodes: 1,
    decisionNodes: 4_300,
    terminalNodes: 5_676,
    informationSets: 150,
    informationSetsByPlayer: [48, 54, 48],
  });
  assert.equal(SIDE_POT_RIVER_TERMINAL_HISTORIES.length, 33);
});

test("the separate oracle agrees on every deal, ending, pot layer, and award", () => {
  assert.deepEqual(auditSidePotRules(sidePotRiverV1Game), {
    dealsChecked: 172,
    terminalsChecked: 5_676,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumReturnedUncalledDifference: 0,
    maximumContestablePotDifference: 0,
    maximumLayerAmountDifference: 0,
    layerStructureMismatches: 0,
    maximumZeroSumError: 0,
  });
});

test("the short stack cannot choose the 60-chip opening bet", () => {
  const hands = sidePotRiverV1Game.deals[0].outcome.hands;
  const state = sidePotRiverState(sidePotRiverV1Game, hands);
  const node = sidePotRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.deepEqual(node.actions, ["check", "bet-30"]);
  assert.throws(() => sidePotRiverV1Game.nextAction(state, "bet-all-in"), /Illegal bet-all-in/);
});

test("a deep stack may choose either opening size", () => {
  const hands = sidePotRiverV1Game.deals[0].outcome.hands;
  const state = sidePotRiverState(sidePotRiverV1Game, hands, ["check"]);
  const node = sidePotRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") {
    assert.equal(node.player, 1);
    assert.deepEqual(node.actions, ["check", "bet-30", "bet-all-in"]);
  }
});

test("calling 60 costs the short stack only its remaining 30", () => {
  const hands = sidePotRiverV1Game.deals[0].outcome.hands;
  let state = sidePotRiverState(
    sidePotRiverV1Game,
    hands,
    ["check", "bet-all-in", "call"],
  );
  assert.equal(state.public.actingPlayer, 0);
  assert.equal(sidePotRiverV1Game.callCost(state, 0), 30);
  state = sidePotRiverV1Game.nextAction(state, "call");
  assert.equal(sidePotRiverV1Game.node(state).kind, "terminal");
  assert.deepEqual(state.public.streetContributions, [30, 60, 60]);
});

test("a short all-in player is skipped when a raise reopens action", () => {
  const hands = sidePotRiverV1Game.deals[0].outcome.hands;
  let state = sidePotRiverState(
    sidePotRiverV1Game,
    hands,
    ["bet-30", "call", "raise-all-in"],
  );
  const node = sidePotRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.equal(node.player, 1);
  state = sidePotRiverV1Game.nextAction(state, "call");
  assert.equal(sidePotRiverV1Game.node(state).kind, "terminal");
});

test("a raise is unavailable when no player with chips can answer it", () => {
  const hands = sidePotRiverV1Game.deals[0].outcome.hands;
  const state = sidePotRiverState(
    sidePotRiverV1Game,
    hands,
    ["bet-30", "fold"],
  );
  const node = sidePotRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.deepEqual(node.actions, ["fold", "call"]);
});

test("the short stack can win the main pot while a deep stack wins the side pot", () => {
  const hands = [
    ["As", "Qs"],
    ["Kd", "Qd"],
    ["4h", "4d"],
  ] as const;
  const state = sidePotRiverState(
    sidePotRiverV1Game,
    hands,
    ["bet-30", "raise-all-in", "call"],
  );
  const settlement = sidePotRiverV1Game.settlement(state);
  assert.deepEqual(settlement.contributions, [60, 90, 90]);
  assert.deepEqual(settlement.returnedUncalled, [0, 0, 0]);
  assert.equal(settlement.contestablePot, 240);
  assert.deepEqual(settlement.potLayers.map(layer => ({
    amount: layer.amount,
    eligible: layer.eligiblePlayers,
    winners: layer.winners,
    awards: layer.awards,
  })), [
    { amount: 180, eligible: [0, 1, 2], winners: [0], awards: [180, 0, 0] },
    { amount: 60, eligible: [1, 2], winners: [2], awards: [0, 0, 60] },
  ]);
  assert.deepEqual(settlement.utility, [120, -90, -30]);
});

test("an unmatched part of a raise is returned before pots are built", () => {
  const hands = sidePotRiverV1Game.deals[0].outcome.hands;
  const state = sidePotRiverState(
    sidePotRiverV1Game,
    hands,
    ["bet-30", "raise-all-in", "fold"],
  );
  const settlement = sidePotRiverV1Game.settlement(state);
  assert.deepEqual(settlement.contributions, [60, 90, 30]);
  assert.deepEqual(settlement.returnedUncalled, [0, 30, 0]);
  assert.equal(settlement.contestablePot, 150);
  assert.deepEqual(settlement.potLayers.map(layer => layer.amount), [90, 60]);
});

test("a board tie splits each pot only among players eligible for it", () => {
  const game = createSidePotRiverGame({
    ...sidePotRiverV1Game.scenario,
    id: "three-player-side-pot-tie-test",
    board: ["As", "Ks", "Qs", "Js", "Ts"],
    ranges: [
      [{ cards: ["3c", "2d"], weight: 1 }],
      [{ cards: ["5c", "4d"], weight: 1 }],
      [{ cards: ["7c", "6d"], weight: 1 }],
    ],
  });
  const state = sidePotRiverState(
    game,
    game.deals[0].outcome.hands,
    ["bet-30", "raise-all-in", "call"],
  );
  const settlement = game.settlement(state);
  assert.deepEqual(settlement.potLayers[0].awards, [60, 60, 60]);
  assert.deepEqual(settlement.potLayers[1].awards, [0, 30, 30]);
  assert.deepEqual(settlement.totalAwards, [60, 90, 90]);
  assert.deepEqual(settlement.utility, [0, 0, 0]);
});

test("side-pot information sets expose only the acting player's cards", () => {
  const ownHand = sidePotRiverV1Game.scenario.ranges[1][0].cards;
  const deals = sidePotRiverV1Game.deals.map(deal => deal.outcome.hands)
    .filter(hands => hands[1].join("") === ownHand.join(""));
  assert.ok(deals.length > 1);
  const keys = deals.map(hands => {
    const state = sidePotRiverState(sidePotRiverV1Game, hands, ["bet-30"]);
    return sidePotRiverV1Game.informationSet(state, 1);
  });
  assert.equal(new Set(keys).size, 1);
  for (const hands of deals) {
    assert.ok(!keys[0].includes(hands[0].join("")));
    assert.ok(!keys[0].includes(hands[2].join("")));
  }
});

test("side-pot v1 rejects different stack or wager rules", () => {
  assert.throws(() => createSidePotRiverGame({
    ...sidePotRiverV1Game.scenario,
    id: "bad-side-pot-stacks",
    stackBehind: [31, 60, 60],
  }), /locks remaining stacks at 30,60,60/);
  assert.throws(() => createSidePotRiverGame({
    ...sidePotRiverV1Game.scenario,
    id: "bad-side-pot-size",
    allInBet: 59 as 60,
  }), /locks nominal wagers at 30 and 60/);
});
