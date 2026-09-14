import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import artifactData from "../src/lib/solver/river/artifacts/river-v1.json" with { type: "json" };
import referenceData from "./fixtures/solver/river-brown-6a104428.json" with { type: "json" };
import {
  deserializeRiverStrategy,
  stringifyRiverArtifact,
  type RiverReferenceFixture,
  type RiverSolveArtifact,
} from "../src/lib/solver/river/artifact";
import {
  fingerprintRiverGame,
  verifyRiverArtifactHash,
} from "../src/lib/solver/river/artifact-node";
import { riverDecisionFacts } from "../src/lib/solver/river/explain";
import { riverV1Game } from "../src/lib/solver/river/fixture";
import { auditRiverRules } from "../src/lib/solver/river/oracle";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { buildGameTreeIndex, validateStrategy } from "../src/lib/solver/toy/game";

const artifact = artifactData as unknown as RiverSolveArtifact;
const reference = referenceData as unknown as RiverReferenceFixture;

test("committed river artifact has a valid rules hash and canonical bytes", () => {
  assert.equal(verifyRiverArtifactHash(artifact), true);
  const disk = readFileSync(
    join(process.cwd(), "src/lib/solver/river/artifacts/river-v1.json"),
    "utf8",
  );
  assert.equal(stringifyRiverArtifact(artifact), disk);
  assert.equal(artifact.rulesFingerprint, fingerprintRiverGame());
  assert.equal(artifact.acceptance.passed, true);
  assert.deepEqual(artifact.tree, {
    totalStates: 1_282,
    chanceNodes: 1,
    decisionNodes: 488,
    terminalNodes: 793,
    informationSets: 64,
    compatiblePrivateDeals: 61,
  });
});

test("river artifacts reject changed rules and incomplete strategies", () => {
  const changedRules = {
    ...artifact,
    rules: { ...artifact.rules, betSizes: { ...artifact.rules.betSizes, halfPot: 49 } },
  };
  assert.equal(verifyRiverArtifactHash(changedRules), false);

  const [removedKey, ...remainingKeys] = Object.keys(artifact.strategy);
  assert.ok(removedKey);
  const incomplete = Object.fromEntries(remainingKeys.map(key => [key, artifact.strategy[key]]));
  assert.throws(
    () => deserializeRiverStrategy(incomplete),
    /does not match the game information sets/,
  );
});

test("committed river strategy independently reproduces its grade", () => {
  const index = buildGameTreeIndex(riverV1Game);
  const strategy = deserializeRiverStrategy(artifact.strategy);
  validateStrategy(index, strategy);
  const grade = gradeStrategy(riverV1Game, strategy, index);
  assert.deepEqual(grade.value, artifact.value);
  assert.deepEqual(grade.bestResponses.map(response => response.value), artifact.bestResponseValue);
  assert.deepEqual(grade.gains, artifact.gains);
  assert.equal(grade.nashGap, artifact.nashGap);
  assert.equal(grade.exploitability, artifact.exploitability);
  assert.equal(grade.exploitability, grade.nashGap / 2);
});

test("committed river teaching facts are exact outputs of the saved strategy", () => {
  const strategy = deserializeRiverStrategy(artifact.strategy);
  const decisions = riverDecisionFacts(riverV1Game, strategy);
  assert.deepEqual(decisions, artifact.decisions);
  assert.equal(decisions.length, 64);
  for (const decision of decisions) {
    assert.ok(Math.abs(decision.opponentRange.reduce(
      (sum, combo) => sum + (combo.probability ?? 0),
      0,
    ) - 1) < 1e-10);
    for (const action of decision.actions) {
      assert.ok(Math.abs(Object.values(action.outcomes).reduce<number>(
        (sum, probability) => sum + (probability ?? 0),
        0,
      ) - 1) < 1e-10);
      assert.notEqual(action.expectedAdditionalValue, null);
      assert.notEqual(action.differenceFromBest, null);
    }
  }
});

test("the independent slow rules audit reproduces every artifact measurement", () => {
  assert.deepEqual(auditRiverRules(riverV1Game), artifact.rulesAudit);
  assert.deepEqual(artifact.rulesAudit, {
    dealsChecked: 61,
    terminalsChecked: 793,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("the pinned MIT reference strategy reproduces its grade on the shared tree", () => {
  assert.equal(reference.source, "noambrown/poker_solver");
  assert.equal(reference.commit, "6a10442877ffc8fd28af93e16e279b9bbdd97b2a");
  assert.equal(reference.license, "MIT");
  assert.equal(reference.comparison.exactSharedTree, true);
  const referenceStrategy = deserializeRiverStrategy(reference.mappedStrategy);
  const grade = gradeStrategy(riverV1Game, referenceStrategy);
  assert.deepEqual(grade.value, reference.value);
  assert.deepEqual(grade.bestResponses.map(response => response.value), reference.bestResponseValue);
  assert.equal(grade.exploitability, reference.exploitability);
  assert.ok(reference.comparison.maximumBestResponseDifference < 1e-9);
  assert.ok(reference.comparison.exploitabilityDifference < 1e-9);
});

test("river acceptance reports both players and agrees with the independent reference", () => {
  assert.equal(artifact.exploitabilityUnits, "net-chips-per-hand");
  assert.equal(artifact.exploitabilityConvention, "half-nash-gap");
  assert.ok(artifact.gains[0] >= 0 && artifact.gains[1] >= 0);
  assert.ok(artifact.exploitability <= artifact.acceptance.maximumExploitability);
  assert.ok(reference.exploitability <= artifact.acceptance.referenceMaximumExploitability);
  assert.ok(
    artifact.acceptance.referenceValueDifference <= artifact.acceptance.referenceValueTolerance,
  );
  assert.equal(
    artifact.acceptance.referenceValueDifference,
    Math.abs(artifact.value[0] - reference.value[0]),
  );
});

test("river convergence improves without claiming every checkpoint must be monotone", () => {
  assert.deepEqual(
    artifact.convergence.map(checkpoint => checkpoint.iteration),
    [100, 400, 1_600, 6_400, 25_600, 51_200],
  );
  assert.ok(artifact.convergence.at(-1)!.exploitability < artifact.convergence[0].exploitability);
  for (const checkpoint of artifact.convergence) {
    assert.ok(checkpoint.value.every(Number.isFinite));
    assert.ok(checkpoint.gains.every(Number.isFinite));
    assert.ok(Math.abs(checkpoint.value[0] + checkpoint.value[1]) < 1e-10);
    assert.equal(checkpoint.exploitability, checkpoint.nashGap / 2);
  }
});
