import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMultiwayStrategy } from "../src/lib/solver/multiway/best-response";
import { solveMultiwayCfr } from "../src/lib/solver/multiway/cfr";
import { twoSizeRiverV1Game } from "../src/lib/solver/multiway/two-size-fixture";
import { auditTwoSizeRiverIndependentChecks } from "../src/lib/solver/multiway/two-size-independent-node";

test("the two-size scalable best response matches exhaustive pure strategies", () => {
  const audit = auditTwoSizeRiverIndependentChecks();
  assert.equal(audit.reducedBestResponse.compatibleDeals, 1);
  assert.equal(audit.reducedBestResponse.profile, "uniform");
  assert.deepEqual(audit.reducedBestResponse.pureStrategiesChecked, [82_944, 82_944, 82_944]);
  assert.ok(audit.reducedBestResponse.maximumValueDifference <= 1e-9);
});

test("the two-size best response cannot inspect hidden opponent cards", () => {
  const audit = auditTwoSizeRiverIndependentChecks();
  assert.ok(audit.hiddenInformationBoundary.cheatingAdvantage > 0.01);
});

test("the two-size milestone leaves every earlier accepted artifact intact", () => {
  const audit = auditTwoSizeRiverIndependentChecks();
  assert.equal(audit.priorArtifacts.noRaiseHashValid, true);
  assert.equal(audit.priorArtifacts.raisedHashValid, true);
  assert.equal(audit.priorArtifacts.headsUpHashValid, true);
});

test("a short two-size solve is deterministic and zero-sum", () => {
  const left = solveMultiwayCfr(twoSizeRiverV1Game, { iterations: 128 });
  const right = solveMultiwayCfr(twoSizeRiverV1Game, { iterations: 128 });
  assert.deepEqual([...left.averageStrategy], [...right.averageStrategy]);
  const value = evaluateMultiwayStrategy(twoSizeRiverV1Game, left.averageStrategy, left.index);
  assert.ok(Math.abs(value.reduce((sum, playerValue) => sum + playerValue, 0)) <= 1e-9);
});
