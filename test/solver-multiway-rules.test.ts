import assert from "node:assert/strict";
import test from "node:test";
import { buildMultiwayGameTreeIndex } from "../src/lib/solver/multiway/game";
import { multiwayRiverV1Game } from "../src/lib/solver/multiway/fixture";
import { auditMultiwayRiverRules, MULTIWAY_RIVER_TERMINAL_HISTORIES } from "../src/lib/solver/multiway/oracle";

test("the locked three-player fixture has the specified exact tree", () => {
  const index = buildMultiwayGameTreeIndex(multiwayRiverV1Game);
  assert.equal(multiwayRiverV1Game.deals.length, 172);
  assert.deepEqual({
    totalStates: index.totalStates,
    chanceNodes: index.chanceNodes,
    decisionNodes: index.decisionNodes,
    terminalNodes: index.terminalNodes,
    informationSets: index.informationSets.length,
  }, {
    totalStates: 4_301,
    chanceNodes: 1,
    decisionNodes: 2_064,
    terminalNodes: 2_236,
    informationSets: 72,
  });
  assert.equal(MULTIWAY_RIVER_TERMINAL_HISTORIES.length, 13);
});

test("the separate oracle agrees on every deal and terminal", () => {
  assert.deepEqual(auditMultiwayRiverRules(multiwayRiverV1Game), {
    dealsChecked: 172,
    terminalsChecked: 2_236,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("an information set contains only the acting player's private hand", () => {
  const ownHand = multiwayRiverV1Game.scenario.ranges[0][0].cards;
  const deals = multiwayRiverV1Game.deals
    .map(deal => deal.outcome.hands)
    .filter(hands => hands[0].join("") === ownHand.join(""));
  assert.ok(deals.length > 1);
  const keys = deals.map(hands => {
    const state = multiwayRiverV1Game.nextChance(multiwayRiverV1Game.initialState(), { hands });
    return multiwayRiverV1Game.informationSet(state, 0);
  });
  assert.equal(new Set(keys).size, 1);
  assert.match(keys[0], new RegExp(`hand=${ownHand.join("")}`));
  for (const hands of deals) {
    assert.ok(!keys[0].includes(hands[1].join("")));
    assert.ok(!keys[0].includes(hands[2].join("")));
  }
});

test("a bet stays open until both other players answer in seat order", () => {
  const hands = multiwayRiverV1Game.deals[0].outcome.hands;
  let state = multiwayRiverV1Game.nextChance(multiwayRiverV1Game.initialState(), { hands });
  state = multiwayRiverV1Game.nextAction(state, "bet");
  let node = multiwayRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.equal(node.player, 1);
  state = multiwayRiverV1Game.nextAction(state, "call");
  node = multiwayRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.equal(node.player, 2);
  state = multiwayRiverV1Game.nextAction(state, "fold");
  node = multiwayRiverV1Game.node(state);
  assert.equal(node.kind, "terminal");
  assert.deepEqual(state.public.active, [true, true, false]);
  assert.deepEqual(multiwayRiverV1Game.totalContributions(state), [60, 60, 30]);
});

test("players who checked before a bet still receive a response turn", () => {
  const hands = multiwayRiverV1Game.deals[0].outcome.hands;
  let state = multiwayRiverV1Game.nextChance(multiwayRiverV1Game.initialState(), { hands });
  for (const action of ["check", "bet", "fold"] as const) {
    state = multiwayRiverV1Game.nextAction(state, action);
  }
  const node = multiwayRiverV1Game.node(state);
  assert.equal(node.kind, "player");
  if (node.kind === "player") assert.equal(node.player, 0);
});
