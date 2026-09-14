import { test } from "node:test";
import assert from "node:assert/strict";
import artifactData from "../src/lib/solver/river/artifacts/river-v1.json" with { type: "json" };
import type { RiverSolveArtifact } from "../src/lib/solver/river/artifact";
import { explainRiverAction } from "../src/lib/solver/river/language";

const artifact = artifactData as unknown as RiverSolveArtifact;

test("river explanations use plain words and only numbers from the audited facts", () => {
  const decision = artifact.decisions.find(candidate =>
    candidate.player === 0 && candidate.privateCards.join("") === "7h6h" && candidate.history.length === 0
  );
  assert.ok(decision);
  const action = decision.actions.find(candidate => candidate.action === "bet-pot");
  assert.ok(action?.expectedAdditionalValue !== null && action?.differenceFromBest !== null);
  const explanation = explainRiverAction(decision, "bet-pot");
  assert.equal(explanation.choice, "bet the full pot");
  assert.match(explanation.frequency, /saved strategy bets the full pot about 41\.8%/);
  assert.match(explanation.resultFromNow, /gains about 0\.16 chips on average/);
  assert.match(explanation.comparison, /within one hundredth of a chip/);
  assert.match(explanation.immediateResponse ?? "", /fold|call|raise/);
  assert.match(explanation.accuracy, /approximate saved strategy, not exact GTO/);
  assert.match(explanation.scope, /only to this saved two-player river example/);
  assert.doesNotMatch(Object.values(explanation).join(" "), /counterfactual|posterior|Nash gap/);
});

test("fold copy says the current choice breaks even instead of recharging sunk chips", () => {
  const decision = artifact.decisions.find(candidate =>
    candidate.player === 0 && candidate.privateCards.join("") === "7h6h" &&
    candidate.history.join("-") === "check-bet-half"
  );
  assert.ok(decision);
  const explanation = explainRiverAction(decision, "fold");
  assert.match(explanation.resultFromNow, /breaks even/);
  assert.doesNotMatch(explanation.resultFromNow, /loses 50/);
});

test("off-path copy withholds unreliable values", () => {
  const source = artifact.decisions[0];
  const offPath = {
    ...source,
    reachProbability: 0,
    offPath: true,
    actions: source.actions.map(action => ({
      ...action,
      expectedValue: null,
      expectedAdditionalValue: null,
      differenceFromBest: null,
      immediateOpponentResponses: [],
      immediateOpponentFoldProbability: null,
      showdownEquity: null,
      outcomes: {
        playerFolds: null,
        opponentFolds: null,
        showdownWin: null,
        showdownSplit: null,
        showdownLoss: null,
      },
    })),
  };
  const explanation = explainRiverAction(offPath, offPath.actions[0].action);
  assert.match(explanation.resultFromNow, /not reached often enough/);
  assert.match(explanation.comparison, /not enough on-path evidence/);
  assert.equal(explanation.showdown, null);
  assert.equal(explanation.immediateResponse, null);
});
