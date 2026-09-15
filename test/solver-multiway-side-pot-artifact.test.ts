import assert from "node:assert/strict";
import test from "node:test";
import artifactData from "../src/lib/solver/multiway/artifacts/three-player-side-pot-river-v1.json" with { type: "json" };
import { gradeMultiwayStrategy } from "../src/lib/solver/multiway/best-response";
import {
  deserializeSidePotStrategy,
  type SidePotSolveArtifact,
} from "../src/lib/solver/multiway/side-pot-artifact";
import {
  fingerprintSidePotGame,
  verifySidePotArtifactHash,
} from "../src/lib/solver/multiway/side-pot-artifact-node";
import { sidePotRiverV1Game } from "../src/lib/solver/multiway/side-pot-fixture";

const artifact = artifactData as unknown as SidePotSolveArtifact;

test("the side-pot artifact is hashed, current, and inside its locked gate", () => {
  assert.equal(verifySidePotArtifactHash(artifact), true);
  assert.equal(artifact.rulesFingerprint, fingerprintSidePotGame());
  assert.equal(artifact.acceptance.passed, true);
  assert.ok(artifact.maximumUnilateralGain <= 0.45);
  assert.deepEqual(artifact.rules.committedBeforeRiver, [30, 30, 30]);
  assert.deepEqual(artifact.rules.stackBehind, [30, 60, 60]);
  assert.equal(artifact.rules.potModel, "layered-side-pots-v1");
  assert.deepEqual(artifact.tree, {
    totalStates: 9_977,
    chanceNodes: 1,
    decisionNodes: 4_300,
    terminalNodes: 5_676,
    informationSets: 150,
    compatiblePrivateDeals: 172,
    terminalActionHistories: 33,
  });
});

test("the stored side-pot strategy independently reproduces every player's grade", () => {
  const strategy = deserializeSidePotStrategy(artifact.strategy);
  const grade = gradeMultiwayStrategy(sidePotRiverV1Game, strategy);
  grade.value.forEach((value, player) => assert.ok(Math.abs(value - artifact.value[player]) <= 1e-9));
  grade.bestResponses.forEach((response, player) => {
    assert.ok(Math.abs(response.value - artifact.bestResponseValue[player]) <= 1e-9);
    assert.ok(Math.abs(grade.unilateralGains[player] - artifact.unilateralGains[player]) <= 1e-9);
  });
  assert.ok(Math.abs(grade.maximumUnilateralGain - artifact.maximumUnilateralGain) <= 1e-9);
  assert.ok(Math.abs(artifact.value.reduce((sum, value) => sum + value, 0)) <= 1e-9);
});

test("the side-pot artifact records separate checks and protects every prior artifact", () => {
  assert.deepEqual(artifact.rulesAudit, {
    dealsChecked: 172,
    terminalsChecked: 5_676,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumReturnedUncalledDifference: 0,
    maximumContestablePotDifference: 0,
    maximumLayerAmountDifference: 0,
    layerStructureMismatches: 0,
    maximumZeroSumError: 0,
  });
  assert.equal(artifact.independentChecks.reducedBestResponse.maximumValueDifference, 0);
  assert.deepEqual(
    artifact.independentChecks.reducedBestResponse.pureStrategiesChecked,
    [256, 2_592, 864],
  );
  assert.ok(artifact.independentChecks.hiddenInformationBoundary.cheatingAdvantage > 0.01);
  assert.equal(artifact.independentChecks.priorArtifacts.noRaiseHashValid, true);
  assert.equal(artifact.independentChecks.priorArtifacts.raisedHashValid, true);
  assert.equal(artifact.independentChecks.priorArtifacts.twoSizeHashValid, true);
  assert.equal(artifact.independentChecks.priorArtifacts.headsUpHashValid, true);
});

test("side-pot convergence uses the fixed checkpoints without claiming exact GTO", () => {
  assert.deepEqual(artifact.convergence.map(point => point.iteration), [256, 1_024, 4_096, 16_384, 65_536]);
  assert.ok(artifact.convergence.at(-1)!.maximumUnilateralGain <
    artifact.convergence[0].maximumUnilateralGain);
  assert.equal(artifact.qualityMeasure, "maximum-unilateral-gain");
  assert.equal(artifact.independentOpenSourceReference.status, "no-pinned-matching-solver");
});

test("changing stored side-pot math invalidates the content hash", () => {
  const changed = structuredClone(artifact) as SidePotSolveArtifact;
  (changed.value as number[])[0] += 0.01;
  assert.equal(verifySidePotArtifactHash(changed), false);
});

test("every saved side-pot decision has measured facts or is explicitly withheld", () => {
  assert.equal(artifact.decisions.length, 150);
  for (const decision of artifact.decisions) {
    for (const action of decision.actions) {
      if (decision.offPath) {
        assert.equal(action.expectedValue, null);
        assert.equal(action.expectedAdditionalContribution, null);
        assert.equal(action.expectedPotLayers[0].expectedAmount, null);
      } else {
        assert.notEqual(action.expectedValue, null);
        assert.notEqual(action.expectedAdditionalContribution, null);
        assert.notEqual(action.expectedPotLayers[0].expectedAmount, null);
      }
    }
  }
});
