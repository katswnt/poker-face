import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMultiwayGameTreeIndex,
  uniformMultiwayStrategy,
} from "../src/lib/solver/multiway/game";
import { riverCombosOverlap } from "../src/lib/solver/river/cards";
import { sidePotRiverV1Game } from "../src/lib/solver/multiway/side-pot-fixture";
import {
  explainSidePotRiverAction,
  SIDE_POT_PLAIN_RULE,
  SIDE_POT_RIVER_METHOD_NOTE,
} from "../src/lib/solver/multiway/side-pot-language";
import { sidePotRiverDecisionFacts } from "../src/lib/solver/multiway/side-pot-teaching";

const index = buildMultiwayGameTreeIndex(sidePotRiverV1Game);
const decisions = sidePotRiverDecisionFacts(sidePotRiverV1Game, uniformMultiwayStrategy(index));

function closeToOne(values: readonly number[]): void {
  assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-9);
}

test("side-pot teaching data keeps exact joint opponent ranges", () => {
  assert.equal(decisions.length, 150);
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

test("every side-pot action reconciles current money, outcomes, layers, and awards", () => {
  for (const decision of decisions) {
    closeToOne(decision.actions.map(action => action.frequency));
    assert.equal(
      decision.callCost,
      Math.max(0, Math.min(
        decision.currentBet - (decision.contributions[decision.player] - 30),
        decision.remainingStacks[decision.player],
      )),
    );
    for (const action of decision.actions) {
      assert.notEqual(action.expectedValue, null);
      assert.notEqual(action.expectedAdditionalValue, null);
      assert.notEqual(action.expectedAdditionalContribution, null);
      assert.notEqual(action.differenceFromBest, null);
      assert.notEqual(action.expectedReturnedUncalled, null);
      assert.notEqual(action.expectedContestablePot, null);
      closeToOne([
        action.outcomes.playerFolds ?? 0,
        action.outcomes.allOpponentsFold ?? 0,
        action.outcomes.showdownWinsEveryEligiblePot ?? 0,
        action.outcomes.showdownWinsSomeEligiblePots ?? 0,
        action.outcomes.showdownWinsNoPot ?? 0,
      ]);
      const expectedLayerTotal = action.expectedPotLayers.reduce(
        (sum, layer) => sum + (layer.expectedAmount ?? 0),
        0,
      );
      assert.ok(Math.abs(expectedLayerTotal - (action.expectedContestablePot ?? 0)) <= 1e-9);
      const expectedAwards = action.expectedPotLayers.reduce(
        (sum, layer) => sum + (layer.expectedAward ?? 0),
        0,
      );
      assert.ok(Math.abs(
        expectedAwards + (action.expectedReturnedUncalled ?? 0) -
        (action.expectedAdditionalContribution ?? 0) -
        (action.expectedAdditionalValue ?? 0),
      ) <= 1e-9);
      for (const layer of action.expectedPotLayers) {
        assert.ok((layer.existsProbability ?? -1) >= -1e-9 && (layer.existsProbability ?? 2) <= 1 + 1e-9);
        assert.ok((layer.playerEligibilityProbability ?? -1) >= -1e-9);
        assert.ok((layer.playerEligibilityProbability ?? 2) <= (layer.existsProbability ?? -1) + 1e-9);
        assert.ok((layer.expectedAmountPlayerCanContest ?? -1) >= 0);
        assert.ok((layer.expectedAmountPlayerCanContest ?? Infinity) <= (layer.expectedAmount ?? -1) + 1e-9);
        assert.ok((layer.expectedAward ?? -1) >= 0);
        if (
          (layer.expectedAward ?? Infinity) >
            (layer.expectedAmountPlayerCanContest ?? -1) + 1e-9
        ) {
          throw new Error(JSON.stringify({
            informationSet: decision.informationSet,
            action: action.action,
            layer,
          }));
        }
      }
      if (action.action === "fold") {
        assert.ok(Math.abs(action.expectedAdditionalValue ?? 1) <= 1e-9);
      }
    }
  }
});

test("the short stack's teaching data ties side-pot eligibility to chips paid", () => {
  const root = decisions.find(decision => decision.player === 0 && decision.history.length === 0);
  assert.ok(root);
  const bet = root.actions.find(action => action.action === "bet-30");
  assert.ok(bet);
  const side = bet.expectedPotLayers.find(layer => layer.layer === "side-1");
  assert.ok(side);
  // Betting 30 puts the short stack all in, so a real side pot (deep stacks raising and
  // calling above it) exists sometimes but is never theirs to win. Dead money a folder
  // leaves behind stays in the main pot and is not counted as a side pot.
  assert.ok((side.existsProbability ?? 0) > 0);
  assert.equal(side.playerEligibilityProbability, 0);
  assert.match(explainSidePotRiverAction(root, bet), /cannot win that side pot because they did not pay enough/);
});

test("a short all-in call records its real 30-chip price", () => {
  const decision = decisions.find(fact =>
    fact.player === 0 && fact.history.join("-") === "check-bet-all-in-call");
  assert.ok(decision);
  assert.equal(decision.currentBet, 60);
  assert.equal(decision.callCost, 30);
  const call = decision.actions.find(action => action.action === "call");
  assert.ok(call);
  assert.match(explainSidePotRiverAction(decision, call), /Calling costs 30 chips here/);
});

test("folding never charges old contributions a second time", () => {
  for (const decision of decisions) {
    const fold = decision.actions.find(action => action.action === "fold");
    if (!fold) continue;
    assert.ok(Math.abs(fold.expectedAdditionalValue ?? 1) <= 1e-9);
  }
});

test("plain side-pot language is honest about the rule and method", () => {
  assert.match(SIDE_POT_PLAIN_RULE, /main pot.*side pot.*only if they paid enough/i);
  assert.match(SIDE_POT_RIVER_METHOD_NOTE, /approximation, not exact GTO or general poker advice/);
  assert.doesNotMatch(SIDE_POT_PLAIN_RULE, /exploitability|Nash|counterfactual/i);
});
