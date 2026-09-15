import assert from "node:assert/strict";
import test from "node:test";
import artifactData from "../src/lib/solver/multiway/artifacts/four-player-river-v1.json" with { type: "json" };
import { gradeMultiwayStrategy } from "../src/lib/solver/multiway/best-response";
import {
  deserializeFourPlayerStrategy,
  type FourPlayerSolveArtifact,
} from "../src/lib/solver/multiway/four-player-artifact";
import {
  fingerprintFourPlayerGame,
  verifyFourPlayerArtifactHash,
} from "../src/lib/solver/multiway/four-player-artifact-node";
import { fourPlayerRiverV1Game } from "../src/lib/solver/multiway/four-player-fixture";

const artifact = artifactData as unknown as FourPlayerSolveArtifact;

test("the four-player artifact is hashed, current, and inside its locked gate", () => {
  assert.equal(verifyFourPlayerArtifactHash(artifact), true);
  assert.equal(artifact.rulesFingerprint, fingerprintFourPlayerGame());
  assert.equal(artifact.acceptance.passed, true);
  assert.ok(artifact.maximumUnilateralGain <= 0.6);
  assert.deepEqual(artifact.rules.committedBeforeRiver, [30, 30, 30, 30]);
  assert.deepEqual(artifact.rules.stackBehind, [60, 60, 60, 60]);
  assert.deepEqual(artifact.rules.actionOrder, [0, 1, 2, 3]);
  assert.deepEqual(artifact.tree, {
    chanceNodes: 1,
    compatiblePrivateDeals: 174,
    decisionNodes: 5_568,
    informationSets: 128,
    terminalActionHistories: 33,
    terminalNodes: 5_742,
    totalStates: 11_311,
  });
});

test("the stored four-player strategy independently reproduces every player's grade", () => {
  const strategy = deserializeFourPlayerStrategy(artifact.strategy);
  const grade = gradeMultiwayStrategy(fourPlayerRiverV1Game, strategy);
  grade.value.forEach((value, player) => assert.ok(Math.abs(value - artifact.value[player]) <= 1e-9));
  grade.bestResponses.forEach((response, player) => {
    assert.ok(Math.abs(response.value - artifact.bestResponseValue[player]) <= 1e-9);
    assert.ok(Math.abs(grade.unilateralGains[player] - artifact.unilateralGains[player]) <= 1e-9);
  });
  assert.ok(Math.abs(grade.maximumUnilateralGain - artifact.maximumUnilateralGain) <= 1e-9);
  assert.ok(Math.abs(artifact.value.reduce((sum, value) => sum + value, 0)) <= 1e-9);
});

test("the artifact records separate four-player rules and reduction checks", () => {
  assert.deepEqual(artifact.rulesAudit, {
    dealsChecked: 174,
    maximumAwardDifference: 0,
    maximumPotDifference: 0,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumZeroSumError: 0,
    terminalsChecked: 5_742,
  });
  assert.equal(artifact.independentChecks.reducedBestResponse.maximumValueDifference, 0);
  assert.deepEqual(
    artifact.independentChecks.reducedBestResponse.pureStrategiesChecked,
    [256, 256, 256, 256],
  );
  assert.ok(artifact.independentChecks.hiddenInformationBoundary.cheatingAdvantage > 0.01);
  assert.equal(artifact.independentChecks.seatPermutation.maximumUtilityDifference, 0);
  assert.equal(artifact.independentChecks.deadMoneyReduction.terminalsChecked, 2_088);
  assert.equal(artifact.independentChecks.deadMoneyReduction.maximumUtilityDifference, 0);
  assert.equal(artifact.independentChecks.headsUpAdapter.treeMatches, true);
  assert.equal(Object.values(artifact.independentChecks.priorArtifacts).every(Boolean), true);
});

test("four-player convergence is measured without claiming exact GTO", () => {
  assert.deepEqual(
    artifact.convergence.map(point => point.iteration),
    [256, 1_024, 4_096, 16_384, 65_536],
  );
  assert.ok(artifact.convergence.at(-1)!.maximumUnilateralGain <
    artifact.convergence[0].maximumUnilateralGain);
  assert.equal(artifact.qualityMeasure, "maximum-unilateral-gain");
  assert.equal(artifact.independentOpenSourceReference.status, "no-pinned-matching-solver");
});

test("changing stored four-player math invalidates the content hash", () => {
  const changed = structuredClone(artifact) as FourPlayerSolveArtifact;
  (changed.value as number[])[0] += 0.01;
  assert.equal(verifyFourPlayerArtifactHash(changed), false);
});

test("every saved four-player decision has measured facts or is explicitly withheld", () => {
  assert.equal(artifact.decisions.length, 128);
  for (const decision of artifact.decisions) {
    assert.equal(decision.playerCount, 4);
    for (const action of decision.actions) {
      if (decision.offPath) {
        assert.equal(action.expectedValue, null);
        assert.equal(action.expectedAdditionalContribution, null);
      } else {
        assert.notEqual(action.expectedValue, null);
        assert.notEqual(action.expectedAdditionalContribution, null);
      }
    }
  }
});
