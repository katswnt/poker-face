import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";
import { compileVectorTurn } from "../src/lib/solver/postflop/vector/game";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { decodeVectorCheckpoint, encodeVectorCheckpoint, vectorDigest, type VectorArtifact } from "../src/lib/solver/postflop/vector/artifact-node";
import { createVectorTurnSession, restoreVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { deserializeBehavioralStrategy, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";

test("a full wide JSON checkpoint resumes to the accepted complete policy", () => {
  const game = compileVectorTurn(POSTFLOP_M2_PROBE);
  const session = createVectorTurnSession(game, { iterations: 100000, algorithm: "cfr-plus", averagingDelay: 20 });
  session.advance(17);
  const json = encodeVectorCheckpoint(session.checkpoint());
  assert.ok(Buffer.byteLength(json) < 32 * 1024 * 1024);
  const resumed = restoreVectorTurnSession(game, decodeVectorCheckpoint(json));
  resumed.advance(239);
  const snapshot = resumed.snapshot();
  assert.equal(snapshot.iterations, 256);
  assert.equal(vectorDigest(serializeBehavioralStrategy(snapshot.averageStrategy)), "bbddc1565a366bb42d03839f4d25a7d223c73f54bd40766246f854fd34ace699");
  assert.equal(gradeVectorTurn(game, snapshot.averageStrategy).exploitability, 0.026707309503037013);
});

test("locked wide artifact has a complete policy, stable hashes and a separate explicit-pair grade", () => {
  const artifact = JSON.parse(readFileSync("src/lib/solver/postflop/vector/artifacts/heads-up-turn-vector-v1.json", "utf8")) as VectorArtifact;
  const { payloadHash, ...payload } = artifact;
  assert.equal(payloadHash, vectorDigest(payload));
  assert.equal(payloadHash, "1a51682bf8073f723cf0222e5630b1e9f21ab0b03d2df9a89d73718dcda17684");
  assert.equal(artifact.policyHash, vectorDigest(artifact.strategy));
  assert.equal(artifact.policyHash, "bbddc1565a366bb42d03839f4d25a7d223c73f54bd40766246f854fd34ace699");
  assert.equal(artifact.requestHash, vectorDigest(POSTFLOP_M2_PROBE));
  assert.equal(artifact.iterations, 256); assert.equal(artifact.algorithm, "cfr-plus"); assert.equal(artifact.averagingDelay, 20);
  assert.equal(artifact.acceptance.maximumExploitability, 0.25); assert.equal(artifact.acceptance.passed, true);
  assert.ok(artifact.exploitability <= 0.1); assert.equal(artifact.exploitability, 0.026707309503037013);
  assert.equal(artifact.counts.compatibleDeals, 3773); assert.equal(artifact.counts.informationSets, 35584);
  const game = compileVectorTurn(POSTFLOP_M2_PROBE);
  assert.equal(artifact.gameHash, vectorDigest(game.gameIdentity));
  const policy = deserializeBehavioralStrategy(game.index, artifact.strategy);
  for (const kernel of ["vector", "naive"] as const) {
    const grade = gradeVectorTurn(game, policy, kernel);
    for (const p of [0, 1] as const) {
      assert.ok(Math.abs(grade.value[p] - artifact.value[p]) < 2e-8);
      assert.ok(Math.abs(grade.bestResponses[p].value - artifact.bestResponseValues[p]) < 2e-8);
    }
    assert.ok(Math.abs(grade.exploitability - artifact.exploitability) < 2e-8);
  }
});

test("wide grader agrees with explicit pairs on untrained complete policies too", () => {
  const game = compileVectorTurn(POSTFLOP_M2_PROBE);
  let seed = 170392;
  for (const mode of ["uniform", "pure", "mixed"]) {
    const policy = new Map(game.index.informationSets.map(info => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const p = mode === "uniform" ? 0.5 : mode === "pure" ? Number(seed > 2 ** 31) : seed / 2 ** 32;
      return [info.key, { actions: info.actions, probabilities: [p, 1 - p] }];
    }));
    const a = gradeVectorTurn(game, policy), b = gradeVectorTurn(game, policy, "naive");
    for (const p of [0, 1] as const) {
      assert.ok(Math.abs(a.value[p] - b.value[p]) < 2e-8);
      assert.ok(Math.abs(a.bestResponses[p].value - b.bestResponses[p].value) < 2e-8);
    }
  }
});
