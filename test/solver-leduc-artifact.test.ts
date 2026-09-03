import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import artifactData from "../src/lib/solver/toy/artifacts/leduc-v1.json" with { type: "json" };
import referenceData from "./fixtures/solver/leduc-brown-6a104428.json" with { type: "json" };
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { buildGameTreeIndex, validateStrategy } from "../src/lib/solver/toy/game";
import {
  deserializeLeducStrategy,
  stringifyLeducArtifact,
  type LeducReferenceResult,
  type LeducSolveArtifact,
} from "../src/lib/solver/toy/leduc-artifact";
import { verifyLeducArtifactHash } from "../src/lib/solver/toy/leduc-artifact-node";
import { leducGame } from "../src/lib/solver/toy/leduc";

const artifact = artifactData as unknown as LeducSolveArtifact;
const reference = referenceData as unknown as LeducReferenceResult;

test("committed Leduc artifact has a valid hash and canonical formatting", () => {
  assert.equal(verifyLeducArtifactHash(artifact), true);
  const disk = readFileSync(
    join(process.cwd(), "src/lib/solver/toy/artifacts/leduc-v1.json"),
    "utf8",
  );
  assert.equal(stringifyLeducArtifact(artifact), disk);
  assert.equal(artifact.acceptance.passed, true);
  assert.equal(artifact.iterations, 12_800);
  assert.deepEqual(artifact.tree, {
    totalStates: 9_451,
    chanceNodes: 151,
    decisionNodes: 3_780,
    terminalNodes: 5_520,
    informationSets: 288,
  });
});

test("committed Leduc strategy independently reproduces its exact grade", () => {
  const index = buildGameTreeIndex(leducGame);
  const strategy = deserializeLeducStrategy(artifact.strategy);
  validateStrategy(index, strategy);
  assert.equal(strategy.size, 288);

  const grade = gradeStrategy(leducGame, strategy, index);
  assert.deepEqual(grade.value, artifact.value);
  assert.deepEqual(
    grade.bestResponses.map(response => response.value),
    artifact.bestResponseValue,
  );
  assert.deepEqual(grade.gains, artifact.gains);
  assert.equal(grade.nashGap, artifact.nashGap);
  assert.equal(grade.exploitability, artifact.exploitability);
});

test("our Leduc result agrees with the independently generated pinned reference", () => {
  assert.equal(reference.source, "noambrown/poker_solver");
  assert.equal(reference.commit, "6a10442877ffc8fd28af93e16e279b9bbdd97b2a");
  assert.deepEqual(artifact.reference, reference);
  assert.ok(artifact.acceptance.referenceValueDifference <= 0.001);
  assert.ok(artifact.exploitability <= 0.01);
  assert.ok(reference.exploitability <= 0.01);
});

test("the Leduc convergence record improves without claiming every checkpoint is monotone", () => {
  assert.deepEqual(
    artifact.convergence.map(checkpoint => checkpoint.iteration),
    [100, 400, 1_600, 6_400, 12_800],
  );
  assert.ok(
    artifact.convergence.at(-1)!.exploitability < artifact.convergence[0].exploitability,
  );
  for (const checkpoint of artifact.convergence) {
    assert.ok(checkpoint.value.every(Number.isFinite));
    assert.ok(Math.abs(checkpoint.value[0] + checkpoint.value[1]) < 1e-12);
    assert.equal(checkpoint.exploitability, checkpoint.nashGap / 2);
  }
});
