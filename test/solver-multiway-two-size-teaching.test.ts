import assert from "node:assert/strict";
import test from "node:test";
import artifactData from "../src/lib/solver/multiway/artifacts/three-player-two-size-river-v1.json" with { type: "json" };
import {
  buildMultiwayGameTreeIndex,
  uniformMultiwayStrategy,
} from "../src/lib/solver/multiway/game";
import { riverCombosOverlap } from "../src/lib/solver/river/cards";
import { twoSizeRiverV1Game } from "../src/lib/solver/multiway/two-size-fixture";
import {
  explainTwoSizeRiverAction,
  TWO_SIZE_RIVER_METHOD_NOTE,
} from "../src/lib/solver/multiway/two-size-language";
import { twoSizeRiverDecisionFacts } from "../src/lib/solver/multiway/two-size-teaching";
import type { TwoSizeRiverSolveArtifact } from "../src/lib/solver/multiway/two-size-artifact";

const index = buildMultiwayGameTreeIndex(twoSizeRiverV1Game);
const decisions = twoSizeRiverDecisionFacts(twoSizeRiverV1Game, uniformMultiwayStrategy(index));
const artifact = artifactData as unknown as TwoSizeRiverSolveArtifact;

function closeToOne(values: readonly number[]): void {
  assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-9);
}

test("two-size teaching data keeps exact joint opponent ranges", () => {
  assert.equal(decisions.length, 252);
  for (const decision of decisions) {
    assert.equal(decision.offPath, false);
    closeToOne(decision.jointOpponentRange.map(entry => entry.probability ?? 0));
    for (const entry of decision.jointOpponentRange) {
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

test("every two-size action fact reconciles money and outcomes", () => {
  for (const decision of decisions) {
    closeToOne(decision.actions.map(action => action.frequency));
    assert.equal(decision.toCall, decision.currentBet -
      (decision.contributions[decision.player] - twoSizeRiverV1Game.scenario.committed[decision.player]));
    for (const action of decision.actions) {
      assert.notEqual(action.expectedValue, null);
      assert.notEqual(action.expectedAdditionalValue, null);
      assert.notEqual(action.differenceFromBest, null);
      assert.notEqual(action.expectedReturnedUncalled, null);
      assert.notEqual(action.expectedContestablePot, null);
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

test("folding after calling the smaller bet costs nothing new", () => {
  const decision = decisions.find(fact =>
    fact.player === 1 && fact.history.join("-") === "bet-30-call-raise-all-in-call");
  assert.ok(decision);
  assert.equal(decision.toCall, 30);
  assert.equal(decision.contributions[1], 60);
  const fold = decision.actions.find(action => action.action === "fold");
  assert.ok(fold);
  assert.ok(Math.abs(fold.expectedAdditionalValue ?? 1) <= 1e-9);
  assert.ok(Math.abs((fold.expectedValue ?? 0) + 60) <= 1e-9);
});

test("all-in teaching facts separate expected returns from the contestable pot", () => {
  const root = decisions.find(decision => decision.player === 0 && decision.history.length === 0);
  assert.ok(root);
  const allIn = root.actions.find(action => action.action === "bet-all-in");
  assert.ok(allIn);
  assert.ok(Math.abs((allIn.expectedReturnedUncalled ?? 0) - 15) <= 1e-9);
  assert.ok(Math.abs((allIn.expectedContestablePot ?? 0) - 195) <= 1e-9);
});

test("plain language distinguishes the two sizes and keeps the method honest", () => {
  const root = decisions.find(decision => decision.player === 0 && decision.history.length === 0);
  assert.ok(root);
  const small = root.actions.find(action => action.action === "bet-30");
  const allIn = root.actions.find(action => action.action === "bet-all-in");
  assert.ok(small && allIn);
  assert.match(explainTwoSizeRiverAction(root, small), /risks less and leaves room.*raise/);
  assert.match(explainTwoSizeRiverAction(root, allIn), /whole remaining stack.*nobody can raise again/);
  assert.match(TWO_SIZE_RIVER_METHOD_NOTE, /approximation, not exact GTO or general poker advice/);
});

test("every saved two-size decision has measured facts or is explicitly withheld", () => {
  assert.equal(artifact.decisions.length, 252);
  for (const decision of artifact.decisions) {
    for (const action of decision.actions) {
      if (decision.offPath) {
        assert.equal(action.expectedValue, null);
        assert.equal(action.expectedAdditionalValue, null);
        assert.equal(action.expectedReturnedUncalled, null);
      } else {
        assert.notEqual(action.expectedValue, null);
        assert.notEqual(action.expectedAdditionalValue, null);
        assert.notEqual(action.expectedReturnedUncalled, null);
      }
    }
  }
});
