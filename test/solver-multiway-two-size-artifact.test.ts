import assert from "node:assert/strict";
import test from "node:test";
import artifactData from "../src/lib/solver/multiway/artifacts/three-player-two-size-river-v1.json" with { type: "json" };
import { gradeMultiwayStrategy } from "../src/lib/solver/multiway/best-response";
import {
  deserializeTwoSizeRiverStrategy,
  serializeTwoSizeRiverStrategy,
  type TwoSizeRiverSolveArtifact,
} from "../src/lib/solver/multiway/two-size-artifact";
import { verifyTwoSizeRiverArtifactHash } from "../src/lib/solver/multiway/two-size-artifact-node";
import { twoSizeRiverV1Game } from "../src/lib/solver/multiway/two-size-fixture";

const artifact = artifactData as unknown as TwoSizeRiverSolveArtifact;

test("the two-size artifact is hashed, current, and inside its locked gate", () => {
  assert.equal(verifyTwoSizeRiverArtifactHash(artifact), true);
  assert.equal(artifact.acceptance.passed, true);
  assert.ok(artifact.maximumUnilateralGain <= 0.45);
  assert.equal(artifact.qualityMeasure, "maximum-unilateral-gain");
  assert.equal(artifact.units, "net-chips-per-hand");
  assert.equal("exploitability" in artifact, false);
  assert.equal("nashGap" in artifact, false);
  assert.deepEqual(artifact.tree, {
    totalStates: 16_685,
    chanceNodes: 1,
    decisionNodes: 7_224,
    terminalNodes: 9_460,
    informationSets: 252,
    compatiblePrivateDeals: 172,
    terminalActionHistories: 55,
  });
});

test("the stored two-size strategy independently reproduces each player's grade", () => {
  const strategy = deserializeTwoSizeRiverStrategy(artifact.strategy);
  assert.deepEqual(serializeTwoSizeRiverStrategy(strategy), artifact.strategy);
  const grade = gradeMultiwayStrategy(twoSizeRiverV1Game, strategy);
  assert.deepEqual(grade.value, artifact.value);
  assert.deepEqual(grade.bestResponses.map(response => response.value), artifact.bestResponseValue);
  assert.deepEqual(grade.unilateralGains, artifact.unilateralGains);
  assert.equal(grade.maximumUnilateralGain, artifact.maximumUnilateralGain);
  assert.ok(Math.abs(grade.value.reduce((sum, value) => sum + value, 0)) <= 1e-9);
});

test("the artifact records the separate oracle and protects all prior artifacts", () => {
  assert.deepEqual(artifact.rulesAudit, {
    dealsChecked: 172,
    terminalsChecked: 9_460,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumReturnedUncalledDifference: 0,
    maximumContestablePotDifference: 0,
    maximumZeroSumError: 0,
  });
  assert.equal(artifact.independentChecks.reducedBestResponse.maximumValueDifference, 0);
  assert.deepEqual(
    artifact.independentChecks.reducedBestResponse.pureStrategiesChecked,
    [82_944, 82_944, 82_944],
  );
  assert.ok(artifact.independentChecks.hiddenInformationBoundary.cheatingAdvantage > 0.01);
  assert.equal(artifact.independentChecks.priorArtifacts.noRaiseHashValid, true);
  assert.equal(artifact.independentChecks.priorArtifacts.raisedHashValid, true);
  assert.equal(artifact.independentChecks.priorArtifacts.headsUpHashValid, true);
});

test("the two-size convergence record comes from fixed checkpoints", () => {
  assert.deepEqual(artifact.convergence.map(checkpoint => checkpoint.iteration), [
    256, 1_024, 4_096, 16_384, 65_536,
  ]);
  assert.equal(artifact.maximumUnilateralGain, 0.10896590853134036);
  assert.ok(artifact.convergence.every(checkpoint => checkpoint.maximumUnilateralGain >= 0));
});

test("changing two-size stored math invalidates the content hash", () => {
  assert.equal(verifyTwoSizeRiverArtifactHash({
    ...artifact,
    maximumUnilateralGain: artifact.maximumUnilateralGain + 0.001,
  }), false);
});
