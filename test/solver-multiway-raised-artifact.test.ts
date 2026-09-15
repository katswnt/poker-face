import assert from "node:assert/strict";
import test from "node:test";
import artifactData from "../src/lib/solver/multiway/artifacts/three-player-raised-river-v1.json" with { type: "json" };
import {
  deserializeRaisedRiverStrategy,
  serializeRaisedRiverStrategy,
  type RaisedRiverSolveArtifact,
} from "../src/lib/solver/multiway/raised-artifact";
import { verifyRaisedRiverArtifactHash } from "../src/lib/solver/multiway/raised-artifact-node";
import { gradeMultiwayStrategy } from "../src/lib/solver/multiway/best-response";
import { raisedRiverV1Game } from "../src/lib/solver/multiway/raised-fixture";

const artifact = artifactData as unknown as RaisedRiverSolveArtifact;

test("the raised artifact is hashed, current, and inside its locked gate", () => {
  assert.equal(verifyRaisedRiverArtifactHash(artifact), true);
  assert.equal(artifact.acceptance.passed, true);
  assert.ok(artifact.maximumUnilateralGain <= 0.45);
  assert.equal(artifact.qualityMeasure, "maximum-unilateral-gain");
  assert.equal(artifact.units, "net-chips-per-hand");
  assert.equal("exploitability" in artifact, false);
  assert.equal("nashGap" in artifact, false);
  assert.deepEqual(artifact.tree, {
    totalStates: 13_073,
    chanceNodes: 1,
    decisionNodes: 5_676,
    terminalNodes: 7_396,
    informationSets: 198,
    compatiblePrivateDeals: 172,
    terminalActionHistories: 43,
  });
});

test("the raised stored strategy independently reproduces each player's grade", () => {
  const strategy = deserializeRaisedRiverStrategy(artifact.strategy);
  assert.deepEqual(serializeRaisedRiverStrategy(strategy), artifact.strategy);
  const grade = gradeMultiwayStrategy(raisedRiverV1Game, strategy);
  assert.deepEqual(grade.value, artifact.value);
  assert.deepEqual(grade.bestResponses.map(response => response.value), artifact.bestResponseValue);
  assert.deepEqual(grade.unilateralGains, artifact.unilateralGains);
  assert.equal(grade.maximumUnilateralGain, artifact.maximumUnilateralGain);
  assert.ok(Math.abs(grade.value.reduce((sum, value) => sum + value, 0)) <= 1e-9);
});

test("the raised artifact records separate oracles and prior-artifact protection", () => {
  assert.deepEqual(artifact.rulesAudit, {
    dealsChecked: 172,
    terminalsChecked: 7_396,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumReturnedUncalledDifference: 0,
    maximumContestablePotDifference: 0,
    maximumZeroSumError: 0,
  });
  assert.equal(artifact.independentChecks.reducedBestResponse.maximumValueDifference, 0);
  assert.deepEqual(
    artifact.independentChecks.reducedBestResponse.pureStrategiesChecked,
    [6_912, 6_912, 6_912],
  );
  assert.equal(artifact.independentChecks.reducedBestResponse.profilesChecked, 3);
  assert.ok(artifact.independentChecks.hiddenInformationBoundary.cheatingAdvantage > 0.01);
  assert.equal(artifact.independentChecks.priorArtifacts.stageOneHashValid, true);
  assert.equal(artifact.independentChecks.priorArtifacts.headsUpHashValid, true);
});

test("raised convergence is measured without claiming it must be monotone", () => {
  assert.deepEqual(artifact.convergence.map(checkpoint => checkpoint.iteration), [
    256, 1_024, 4_096, 16_384, 65_536,
  ]);
  assert.ok(artifact.convergence[3].maximumUnilateralGain >
    artifact.convergence[2].maximumUnilateralGain);
  assert.equal(artifact.maximumUnilateralGain, 0.11443902461607536);
});

test("changing raised stored math invalidates the content hash", () => {
  assert.equal(verifyRaisedRiverArtifactHash({
    ...artifact,
    maximumUnilateralGain: artifact.maximumUnilateralGain + 0.001,
  }), false);
});
