import assert from "node:assert/strict";
import test from "node:test";
import artifactData from "../src/lib/solver/multiway/artifacts/three-player-river-v1.json" with { type: "json" };
import type { MultiwaySolveArtifact } from "../src/lib/solver/multiway/artifact";
import { explainMultiwayAction, MULTIWAY_METHOD_NOTE } from "../src/lib/solver/multiway/language";
import { riverCombosOverlap } from "../src/lib/solver/river/cards";

const artifact = artifactData as unknown as MultiwaySolveArtifact;

function closeToOne(values: readonly number[]): void {
  assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-9);
}

test("every teaching posterior stays joint, compatible, and normalized", () => {
  assert.equal(artifact.decisions.length, 72);
  for (const decision of artifact.decisions) {
    assert.equal(decision.offPath, false);
    closeToOne(decision.jointOpponentRange.map(entry => entry.probability ?? 0));
    for (const entry of decision.jointOpponentRange) {
      assert.equal(entry.hands.length, 2);
      assert.ok(!riverCombosOverlap(decision.privateCards, entry.hands[0].cards));
      assert.ok(!riverCombosOverlap(decision.privateCards, entry.hands[1].cards));
      assert.ok(!riverCombosOverlap(entry.hands[0].cards, entry.hands[1].cards));
    }
    for (const opponent of [0, 1, 2].filter(player => player !== decision.player)) {
      const marginal = decision.opponentMarginals.filter(entry => entry.player === opponent);
      closeToOne(marginal.map(entry => entry.probability ?? 0));
    }
  }
});

test("every action fact reconciles frequencies, money, and outcomes", () => {
  for (const decision of artifact.decisions) {
    closeToOne(decision.actions.map(action => action.frequency));
    for (const action of decision.actions) {
      assert.notEqual(action.expectedValue, null);
      assert.notEqual(action.expectedAdditionalValue, null);
      assert.notEqual(action.differenceFromBest, null);
      const outcomes = action.outcomes;
      closeToOne([
        outcomes.playerFolds ?? 0,
        outcomes.allOpponentsFold ?? 0,
        outcomes.showdownWin ?? 0,
        outcomes.showdownSplit ?? 0,
        outcomes.showdownLoss ?? 0,
      ]);
      assert.ok(
        (outcomes.reachesShowdown ?? -1) >= -1e-9 &&
        (outcomes.reachesShowdown ?? 2) <= 1 + 1e-9,
      );
      if (action.showdownEquity !== null) {
        assert.ok(action.showdownEquity >= 0 && action.showdownEquity <= 1);
      }
      if (action.action === "fold") assert.ok(Math.abs(action.expectedAdditionalValue ?? 1) <= 1e-9);
    }
  }
});

test("plain-language explanations bind their numbers to structured facts", () => {
  const decision = artifact.decisions.find(fact => fact.history.length === 0 && fact.privateCards.join("") === "AsQs");
  assert.ok(decision);
  const bet = decision.actions.find(action => action.action === "bet");
  if (!bet || bet.expectedAdditionalValue === null || bet.differenceFromBest === null) {
    throw new Error("Expected an on-path bet fact");
  }
  const copy = explainMultiwayAction(decision, bet);
  assert.match(copy, new RegExp(Math.abs(bet.expectedAdditionalValue).toFixed(2)));
  assert.match(copy, /3 players are still in the hand/);
  assert.match(MULTIWAY_METHOD_NOTE, /approximation, not exact GTO/);
});

test("public actions update the joint range by Bayes' rule without erasing correlations", () => {
  const root = artifact.decisions.find(decision =>
    decision.player === 0 && decision.privateCards.join("") === "AsQs" && decision.history.length === 0);
  const afterActions = artifact.decisions.find(decision =>
    decision.player === 0 && decision.privateCards.join("") === "AsQs" &&
    decision.history.join("-") === "check-bet-call");
  assert.ok(root && afterActions);

  const rootPlayerOne = new Map(root.opponentMarginals
    .filter(entry => entry.player === 1)
    .map(entry => [entry.key, entry.probability ?? 0]));
  const updatedPlayerOne = new Map(afterActions.opponentMarginals
    .filter(entry => entry.player === 1)
    .map(entry => [entry.key, entry.probability ?? 0]));
  const largestUpdate = Math.max(...[...rootPlayerOne].map(([key, probability]) =>
    Math.abs(probability - (updatedPlayerOne.get(key) ?? 0))));
  assert.ok(largestUpdate > 0.01);

  const marginals = new Map(root.opponentMarginals.map(entry =>
    [`p${entry.player}:${entry.key}`, entry.probability ?? 0]));
  const largestCorrelation = Math.max(...root.jointOpponentRange.map(entry => {
    const independentProduct = entry.hands.reduce((product, hand) =>
      product * (marginals.get(`p${hand.player}:${hand.cards.join("")}`) ?? 0), 1);
    return Math.abs((entry.probability ?? 0) - independentProduct);
  }));
  assert.ok(largestCorrelation > 0.001);
});
