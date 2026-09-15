import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMultiwayStrategy } from "../src/lib/solver/multiway/best-response";
import { solveMultiwayCfr } from "../src/lib/solver/multiway/cfr";
import { raisedRiverV1Game } from "../src/lib/solver/multiway/raised-fixture";
import { auditRaisedRiverIndependentChecks } from "../src/lib/solver/multiway/raised-independent-node";

test("raised scalable best responses match exhaustive information-set choices", () => {
  const audit = auditRaisedRiverIndependentChecks();
  assert.equal(audit.reducedBestResponse.compatibleDeals, 1);
  assert.equal(audit.reducedBestResponse.profilesChecked, 3);
  assert.deepEqual(audit.reducedBestResponse.pureStrategiesChecked, [6_912, 6_912, 6_912]);
  assert.ok(audit.reducedBestResponse.maximumValueDifference <= 1e-9);
});

test("raised best responses cannot inspect hidden opponent hands", () => {
  const audit = auditRaisedRiverIndependentChecks();
  assert.ok(audit.hiddenInformationBoundary.cheatingAdvantage > 0.01);
});

test("adding a raise leaves both earlier accepted artifacts intact", () => {
  const audit = auditRaisedRiverIndependentChecks();
  assert.equal(audit.priorArtifacts.stageOneHashValid, true);
  assert.equal(audit.priorArtifacts.headsUpHashValid, true);
});

test("a short raised solve is deterministic and stays zero-sum", () => {
  const left = solveMultiwayCfr(raisedRiverV1Game, { iterations: 128 });
  const right = solveMultiwayCfr(raisedRiverV1Game, { iterations: 128 });
  assert.deepEqual([...left.averageStrategy], [...right.averageStrategy]);
  const value = evaluateMultiwayStrategy(raisedRiverV1Game, left.averageStrategy, left.index);
  assert.ok(Math.abs(value.reduce((sum, playerValue) => sum + playerValue, 0)) <= 1e-9);
});
