import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMultiwayGameTreeIndex,
  uniformMultiwayStrategy,
} from "../src/lib/solver/multiway/game";
import { fourPlayerRiverV1Game } from "../src/lib/solver/multiway/four-player-fixture";
import {
  explainFourPlayerAction,
  FOUR_PLAYER_METHOD_NOTE,
  FOUR_PLAYER_PLAIN_RULE,
} from "../src/lib/solver/multiway/four-player-language";
import { fourPlayerDecisionFacts } from "../src/lib/solver/multiway/four-player-teaching";
import { riverCombosOverlap } from "../src/lib/solver/river/cards";

const index = buildMultiwayGameTreeIndex(fourPlayerRiverV1Game);
const decisions = fourPlayerDecisionFacts(fourPlayerRiverV1Game, uniformMultiwayStrategy(index));

function closeToOne(values: readonly number[]): void {
  assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-9);
}

test("four-player teaching data keeps exact joint opponent ranges", () => {
  assert.equal(decisions.length, 128);
  for (const decision of decisions) {
    assert.equal(decision.playerCount, 4);
    assert.equal(decision.offPath, false);
    closeToOne(decision.jointOpponentRange.map(entry => entry.probability ?? 0));
    for (const entry of decision.jointOpponentRange) {
      assert.equal(entry.hands.length, 3);
      for (const hand of entry.hands) {
        assert.ok(!riverCombosOverlap(decision.privateCards, hand.cards));
      }
      for (let left = 0; left < entry.hands.length; left += 1) {
        for (let right = left + 1; right < entry.hands.length; right += 1) {
          assert.ok(!riverCombosOverlap(entry.hands[left].cards, entry.hands[right].cards));
        }
      }
    }
    for (const opponent of [0, 1, 2, 3].filter(player => player !== decision.player)) {
      closeToOne(decision.opponentMarginals
        .filter(entry => entry.player === opponent)
        .map(entry => entry.probability ?? 0));
    }
  }
});

test("every four-player action reconciles current money, future cost, and outcomes", () => {
  for (const decision of decisions) {
    closeToOne(decision.actions.map(action => action.frequency));
    assert.equal(decision.callCost, decision.history.includes("bet-30") ? 30 : 0);
    for (const action of decision.actions) {
      assert.notEqual(action.expectedValue, null);
      assert.notEqual(action.expectedAdditionalValue, null);
      assert.notEqual(action.expectedAdditionalContribution, null);
      assert.notEqual(action.differenceFromBest, null);
      assert.notEqual(action.expectedPot, null);
      assert.notEqual(action.expectedAward, null);
      closeToOne([
        action.outcomes.playerFolds ?? 0,
        action.outcomes.allOpponentsFold ?? 0,
        action.outcomes.showdownWin ?? 0,
        action.outcomes.showdownSplit ?? 0,
        action.outcomes.showdownLoss ?? 0,
      ]);
      assert.ok(Math.abs(
        (action.expectedAward ?? 0) -
        (action.expectedAdditionalContribution ?? 0) -
        (action.expectedAdditionalValue ?? 0),
      ) <= 1e-9);
      if (action.outcomes.reachesShowdown && action.outcomes.reachesShowdown > 1e-12) {
        assert.ok((action.showdownEquity ?? -1) >= 0);
        assert.ok((action.showdownEquity ?? 2) <= 1);
      }
      if (action.action === "fold") {
        assert.ok(Math.abs(action.expectedAdditionalValue ?? 1) <= 1e-9);
      }
      if (action.action === "call") {
        assert.ok(Math.abs((action.expectedAdditionalContribution ?? 0) - 30) <= 1e-9);
      }
    }
  }
});

test("four-player copy states the player count and the limited method plainly", () => {
  const root = decisions.find(decision => decision.player === 0 && decision.history.length === 0);
  assert.ok(root);
  const bet = root.actions.find(action => action.action === "bet-30");
  assert.ok(bet);
  assert.match(explainFourPlayerAction(root, bet), /four-player calculation: 4 players are active/i);
  assert.match(FOUR_PLAYER_PLAIN_RULE, /fourth player.*another possible hand.*another possible source of chips/i);
  assert.match(FOUR_PLAYER_METHOD_NOTE, /approximation, not exact GTO or general poker advice/i);
  assert.doesNotMatch(FOUR_PLAYER_PLAIN_RULE, /exploitability|Nash|counterfactual/i);
});
