import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGameTreeIndex } from "../src/lib/solver/toy/game";
import {
  KUHN_DEALS,
  KUHN_RANKS,
  kuhnGame,
  kuhnState,
  type KuhnAction,
  type KuhnRank,
} from "../src/lib/solver/toy/kuhn";

function utility(
  cards: readonly [KuhnRank, KuhnRank],
  history: readonly KuhnAction[],
): readonly [number, number] {
  const node = kuhnGame.node(kuhnState(cards, history));
  assert.equal(node.kind, "terminal");
  if (node.kind !== "terminal") throw new Error("Expected terminal Kuhn state");
  return node.utility;
}

test("Kuhn v1 has the locked complete-tree shape", () => {
  const index = buildGameTreeIndex(kuhnGame);
  assert.deepEqual({
    totalStates: index.totalStates,
    chanceNodes: index.chanceNodes,
    decisionNodes: index.decisionNodes,
    terminalNodes: index.terminalNodes,
    informationSets: index.informationSets.length,
  }, {
    totalStates: 55,
    chanceNodes: 1,
    decisionNodes: 24,
    terminalNodes: 30,
    informationSets: 12,
  });
  assert.ok(index.informationSets.every(definition => definition.stateCount === 2));
  assert.ok(index.informationSets.every(definition => definition.actions.length === 2));
});

test("Kuhn chance enumerates each ordered, non-colliding deal exactly once", () => {
  assert.equal(KUHN_DEALS.length, 6);
  assert.equal(new Set(KUHN_DEALS.map(deal => deal.cards.join(""))).size, 6);
  assert.ok(KUHN_DEALS.every(deal => deal.cards[0] !== deal.cards[1]));

  const node = kuhnGame.node(kuhnGame.initialState());
  assert.equal(node.kind, "chance");
  if (node.kind !== "chance") throw new Error("Expected Kuhn chance node");
  assert.equal(node.outcomes.length, 6);
  assert.ok(node.outcomes.every(outcome => outcome.probability === 1 / 6));
  assert.ok(Math.abs(node.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 1e-12);
});

test("Kuhn information sets hide only the opponent card", () => {
  const rootWithQueen = kuhnGame.informationSet(kuhnState(["J", "Q"]), 0);
  const rootWithKing = kuhnGame.informationSet(kuhnState(["J", "K"]), 0);
  assert.equal(rootWithQueen, rootWithKing, "opponent card must not change player 0's key");

  const differentOwnCard = kuhnGame.informationSet(kuhnState(["Q", "J"]), 0);
  assert.notEqual(rootWithQueen, differentOwnCard, "own card must change the key");

  const afterCheck = kuhnGame.informationSet(kuhnState(["Q", "J"], ["check"]), 1);
  const facingBet = kuhnGame.informationSet(kuhnState(["Q", "J"], ["bet"]), 1);
  assert.notEqual(afterCheck, facingBet, "public action history must change the key");
});

test("Kuhn legal actions and actors follow the locked tree", () => {
  const dealt = kuhnState(["J", "K"]);
  assert.deepEqual(kuhnGame.node(dealt), { kind: "player", player: 0, actions: ["check", "bet"] });
  assert.deepEqual(kuhnGame.node(kuhnGame.nextAction(dealt, "check")), {
    kind: "player",
    player: 1,
    actions: ["check", "bet"],
  });
  assert.deepEqual(kuhnGame.node(kuhnGame.nextAction(dealt, "bet")), {
    kind: "player",
    player: 1,
    actions: ["fold", "call"],
  });
  assert.deepEqual(kuhnGame.node(kuhnState(["J", "K"], ["check", "bet"])), {
    kind: "player",
    player: 0,
    actions: ["fold", "call"],
  });
});

test("Kuhn payoffs use net chips and are zero-sum", () => {
  assert.deepEqual(utility(["K", "J"], ["check", "check"]), [1, -1]);
  assert.deepEqual(utility(["J", "K"], ["check", "check"]), [-1, 1]);
  assert.deepEqual(utility(["J", "K"], ["bet", "fold"]), [1, -1]);
  assert.deepEqual(utility(["K", "J"], ["bet", "call"]), [2, -2]);
  assert.deepEqual(utility(["J", "K"], ["bet", "call"]), [-2, 2]);
  assert.deepEqual(utility(["K", "J"], ["check", "bet", "fold"]), [-1, 1]);
  assert.deepEqual(utility(["K", "J"], ["check", "bet", "call"]), [2, -2]);
});

test("all 30 Kuhn terminal states match the locked payoff table", () => {
  const showdownHistories = [
    { history: ["check", "check"] as const, stake: 1 as const },
    { history: ["bet", "call"] as const, stake: 2 as const },
    { history: ["check", "bet", "call"] as const, stake: 2 as const },
  ];

  let terminalsChecked = 0;
  for (const deal of KUHN_DEALS) {
    const player0Wins = KUHN_RANKS.indexOf(deal.cards[0]) > KUHN_RANKS.indexOf(deal.cards[1]);
    for (const { history, stake } of showdownHistories) {
      assert.deepEqual(
        utility(deal.cards, history),
        player0Wins ? [stake, -stake] : [-stake, stake],
      );
      terminalsChecked += 1;
    }
    assert.deepEqual(utility(deal.cards, ["bet", "fold"]), [1, -1]);
    assert.deepEqual(utility(deal.cards, ["check", "bet", "fold"]), [-1, 1]);
    terminalsChecked += 2;
  }
  assert.equal(terminalsChecked, 30);
});

test("Kuhn rejects illegal deals, actions, and actions after the hand ends", () => {
  assert.throws(
    () => kuhnGame.nextChance(kuhnGame.initialState(), { cards: ["J", "J"] }),
    /Illegal Kuhn deal/,
  );
  assert.throws(() => kuhnGame.nextAction(kuhnState(["J", "Q"]), "call"), /Illegal Kuhn action/);
  assert.throws(
    () => kuhnGame.nextAction(kuhnState(["J", "Q"], ["check", "check"]), "bet"),
    /Cannot play bet at a terminal/,
  );
});
