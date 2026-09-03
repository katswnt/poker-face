import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGameTreeIndex, type Utility } from "../src/lib/solver/toy/game";
import {
  LEDUC_CARDS,
  LEDUC_COMPLETE_DEALS,
  LEDUC_PRIVATE_DEALS,
  LEDUC_RANKS,
  leducContributions,
  leducGame,
  leducRank,
  leducShowdownWinner,
  leducState,
  type LeducStateInput,
} from "../src/lib/solver/toy/leduc";

function terminalUtility(input: LeducStateInput): Utility {
  const node = leducGame.node(leducState(input));
  assert.equal(node.kind, "terminal");
  if (node.kind !== "terminal") throw new Error("Expected terminal Leduc state");
  return node.utility;
}

function actionNode(input: LeducStateInput) {
  const node = leducGame.node(leducState(input));
  assert.equal(node.kind, "player");
  if (node.kind !== "player") throw new Error("Expected Leduc player node");
  return node;
}

test("Leduc v1 has two physical copies of each rank and 120 complete deals", () => {
  assert.equal(LEDUC_CARDS.length, 6);
  assert.equal(new Set(LEDUC_CARDS).size, 6);
  for (const rank of LEDUC_RANKS) {
    assert.equal(LEDUC_CARDS.filter(card => leducRank(card) === rank).length, 2);
  }

  assert.equal(LEDUC_PRIVATE_DEALS.length, 30);
  assert.equal(
    new Set(LEDUC_PRIVATE_DEALS.map(deal => deal.cards.join(","))).size,
    30,
  );
  assert.ok(LEDUC_PRIVATE_DEALS.every(deal => deal.cards[0] !== deal.cards[1]));

  assert.equal(LEDUC_COMPLETE_DEALS.length, 120);
  assert.equal(
    new Set(LEDUC_COMPLETE_DEALS.map(deal => [...deal.cards, deal.board].join(","))).size,
    120,
  );
  assert.ok(LEDUC_COMPLETE_DEALS.every(deal => !deal.cards.includes(deal.board)));
});

test("Leduc chance probabilities exactly model private cards followed by the board", () => {
  const root = leducGame.node(leducGame.initialState());
  assert.equal(root.kind, "chance");
  if (root.kind !== "chance") throw new Error("Expected initial Leduc chance node");
  assert.equal(root.outcomes.length, 30);
  assert.ok(root.outcomes.every(outcome => outcome.probability === 1 / 30));
  assert.ok(Math.abs(root.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 1e-12);

  const completeDeals = new Set<string>();
  for (const privateOutcome of root.outcomes) {
    assert.equal(privateOutcome.outcome.kind, "private");
    if (privateOutcome.outcome.kind !== "private") throw new Error("Expected private deal");
    const state = leducState({
      privateCards: privateOutcome.outcome.cards,
      firstRound: ["check", "check"],
    });
    const boardNode = leducGame.node(state);
    assert.equal(boardNode.kind, "chance");
    if (boardNode.kind !== "chance") throw new Error("Expected Leduc board chance node");
    assert.equal(boardNode.outcomes.length, 4);
    assert.ok(boardNode.outcomes.every(outcome => outcome.probability === 1 / 4));

    for (const boardOutcome of boardNode.outcomes) {
      assert.equal(boardOutcome.outcome.kind, "board");
      if (boardOutcome.outcome.kind !== "board") throw new Error("Expected board deal");
      assert.equal(privateOutcome.probability * boardOutcome.probability, 1 / 120);
      completeDeals.add(
        [...privateOutcome.outcome.cards, boardOutcome.outcome.card].join(","),
      );
    }
  }
  assert.equal(completeDeals.size, 120);
});

test("Leduc v1 has the independently derived complete-tree shape", () => {
  const index = buildGameTreeIndex(leducGame);
  assert.deepEqual({
    totalStates: index.totalStates,
    chanceNodes: index.chanceNodes,
    decisionNodes: index.decisionNodes,
    terminalNodes: index.terminalNodes,
    informationSets: index.informationSets.length,
  }, {
    totalStates: 9_451,
    chanceNodes: 151,
    decisionNodes: 3_780,
    terminalNodes: 5_520,
    informationSets: 288,
  });

  const stateCounts = new Map<number, number>();
  for (const definition of index.informationSets) {
    stateCounts.set(definition.stateCount, (stateCounts.get(definition.stateCount) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries([...stateCounts.entries()].sort()), {
    8: 90,
    10: 18,
    16: 180,
  });
  assert.equal(index.informationSets.filter(definition => definition.player === 0).length, 144);
  assert.equal(index.informationSets.filter(definition => definition.player === 1).length, 144);
  assert.equal(index.informationSets.filter(definition => definition.actions.length === 2).length, 192);
  assert.equal(index.informationSets.filter(definition => definition.actions.length === 3).length, 96);
});

test("Leduc legal actions lock one opening bet and at most one raise per round", () => {
  assert.deepEqual(actionNode({ privateCards: ["J0", "K0"] }), {
    kind: "player",
    player: 0,
    actions: ["check", "bet"],
  });
  assert.deepEqual(actionNode({ privateCards: ["J0", "K0"], firstRound: ["check"] }), {
    kind: "player",
    player: 1,
    actions: ["check", "bet"],
  });
  assert.deepEqual(actionNode({ privateCards: ["J0", "K0"], firstRound: ["bet"] }), {
    kind: "player",
    player: 1,
    actions: ["fold", "call", "raise"],
  });
  assert.deepEqual(actionNode({ privateCards: ["J0", "K0"], firstRound: ["bet", "raise"] }), {
    kind: "player",
    player: 0,
    actions: ["fold", "call"],
  });
  assert.deepEqual(actionNode({
    privateCards: ["J0", "K0"],
    firstRound: ["check", "bet", "raise"],
  }), {
    kind: "player",
    player: 1,
    actions: ["fold", "call"],
  });
});

test("checking around or calling ends a round and player 0 opens both rounds", () => {
  const afterChecks = leducState({
    privateCards: ["J0", "K0"],
    firstRound: ["check", "check"],
  });
  assert.equal(afterChecks.round, 1);
  assert.equal(afterChecks.board, null);
  assert.equal(leducGame.node(afterChecks).kind, "chance");

  const afterCall = leducState({
    privateCards: ["J0", "K0"],
    firstRound: ["bet", "call"],
  });
  assert.equal(afterCall.round, 1);
  assert.equal(leducGame.node(afterCall).kind, "chance");

  const secondRound = actionNode({
    privateCards: ["J0", "K0"],
    firstRound: ["bet", "call"],
    board: "Q0",
  });
  assert.equal(secondRound.player, 0);
  assert.deepEqual(secondRound.actions, ["check", "bet"]);

  const showdown = leducGame.node(leducState({
    privateCards: ["J0", "K0"],
    firstRound: ["bet", "call"],
    board: "Q0",
    secondRound: ["check", "check"],
  }));
  assert.equal(showdown.kind, "terminal");
});

test("first-round bets cost one chip and second-round bets cost two", () => {
  assert.deepEqual(leducContributions(leducState({ privateCards: ["J0", "K0"] })), [1, 1]);
  assert.deepEqual(leducContributions(leducState({
    privateCards: ["J0", "K0"], firstRound: ["bet"],
  })), [2, 1]);
  assert.deepEqual(leducContributions(leducState({
    privateCards: ["J0", "K0"], firstRound: ["bet", "raise"],
  })), [2, 3]);
  assert.deepEqual(leducContributions(leducState({
    privateCards: ["J0", "K0"], firstRound: ["bet", "raise", "call"],
  })), [3, 3]);
  assert.deepEqual(leducContributions(leducState({
    privateCards: ["J0", "K0"],
    firstRound: ["check", "check"],
    board: "Q0",
    secondRound: ["bet"],
  })), [3, 1]);
  assert.deepEqual(leducContributions(leducState({
    privateCards: ["J0", "K0"],
    firstRound: ["check", "check"],
    board: "Q0",
    secondRound: ["bet", "raise"],
  })), [3, 5]);
  assert.deepEqual(leducContributions(leducState({
    privateCards: ["J0", "K0"],
    firstRound: ["bet", "raise", "call"],
    board: "Q0",
    secondRound: ["bet", "raise", "call"],
  })), [7, 7]);
});

test("Leduc showdown ranks a public-card pair above an unpaired higher card", () => {
  assert.equal(leducShowdownWinner(["J0", "K0"], "J1"), 0);
  assert.equal(leducShowdownWinner(["K0", "Q0"], "J0"), 0);
  assert.equal(leducShowdownWinner(["J0", "K0"], "Q0"), 1);
  assert.equal(leducShowdownWinner(["J0", "J1"], "Q0"), null);
});

test("Leduc terminal utility is net profit, handles folds and splits, and stays zero-sum", () => {
  assert.deepEqual(terminalUtility({
    privateCards: ["J0", "K0"], firstRound: ["bet", "fold"],
  }), [1, -1]);
  assert.deepEqual(terminalUtility({
    privateCards: ["K0", "J0"], firstRound: ["bet", "raise", "fold"],
  }), [-2, 2]);
  assert.deepEqual(terminalUtility({
    privateCards: ["J0", "K0"],
    firstRound: ["check", "check"],
    board: "J1",
    secondRound: ["check", "check"],
  }), [1, -1]);
  assert.deepEqual(terminalUtility({
    privateCards: ["J0", "J1"],
    firstRound: ["bet", "call"],
    board: "Q0",
    secondRound: ["bet", "call"],
  }), [0, 0]);
  assert.deepEqual(terminalUtility({
    privateCards: ["K0", "Q0"],
    firstRound: ["bet", "raise", "call"],
    board: "J0",
    secondRound: ["bet", "raise", "call"],
  }), [7, -7]);
});

test("Leduc information sets reveal ranks and public history but no hidden physical card", () => {
  const round0A = leducGame.informationSet(leducState({ privateCards: ["J0", "Q0"] }), 0);
  const round0B = leducGame.informationSet(leducState({ privateCards: ["J1", "K0"] }), 0);
  assert.equal(round0A, round0B, "opponent card and private copy must stay hidden");
  assert.notEqual(
    round0A,
    leducGame.informationSet(leducState({ privateCards: ["Q0", "J0"] }), 0),
    "own rank must change the information set",
  );

  const round1A = leducGame.informationSet(leducState({
    privateCards: ["J0", "K0"], firstRound: ["check", "check"], board: "Q0",
  }), 0);
  const round1B = leducGame.informationSet(leducState({
    privateCards: ["J1", "Q1"], firstRound: ["check", "check"], board: "Q0",
  }), 0);
  const round1OtherCopy = leducGame.informationSet(leducState({
    privateCards: ["J0", "K0"], firstRound: ["check", "check"], board: "Q1",
  }), 0);
  assert.equal(round1A, round1B, "opponent card must stay hidden after the board");
  assert.equal(round1A, round1OtherCopy, "the public physical copy has no strategic meaning");
  assert.notEqual(
    round1A,
    leducGame.informationSet(leducState({
      privateCards: ["J0", "K0"], firstRound: ["check", "check"], board: "K1",
    }), 0),
    "public rank must change the information set",
  );
  assert.notEqual(
    round1A,
    leducGame.informationSet(leducState({
      privateCards: ["J0", "K0"], firstRound: ["bet", "call"], board: "Q0",
    }), 0),
    "earlier public betting must remain visible",
  );
});

test("Leduc rejects colliding cards, illegal raises, wrong chance events, and post-terminal play", () => {
  assert.throws(
    () => leducState({ privateCards: ["J0", "J0"] }),
    /Illegal Leduc private cards/,
  );
  assert.throws(
    () => leducState({
      privateCards: ["J0", "K0"], firstRound: ["check", "check"], board: "J0",
    }),
    /Illegal Leduc board card/,
  );
  assert.throws(
    () => leducGame.nextChance(leducGame.initialState(), { kind: "board", card: "J0" }),
    /must contain private cards/,
  );
  assert.throws(
    () => leducGame.nextAction(leducState({ privateCards: ["J0", "K0"] }), "raise"),
    /Illegal Leduc action raise/,
  );
  assert.throws(
    () => leducGame.nextAction(leducState({
      privateCards: ["J0", "K0"], firstRound: ["bet", "raise"],
    }), "raise"),
    /Illegal Leduc action raise/,
  );
  assert.throws(
    () => leducGame.nextAction(leducState({
      privateCards: ["J0", "K0"], firstRound: ["bet", "fold"],
    }), "check"),
    /Cannot play check at a terminal/,
  );
  assert.throws(
    () => leducState({
      privateCards: ["J0", "K0"],
      firstRound: ["check", "check"],
      secondRound: ["check"],
    }),
    /require a board card/,
  );
});

test("every exported complete Leduc deal can reach a valid no-bet showdown", () => {
  for (const deal of LEDUC_COMPLETE_DEALS) {
    const utility = terminalUtility({
      privateCards: deal.cards,
      firstRound: ["check", "check"],
      board: deal.board,
      secondRound: ["check", "check"],
    });
    assert.equal(utility[0] + utility[1], 0);
    assert.ok(utility.every(value => Number.isFinite(value)));
  }
});
