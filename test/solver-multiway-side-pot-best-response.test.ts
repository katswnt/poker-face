import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMultiwayStrategy } from "../src/lib/solver/multiway/best-response";
import { solveMultiwayCfr } from "../src/lib/solver/multiway/cfr";
import { auditSidePotIndependentChecks } from "../src/lib/solver/multiway/side-pot-independent-node";
import { sidePotRiverV1Game } from "../src/lib/solver/multiway/side-pot-fixture";

test("side-pot scalable best responses match exhaustive information-set choices", () => {
  const audit = auditSidePotIndependentChecks();
  assert.equal(audit.reducedBestResponse.compatibleDeals, 1);
  assert.deepEqual(audit.reducedBestResponse.pureStrategiesChecked, [256, 2_592, 864]);
  assert.ok(audit.reducedBestResponse.maximumValueDifference <= 1e-9);
});

test("the side-pot best response cannot inspect hidden opponent cards", () => {
  const boundary = auditSidePotIndependentChecks().hiddenInformationBoundary;
  assert.ok(boundary.cheatingStatewiseValue > boundary.honestBestResponseValue);
  assert.ok(boundary.cheatingAdvantage > 0.01);
});

test("the side-pot milestone leaves every earlier accepted artifact intact", () => {
  const prior = auditSidePotIndependentChecks().priorArtifacts;
  assert.equal(prior.noRaiseHashValid, true);
  assert.equal(prior.raisedHashValid, true);
  assert.equal(prior.twoSizeHashValid, true);
  assert.equal(prior.headsUpHashValid, true);
});

test("a short side-pot solve is deterministic and zero-sum", () => {
  const options = { iterations: 64, checkpointIterations: [16, 64] } as const;
  const first = solveMultiwayCfr(sidePotRiverV1Game, options);
  const second = solveMultiwayCfr(sidePotRiverV1Game, options);
  assert.deepEqual([...first.averageStrategy], [...second.averageStrategy]);
  const value = evaluateMultiwayStrategy(sidePotRiverV1Game, first.averageStrategy, first.index);
  assert.ok(Math.abs(value.reduce((sum, playerValue) => sum + playerValue, 0)) <= 1e-9);
});
