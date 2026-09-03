import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGameTreeIndex,
  uniformStrategy,
  validateStrategy,
  type BehavioralStrategy,
} from "../src/lib/solver/toy/game";
import {
  evaluateStrategy,
  exhaustiveBestResponse,
  gradeStrategy,
  pureStrategyCount,
} from "../src/lib/solver/toy/best-response";
import {
  kuhnGame,
  kuhnState,
  type KuhnAction,
  type KuhnRank,
} from "../src/lib/solver/toy/kuhn";

const index = buildGameTreeIndex(kuhnGame);

function exactEquilibrium(): BehavioralStrategy<KuhnAction> {
  const strategy = new Map(uniformStrategy(index));
  const set = (
    cards: readonly [KuhnRank, KuhnRank],
    history: readonly KuhnAction[],
    chosenAction: KuhnAction,
    probability: number,
  ) => {
    const state = kuhnState(cards, history);
    const node = kuhnGame.node(state);
    assert.equal(node.kind, "player");
    if (node.kind !== "player") throw new Error("Expected player node");
    const key = kuhnGame.informationSet(state, node.player);
    strategy.set(key, {
      actions: [...node.actions],
      probabilities: node.actions.map(action => action === chosenAction ? probability : 1 - probability),
    });
  };

  // Player 0 opens: J bluffs 1/3, Q checks, K value-bets.
  set(["J", "Q"], [], "bet", 1 / 3);
  set(["Q", "J"], [], "check", 1);
  set(["K", "J"], [], "bet", 1);
  // Player 0 after checking and facing a bet: J folds, Q calls 2/3, K calls.
  set(["J", "Q"], ["check", "bet"], "fold", 1);
  set(["Q", "J"], ["check", "bet"], "call", 2 / 3);
  set(["K", "J"], ["check", "bet"], "call", 1);
  // Player 1 after a check: J bluffs 1/3, Q checks, K value-bets.
  set(["Q", "J"], ["check"], "bet", 1 / 3);
  set(["J", "Q"], ["check"], "check", 1);
  set(["J", "K"], ["check"], "bet", 1);
  // Player 1 facing an opening bet: J folds, Q calls 1/3, K calls.
  set(["Q", "J"], ["bet"], "fold", 1);
  set(["J", "Q"], ["bet"], "call", 1 / 3);
  set(["J", "K"], ["bet"], "call", 1);

  validateStrategy(index, strategy);
  return strategy;
}

test("the exact Kuhn equilibrium has value -1/18 and zero exploitability", () => {
  const strategy = exactEquilibrium();
  const value = evaluateStrategy(kuhnGame, strategy, index);
  assert.ok(Math.abs(value[0] + 1 / 18) < 1e-12, `player 0 value ${value[0]}`);
  assert.ok(Math.abs(value[1] - 1 / 18) < 1e-12, `player 1 value ${value[1]}`);

  const grade = gradeStrategy(kuhnGame, strategy, index);
  assert.ok(grade.nashGap < 1e-12, `Nash gap ${grade.nashGap}`);
  assert.ok(grade.exploitability < 1e-12, `exploitability ${grade.exploitability}`);
  assert.equal(grade.bestResponses[0].pureStrategiesChecked, 64);
  assert.equal(grade.bestResponses[1].pureStrategiesChecked, 64);
});

test("each Kuhn player has exactly 64 pure information-set strategies", () => {
  for (const player of [0, 1] as const) {
    const definitions = index.informationSets.filter(definition => definition.player === player);
    assert.equal(definitions.length, 6);
    assert.equal(pureStrategyCount(definitions), 64);
  }
});

test("the exhaustive best response improves against an exploitable uniform profile", () => {
  const strategy = uniformStrategy(index);
  const value = evaluateStrategy(kuhnGame, strategy, index);
  const response0 = exhaustiveBestResponse(kuhnGame, strategy, 0, index);
  const response1 = exhaustiveBestResponse(kuhnGame, strategy, 1, index);
  assert.ok(response0.value >= value[0]);
  assert.ok(response1.value >= value[1]);

  const grade = gradeStrategy(kuhnGame, strategy, index);
  assert.ok(grade.nashGap > 0.1, `uniform Nash gap should be visible, got ${grade.nashGap}`);
  assert.equal(grade.exploitability, grade.nashGap / 2);
});

test("strategy validation rejects bad probabilities and missing information sets", () => {
  const missing = new Map(uniformStrategy(index));
  missing.delete(index.informationSets[0].key);
  assert.throws(() => validateStrategy(index, missing), /information sets/);

  const invalid = new Map(uniformStrategy(index));
  const definition = index.informationSets[0];
  invalid.set(definition.key, { actions: [...definition.actions], probabilities: [0.7, 0.7] });
  assert.throws(() => validateStrategy(index, invalid), /sum to/);
});

export { exactEquilibrium };
