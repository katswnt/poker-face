import assert from "node:assert/strict";
import test from "node:test";
import artifactData from "../src/lib/solver/multiway/artifacts/three-player-raised-river-v1.json" with { type: "json" };
import {
  buildMultiwayGameTreeIndex,
  uniformMultiwayStrategy,
} from "../src/lib/solver/multiway/game";
import { explainRaisedRiverAction, RAISED_RIVER_METHOD_NOTE } from "../src/lib/solver/multiway/raised-language";
import { raisedRiverV1Game } from "../src/lib/solver/multiway/raised-fixture";
import { riverCombosOverlap } from "../src/lib/solver/river/cards";
import { raisedRiverDecisionFacts } from "../src/lib/solver/multiway/raised-teaching";
import type { RaisedRiverSolveArtifact } from "../src/lib/solver/multiway/raised-artifact";

const index = buildMultiwayGameTreeIndex(raisedRiverV1Game);
const uniform = uniformMultiwayStrategy(index);
const decisions = raisedRiverDecisionFacts(raisedRiverV1Game, uniform);
const artifact = artifactData as unknown as RaisedRiverSolveArtifact;

function closeToOne(values: readonly number[]): void {
  assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-9);
}

test("raised teaching data preserves exact compatible joint ranges", () => {
  assert.equal(decisions.length, 198);
  for (const decision of decisions) {
    assert.equal(decision.offPath, false);
    closeToOne(decision.jointOpponentRange.map(entry => entry.probability ?? 0));
    for (const entry of decision.jointOpponentRange) {
      assert.equal(entry.hands.length, 2);
      assert.ok(!riverCombosOverlap(decision.privateCards, entry.hands[0].cards));
      assert.ok(!riverCombosOverlap(decision.privateCards, entry.hands[1].cards));
      assert.ok(!riverCombosOverlap(entry.hands[0].cards, entry.hands[1].cards));
    }
    for (const opponent of [0, 1, 2].filter(player => player !== decision.player)) {
      closeToOne(decision.opponentMarginals
        .filter(entry => entry.player === opponent)
        .map(entry => entry.probability ?? 0));
    }
  }
});

test("every raised action fact reconciles strategy, money, outcomes, returns, and pots", () => {
  for (const decision of decisions) {
    closeToOne(decision.actions.map(action => action.frequency));
    assert.equal(decision.toCall, decision.currentBet -
      (decision.contributions[decision.player] - raisedRiverV1Game.scenario.committed[decision.player]));
    for (const action of decision.actions) {
      assert.notEqual(action.expectedValue, null);
      assert.notEqual(action.expectedAdditionalValue, null);
      assert.notEqual(action.differenceFromBest, null);
      assert.notEqual(action.expectedReturnedUncalled, null);
      assert.notEqual(action.expectedContestablePot, null);
      assert.ok((action.expectedReturnedUncalled ?? -1) >= -1e-9);
      assert.ok((action.expectedContestablePot ?? -1) >= 90 - 1e-9);
      closeToOne([
        action.outcomes.playerFolds ?? 0,
        action.outcomes.allOpponentsFold ?? 0,
        action.outcomes.showdownWin ?? 0,
        action.outcomes.showdownSplit ?? 0,
        action.outcomes.showdownLoss ?? 0,
      ]);
      if (action.showdownEquity !== null) {
        assert.ok(action.showdownEquity >= 0 && action.showdownEquity <= 1);
      }
      if (action.action === "fold") {
        assert.ok(Math.abs(action.expectedAdditionalValue ?? 1) <= 1e-9);
      }
    }
  }
});

test("folding after an earlier call costs nothing new at that decision", () => {
  const decision = decisions.find(fact =>
    fact.player === 1 && fact.history.join("-") === "bet-call-raise-all-in-call");
  assert.ok(decision);
  assert.equal(decision.toCall, 30);
  assert.equal(decision.contributions[1], 60);
  const fold = decision.actions.find(action => action.action === "fold");
  assert.ok(fold);
  assert.ok(Math.abs(fold.expectedAdditionalValue ?? 1) <= 1e-9);
  assert.ok(Math.abs((fold.expectedValue ?? 0) + 60) <= 1e-9);
});

test("teaching facts keep returned chips separate from the pot people can win", () => {
  const decision = decisions.find(fact =>
    fact.player === 0 && fact.history.join("-") === "bet-fold-raise-all-in");
  assert.ok(decision);
  const fold = decision.actions.find(action => action.action === "fold");
  assert.ok(fold);
  assert.ok(Math.abs(fold.expectedReturnedUncalled ?? 1) <= 1e-9);
  assert.ok(Math.abs((fold.expectedContestablePot ?? 0) - 150) <= 1e-9);
});

test("plain language explains the reopen rule and labels the strategy honestly", () => {
  const decision = decisions.find(fact => fact.player === 1 && fact.history.join("-") === "bet");
  assert.ok(decision);
  const raise = decision.actions.find(action => action.action === "raise-all-in");
  assert.ok(raise);
  const copy = explainRaisedRiverAction(decision, raise);
  assert.match(copy, /asks every remaining player to match 60 river chips or fold/);
  assert.match(copy, /called 30 earlier may have to decide again/);
  assert.match(RAISED_RIVER_METHOD_NOTE, /approximation, not exact GTO/);
});

test("the saved artifact withholds fabricated facts on branches it never reaches", () => {
  const offPath = artifact.decisions.filter(decision => decision.offPath);
  assert.equal(offPath.length, 2);
  for (const decision of offPath) {
    for (const action of decision.actions) {
      assert.equal(action.expectedValue, null);
      assert.equal(action.expectedAdditionalValue, null);
      assert.equal(action.expectedReturnedUncalled, null);
      assert.equal(action.expectedContestablePot, null);
      assert.equal(action.showdownEquity, null);
      assert.deepEqual(action.immediateResponses, []);
    }
  }
});
