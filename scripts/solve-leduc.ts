import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createLeducSolveArtifact,
  verifyLeducArtifactHash,
} from "../src/lib/solver/toy/leduc-artifact-node";
import {
  LEDUC_CONVERGED_REFERENCE,
  deserializeLeducStrategy,
  stringifyLeducArtifact,
  type LeducReferenceResult,
  type SerializedLeducStrategy,
} from "../src/lib/solver/toy/leduc-artifact";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { leducGame } from "../src/lib/solver/toy/leduc";

const ITERATIONS = 12_800;
const CHECKPOINTS = [100, 400, 1_600, 6_400, ITERATIONS] as const;
const projectRoot = process.cwd();
const artifactPath = join(projectRoot, "src/lib/solver/toy/artifacts/leduc-v1.json");
const referencePath = join(projectRoot, "test/fixtures/solver/leduc-brown-6a104428.json");
const checkOnly = process.argv.includes("--check");

// Re-certify the converged reference value that gates this artifact.
const convergedFixture = JSON.parse(
  readFileSync(join(projectRoot, LEDUC_CONVERGED_REFERENCE.strategyFixture), "utf8"),
) as { readonly strategy: SerializedLeducStrategy };
const convergedGrade = gradeStrategy(leducGame, deserializeLeducStrategy(convergedFixture.strategy));
const [certifiedLow, certifiedHigh] = LEDUC_CONVERGED_REFERENCE.certifiedInterval;
if (
  Math.abs(convergedGrade.value[0] - LEDUC_CONVERGED_REFERENCE.value) > 1e-12 ||
  Math.abs(convergedGrade.value[0] - convergedGrade.gains[1] - certifiedLow) > 1e-12 ||
  Math.abs(convergedGrade.value[0] + convergedGrade.gains[0] - certifiedHigh) > 1e-12
) {
  throw new Error("Converged Leduc reference constant does not match its certified strategy fixture");
}

const startedAt = performance.now();
const result = solveCfr(leducGame, {
  iterations: ITERATIONS,
  checkpointIterations: CHECKPOINTS,
});
const reference = JSON.parse(readFileSync(referencePath, "utf8")) as LeducReferenceResult;
const artifact = createLeducSolveArtifact(result, reference);
const serialized = stringifyLeducArtifact(artifact);
const elapsedSeconds = (performance.now() - startedAt) / 1_000;
const endResidentMemoryMiB = process.memoryUsage().rss / (1024 * 1024);

if (!verifyLeducArtifactHash(artifact)) throw new Error("Generated Leduc artifact hash is invalid");
if (!artifact.acceptance.passed) {
  throw new Error(
    `Leduc solve missed its acceptance gate: ` +
    `converged value difference=${artifact.acceptance.convergedReferenceValueDifference}, ` +
    `certificate contains converged value=${artifact.acceptance.certificateContainsConvergedReference}, ` +
    `exploitability=${artifact.exploitability}`,
  );
}

if (checkOnly) {
  const existing = readFileSync(artifactPath, "utf8");
  if (existing !== serialized) {
    throw new Error("Committed Leduc artifact is stale; run npm run solve:leduc");
  }
} else {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized, "utf8");
}

console.log(`Leduc game:            ${artifact.game}`);
console.log(`Tree states:           ${artifact.tree.totalStates}`);
console.log(`Information sets:      ${artifact.tree.informationSets}`);
console.log(`Iterations:            ${artifact.iterations}`);
console.log(`Player 0 value:        ${artifact.value[0].toFixed(9)} chips`);
console.log(`Converged value:       ${artifact.acceptance.convergedReferenceValue.toFixed(9)} chips (gate; certified CFR+ reference)`);
console.log(`Certified interval:    [${artifact.acceptance.certifiedValueInterval.map(value => value.toFixed(9)).join(", ")}] (contains converged: ${artifact.acceptance.certificateContainsConvergedReference})`);
console.log(`Best-response values:  ${artifact.bestResponseValue.map(value => value.toFixed(9)).join(", ")}`);
console.log(`Nash gap:              ${artifact.nashGap.toFixed(9)} chips`);
console.log(`Exploitability:        ${artifact.exploitability.toFixed(9)} chips`);
console.log(`Converged value delta: ${artifact.acceptance.convergedReferenceValueDifference.toFixed(9)} chips (tolerance ${artifact.acceptance.player0ValueTolerance})`);
console.log(`Brown value:           ${artifact.reference.value[0].toFixed(9)} chips (informational; ${artifact.reference.iterations}-iteration CFR, not converged)`);
console.log(`Brown value delta:     ${artifact.acceptance.brownReferenceValueDifference.toFixed(9)} chips (informational)`);
console.log(`Brown exploitability:  ${artifact.reference.exploitability.toFixed(9)} chips (informational)`);
console.log(`Rules SHA-256:         ${artifact.rulesFingerprint}`);
console.log(`Payload SHA-256:       ${artifact.payloadHash}`);
console.log(`Observed runtime:      ${elapsedSeconds.toFixed(2)} seconds (not an acceptance gate)`);
console.log(`End-of-run RSS:        ${endResidentMemoryMiB.toFixed(1)} MiB (not an acceptance gate)`);
console.log(checkOnly ? "Committed artifact:    reproducible" : `Wrote:                  ${artifactPath}`);
