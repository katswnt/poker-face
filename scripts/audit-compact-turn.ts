import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compileCompactTurn } from "../src/lib/solver/postflop/compact-turn";
import { createCompactTurnSession } from "../src/lib/solver/postflop/session";
import { COMPACT_TURN_FIXTURES, POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { compileCompactGame, solveCompiledCompactCfr } from "../src/lib/solver/river/compact/cfr";
import { fingerprintTurnGame, TURN_ARTIFACT_ITERATIONS, TURN_ARTIFACT_CHECKPOINTS, verifyTurnArtifactHash,
  type TurnArtifact } from "../src/lib/solver/turn/artifact-node";

if (process.argv.length !== 2) throw new Error("Usage: npm run audit:turn:compact");
const hash = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
const old: TurnArtifact = JSON.parse(readFileSync(new URL("../src/lib/solver/turn/artifacts/heads-up-turn-v1.json", import.meta.url), "utf8"));
assert.ok(verifyTurnArtifactHash(old));
const game = compileCompactTurn(COMPACT_TURN_FIXTURES[0]);
for (const algorithm of ["vanilla", "cfr-plus"] as const) {
  const options = { iterations: algorithm === "vanilla" ? TURN_ARTIFACT_ITERATIONS : 1000, algorithm,
    averagingDelay: algorithm === "vanilla" ? 0 : 20,
    checkpointIterations: algorithm === "vanilla" ? TURN_ARTIFACT_CHECKPOINTS : [100, 1000] };
  const session = createCompactTurnSession(game, options);
  const started = performance.now();
  while (!session.done) session.advance(257);
  const result = session.snapshot(), grade = gradeStrategy(game.source, result.averageStrategy, game.index);
  const policy = serializeBehavioralStrategy(result.averageStrategy);
  const expected = algorithm === "vanilla" ? old.strategy
    : serializeBehavioralStrategy(solveCompiledCompactCfr(compileCompactGame(game.source), options).averageStrategy);
  // Stronger than the locked 1e-9 tolerance: the whole serialized policy is identical.
  assert.deepEqual(policy, expected);
  assert.ok(Number.isFinite(grade.exploitability) && grade.exploitability <= 0.10);
  if (algorithm === "vanilla") {
    assert.deepEqual(grade.value, old.value); assert.deepEqual(grade.gains, old.gains);
    result.checkpoints.forEach((checkpoint, i) => {
      const measured = gradeStrategy(game.source, checkpoint.averageStrategy, game.index);
      assert.equal(measured.exploitability, old.convergence[i].exploitability);
    });
  }
  console.log(JSON.stringify({ backend: result.backend, algorithm, algorithmVersion: result.algorithmVersion,
    iterations: result.iterations, averagingDelay: result.averagingDelay, requestHash: hash(game.source.request),
    rulesHash: fingerprintTurnGame(game.source), policyHash: hash(policy), publicStates: game.nodeKinds.length,
    equivalentStates: game.index.totalStates, informationSets: game.index.informationSets.length,
    value: grade.value, gains: grade.gains, exploitability: grade.exploitability, maximumExploitability: 0.10,
    accepted: true, completePolicyExactlyMatchesReference: true, observedAuditMs: performance.now() - started }));
}
const boundary = compileCompactTurn(COMPACT_TURN_FIXTURES[1]);
const repeated = compileCompactGame(boundary.source);
assert.ok(boundary.typedStorageBytes <= repeated.storageBytes / 2);
assert.throws(() => compileCompactTurn(POSTFLOP_M2_PROBE));
console.log(JSON.stringify({ boundary: boundary.source.id, publicStates: boundary.nodeKinds.length,
  equivalentStates: boundary.index.totalStates, informationSets: boundary.index.informationSets.length,
  sharedTypedBytes: boundary.typedStorageBytes, repeatedTypedBytes: repeated.storageBytes,
  storageRatio: boundary.typedStorageBytes / repeated.storageBytes, futureM2Probe: "correctly refused" }));
console.log("Approximate strategies for unchanged finite turn-v1 games, not exact or universal GTO. No larger-range claim.");
