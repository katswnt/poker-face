import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { TURN_V2_CORPUS, TURN_V2_HELD_OUT } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { compileTurnV2 } from "../src/lib/solver/postflop/configurable-turn/game";
import type { TurnV2Artifact } from "../src/lib/solver/postflop/configurable-turn/artifact-node";
import { decodeVectorCheckpoint, encodeVectorCheckpoint, vectorDigest } from "../src/lib/solver/postflop/vector/artifact-node";
import { createVectorTurnSession, restoreVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { deserializeBehavioralStrategy, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { createReadableTurnV2 } from "../src/lib/solver/postflop/configurable-turn/readable";

const expectedHashes = [
  "381113385e5e2d93b38cd140f93934702b58679c76a98193afb74985945b6a18",
  "1221202fbbe66be69e07f7284bf58b971bffb90851ea5a8d26ae5cc874090689",
  "ab9efa138a13adc67f8286bcebeb20d66f9b3f8dcf53b857b0a148df8aad7444",
  "44724e28d15fe1c305327f4e6f1cfea562afd9fa21f3fe4edc0ed611bdb59527",
  "4be9800d7dae316f1a059f83790f7e82fb0c6d1c306914650988a8a879f3b60e",
];
test("turn v2 acceptance and held-out request hashes remain locked", () => {
  const expected = JSON.parse(readFileSync("tasks/configurable-turn-v2-input-hashes.json", "utf8"));
  for (const request of [...TURN_V2_CORPUS, ...TURN_V2_HELD_OUT]) assert.equal(vectorDigest(request), expected[request.id]);
});
for (const [i, request] of TURN_V2_CORPUS.entries()) test(`turn v2 full artifact has stable hashes and an independent grade: ${request.id}`, () => {
  const artifact = JSON.parse(readFileSync(`src/lib/solver/postflop/configurable-turn/artifacts/${request.id}.json`, "utf8")) as TurnV2Artifact;
  const { payloadHash, ...payload } = artifact;
  assert.equal(payloadHash, vectorDigest(payload)); assert.equal(payloadHash, expectedHashes[i]);
  assert.equal(artifact.policyHash, vectorDigest(artifact.strategy)); assert.equal(artifact.requestHash, vectorDigest(request));
  assert.equal(artifact.rules, "turn-v2"); assert.equal(artifact.rulesVersion, 2); assert.equal(artifact.backendVersion, 1);
  assert.equal(artifact.iterations, 256); assert.equal(artifact.algorithm, "cfr-plus"); assert.equal(artifact.averagingDelay, 20);
  assert.equal(artifact.acceptance.maximumExploitability, 0.25); assert.equal(artifact.acceptance.passed, true);
  assert.ok(artifact.exploitability <= 0.1);
  const game = compileTurnV2(request), policy = deserializeBehavioralStrategy(game.index, artifact.strategy);
  assert.equal(artifact.gameHash, vectorDigest(game.gameIdentity));
  assert.equal(artifact.counts.informationSets, policy.size); assert.equal(artifact.counts.equivalentStates, game.index.totalStates);
  const grades: { value: readonly number[]; bestResponses: readonly { value: number }[] }[] = [gradeVectorTurn(game, policy), gradeVectorTurn(game, policy, "naive")];
  if (i > 0) grades.push(gradeStrategy(createReadableTurnV2(request), policy));
  for (const grade of grades) for (const p of [0, 1] as const) {
    const tolerance = 1e-10 * (request.committedPerPlayer + Math.min(...request.stackBehind));
    assert.ok(Math.abs(grade.value[p] - artifact.value[p]) <= tolerance);
    assert.ok(Math.abs(grade.bestResponses[p].value - artifact.bestResponseValues[p]) <= tolerance);
  }
});
test("turn v2 wide checkpoint fits the admission estimate and resumes to the accepted policy", () => {
  const game = compileTurnV2(TURN_V2_CORPUS[0]);
  const original = createVectorTurnSession(game, { iterations: 100000, algorithm: "cfr-plus", averagingDelay: 20 }); original.advance(17);
  const json = encodeVectorCheckpoint(original.checkpoint());
  assert.ok(Buffer.byteLength(json) < game.preflight.estimatedCheckpointBytes);
  const resumed = restoreVectorTurnSession(game, decodeVectorCheckpoint(json)); resumed.advance(239);
  const policy = resumed.snapshot().averageStrategy;
  assert.equal(vectorDigest(serializeBehavioralStrategy(policy)), "07fab42b7a695b38712c1977cd0947569cb0e46042a2593ede1a4e1b7635e953");
  assert.equal(gradeVectorTurn(game, policy).exploitability, 0.033587175026543514);
  const acceptedJson = encodeVectorCheckpoint(resumed.checkpoint());
  assert.ok(Buffer.byteLength(acceptedJson) < game.preflight.estimatedCheckpointBytes);
});
