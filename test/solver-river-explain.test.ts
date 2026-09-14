import { test } from "node:test";
import assert from "node:assert/strict";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { buildGameTreeIndex, uniformStrategy } from "../src/lib/solver/toy/game";
import { riverDecisionFacts } from "../src/lib/solver/river/explain";
import { riverV1Game } from "../src/lib/solver/river/fixture";

const TOLERANCE = 1e-9;

function probabilitySum(values: readonly (number | null)[]): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

test("river teaching facts expose normalized ranges, responses, outcomes, and EVs", () => {
  const strategy = solveCfr(riverV1Game, { iterations: 40 }).averageStrategy;
  const decisions = riverDecisionFacts(riverV1Game, strategy);
  assert.equal(decisions.length, 64);

  for (const decision of decisions) {
    assert.ok(decision.reachProbability > 0);
    assert.equal(decision.offPath, false);
    assert.ok(Math.abs(
      decision.actions.reduce((sum, action) => sum + action.frequency, 0) - 1,
    ) < TOLERANCE);
    assert.ok(Math.abs(
      probabilitySum(decision.opponentRange.map(combo => combo.probability)) - 1,
    ) < TOLERANCE);
    assert.equal(
      Math.min(...decision.actions.map(action => action.differenceFromBest ?? Infinity)),
      0,
    );
    assert.equal(decision.pot, decision.contributions[0] + decision.contributions[1]);
    assert.equal(
      decision.toCall,
      Math.max(...decision.contributions) - decision.contributions[decision.player],
    );

    for (const action of decision.actions) {
      assert.notEqual(action.expectedValue, null);
      assert.notEqual(action.expectedAdditionalValue, null);
      assert.ok(Math.abs(
        action.expectedAdditionalValue! - action.expectedValue! -
        decision.contributions[decision.player]
      ) < TOLERANCE);
      assert.ok(Math.abs(probabilitySum(Object.values(action.outcomes)) - 1) < TOLERANCE);
      if (action.showdownEquity !== null) {
        assert.ok(action.showdownEquity >= 0 && action.showdownEquity <= 1);
      }
      if (action.immediateOpponentResponses.length > 0) {
        assert.ok(Math.abs(probabilitySum(
          action.immediateOpponentResponses.map(response => response.probability),
        ) - 1) < TOLERANCE);
        assert.equal(
          action.immediateOpponentFoldProbability,
          action.immediateOpponentResponses.find(response => response.action === "fold")?.probability ?? null,
        );
      } else {
        assert.equal(action.immediateOpponentFoldProbability, null);
      }
      if (action.action === "fold") {
        assert.ok(Math.abs(action.expectedAdditionalValue!) < TOLERANCE);
        assert.ok(Math.abs(action.outcomes.playerFolds! - 1) < TOLERANCE);
      }
    }
  }
});

test("physical blockers have zero posterior probability", () => {
  const strategy = uniformStrategy(buildGameTreeIndex(riverV1Game));
  const rootAsQs = riverDecisionFacts(riverV1Game, strategy).find(decision =>
    decision.player === 0 && decision.privateCards.join("") === "AsQs" && decision.history.length === 0
  );
  assert.ok(rootAsQs);
  assert.equal(rootAsQs.opponentRange.find(combo => combo.key === "AsJs")?.probability, 0);
  assert.ok(rootAsQs.opponentRange.every(combo => combo.probability !== null));
});

test("an observed action changes the opponent range by Bayes' rule", () => {
  const index = buildGameTreeIndex(riverV1Game);
  const strategy = new Map(uniformStrategy(index));
  const betHalfByHand: Readonly<Record<string, number>> = {
    AsJs: 0.8,
    Ts7s: 0.7,
    KdQd: 0.6,
    "8h8c": 0.5,
    "9c8c": 0.4,
    AcQc: 0.3,
    QdJd: 0.2,
    "6c5c": 0.1,
  };
  for (const definition of index.informationSets) {
    if (definition.player !== 1 || !definition.key.endsWith("history=check")) continue;
    const hand = definition.key.match(/hand=([^:]+)/)?.[1];
    if (!hand) throw new Error(`Could not parse river hand from ${definition.key}`);
    const betHalf = betHalfByHand[hand];
    strategy.set(definition.key, {
      actions: [...definition.actions],
      probabilities: [1 - betHalf, betHalf, 0],
    });
  }

  const decisions = riverDecisionFacts(riverV1Game, strategy);
  const before = decisions.find(decision =>
    decision.player === 0 && decision.privateCards.join("") === "KhQh" && decision.history.length === 0
  );
  const after = decisions.find(decision =>
    decision.player === 0 && decision.privateCards.join("") === "KhQh" &&
    decision.history.join("-") === "check-bet-half"
  );
  assert.ok(before && after);
  const beforeAsJs = before.opponentRange.find(combo => combo.key === "AsJs")!.probability!;
  const afterAsJs = after.opponentRange.find(combo => combo.key === "AsJs")!.probability!;
  const beforeSixFive = before.opponentRange.find(combo => combo.key === "6c5c")!.probability!;
  const afterSixFive = after.opponentRange.find(combo => combo.key === "6c5c")!.probability!;
  assert.ok(afterAsJs > beforeAsJs);
  assert.ok(afterSixFive < beforeSixFive);
  assert.ok(Math.abs(probabilitySum(after.opponentRange.map(combo => combo.probability)) - 1) < TOLERANCE);
});

test("unreachable river decisions are marked off-path instead of inventing advice", () => {
  const index = buildGameTreeIndex(riverV1Game);
  const strategy = new Map(uniformStrategy(index));
  for (const definition of index.informationSets) {
    if (definition.player === 0 && definition.key.endsWith("history=start")) {
      strategy.set(definition.key, {
        actions: [...definition.actions],
        probabilities: [0, 0.5, 0.5],
      });
    }
  }
  const decisions = riverDecisionFacts(riverV1Game, strategy);
  const afterCheck = decisions.filter(decision => decision.history[0] === "check");
  assert.ok(afterCheck.length > 0);
  for (const decision of afterCheck) {
    assert.equal(decision.reachProbability, 0);
    assert.equal(decision.offPath, true);
    assert.ok(decision.opponentRange.every(combo => combo.probability === null));
    assert.ok(decision.actions.every(action =>
      action.expectedValue === null &&
      action.expectedAdditionalValue === null &&
      action.differenceFromBest === null &&
      action.immediateOpponentFoldProbability === null &&
      action.showdownEquity === null &&
      action.immediateOpponentResponses.length === 0 &&
      Object.values(action.outcomes).every(probability => probability === null)
    ));
  }
});
