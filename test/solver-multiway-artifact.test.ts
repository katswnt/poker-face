import assert from "node:assert/strict";
import test from "node:test";
import artifactData from "../src/lib/solver/multiway/artifacts/three-player-river-v1.json" with { type: "json" };
import {
  deserializeMultiwayStrategy,
  serializeMultiwayStrategy,
  type MultiwaySolveArtifact,
} from "../src/lib/solver/multiway/artifact";
import { verifyMultiwayArtifactHash } from "../src/lib/solver/multiway/artifact-node";
import { gradeMultiwayStrategy } from "../src/lib/solver/multiway/best-response";
import { multiwayRiverV1Game } from "../src/lib/solver/multiway/fixture";

const artifact = artifactData as unknown as MultiwaySolveArtifact;

test("the committed multiway artifact is hashed, current, and inside its locked gate", () => {
  assert.equal(verifyMultiwayArtifactHash(artifact), true);
  assert.equal(artifact.acceptance.passed, true);
  assert.ok(artifact.maximumUnilateralGain <= 0.45);
  assert.equal(artifact.qualityMeasure, "maximum-unilateral-gain");
  assert.equal(artifact.units, "net-chips-per-hand");
  assert.equal("exploitability" in artifact, false);
  assert.equal("nashGap" in artifact, false);
});

test("the stored strategy independently reproduces every player's grade", () => {
  const strategy = deserializeMultiwayStrategy(artifact.strategy);
  assert.deepEqual(serializeMultiwayStrategy(strategy), artifact.strategy);
  const grade = gradeMultiwayStrategy(multiwayRiverV1Game, strategy);
  assert.deepEqual(grade.value, artifact.value);
  assert.deepEqual(grade.bestResponses.map(response => response.value), artifact.bestResponseValue);
  assert.deepEqual(grade.unilateralGains, artifact.unilateralGains);
  assert.equal(grade.maximumUnilateralGain, artifact.maximumUnilateralGain);
  assert.ok(Math.abs(grade.value.reduce((sum, value) => sum + value, 0)) <= 1e-9);
});

test("the artifact records all independent checks and their information boundaries", () => {
  assert.deepEqual(artifact.independentChecks.reducedBestResponse.pureStrategiesChecked, [256, 256, 256]);
  assert.equal(artifact.independentChecks.reducedBestResponse.compatibleDeals, 8);
  assert.equal(artifact.independentChecks.reducedBestResponse.maximumValueDifference, 0);
  assert.ok(artifact.independentChecks.hiddenInformationBoundary.cheatingAdvantage > 0.01);
  assert.equal(artifact.independentChecks.headsUpAdapter.committedArtifactHashValid, true);
  assert.equal(artifact.independentChecks.headsUpAdapter.treeCountsMatch, true);
  assert.equal(artifact.independentChecks.headsUpAdapter.maximumValueDifference, 0);
  assert.equal(artifact.independentChecks.headsUpAdapter.maximumBestResponseDifference, 0);
});

test("multiway CFR checkpoints are reported without assuming monotone convergence", () => {
  assert.deepEqual(artifact.convergence.map(checkpoint => checkpoint.iteration), [
    256, 1_024, 4_096, 16_384, 65_536,
  ]);
  const minimumBeforeFinal = Math.min(...artifact.convergence.slice(0, -1)
    .map(checkpoint => checkpoint.maximumUnilateralGain));
  assert.ok(artifact.maximumUnilateralGain > minimumBeforeFinal);
});

test("changing stored math invalidates the content hash", () => {
  const changed = {
    ...artifact,
    maximumUnilateralGain: artifact.maximumUnilateralGain + 0.001,
  };
  assert.equal(verifyMultiwayArtifactHash(changed), false);
});
