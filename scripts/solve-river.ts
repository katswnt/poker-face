import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import referenceData from "../test/fixtures/solver/river-brown-6a104428.json" with { type: "json" };
import {
  createRiverSolveArtifact,
  verifyRiverArtifactHash,
} from "../src/lib/solver/river/artifact-node";
import {
  stringifyRiverArtifact,
  type RiverReferenceFixture,
} from "../src/lib/solver/river/artifact";
import { riverV1Game } from "../src/lib/solver/river/fixture";
import { solveCfr } from "../src/lib/solver/toy/cfr";

const ITERATIONS = 51_200;
const CHECKPOINTS = [100, 400, 1_600, 6_400, 25_600, ITERATIONS] as const;
const artifactPath = join(process.cwd(), "src/lib/solver/river/artifacts/river-v1.json");
const checkOnly = process.argv.includes("--check");

const startedAt = performance.now();
const result = solveCfr(riverV1Game, {
  iterations: ITERATIONS,
  checkpointIterations: CHECKPOINTS,
});
const reference = referenceData as unknown as RiverReferenceFixture;
const artifact = createRiverSolveArtifact(result, reference);
const serialized = stringifyRiverArtifact(artifact);
const elapsedSeconds = (performance.now() - startedAt) / 1_000;
const endResidentMemoryMiB = process.memoryUsage().rss / (1024 * 1024);

if (!verifyRiverArtifactHash(artifact)) throw new Error("Generated river artifact hash is invalid");
if (!artifact.acceptance.passed) {
  throw new Error(
    `River solve missed its acceptance gate: exploitability=${artifact.exploitability}, ` +
    `reference value difference=${artifact.acceptance.referenceValueDifference}`,
  );
}

if (checkOnly) {
  const existing = readFileSync(artifactPath, "utf8");
  if (existing !== serialized) {
    throw new Error("Committed river artifact is stale; run npm run solve:river");
  }
} else {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized, "utf8");
}

console.log(`River game:             ${artifact.game}`);
console.log(`Compatible deals:       ${artifact.tree.compatiblePrivateDeals}`);
console.log(`Tree states:            ${artifact.tree.totalStates}`);
console.log(`Information sets:       ${artifact.tree.informationSets}`);
console.log(`Iterations:             ${artifact.iterations}`);
console.log(`Player 0 value:         ${artifact.value[0].toFixed(9)} chips`);
console.log(`Reference value:        ${artifact.reference.value[0].toFixed(9)} chips`);
console.log(`Best-response values:   ${artifact.bestResponseValue.map(value => value.toFixed(9)).join(", ")}`);
console.log(`Best-response gains:    ${artifact.gains.map(value => value.toFixed(9)).join(", ")}`);
console.log(`Nash gap:               ${artifact.nashGap.toFixed(9)} chips`);
console.log(`Exploitability:         ${artifact.exploitability.toFixed(9)} chips`);
console.log(`Reference exploitability: ${artifact.reference.exploitability.toFixed(9)} chips`);
console.log(`Reference value delta:  ${artifact.acceptance.referenceValueDifference.toFixed(9)} chips`);
console.log(`Rules SHA-256:          ${artifact.rulesFingerprint}`);
console.log(`Payload SHA-256:        ${artifact.payloadHash}`);
console.log(`Observed runtime:       ${elapsedSeconds.toFixed(2)} seconds (not an acceptance gate)`);
console.log(`End-of-run RSS:         ${endResidentMemoryMiB.toFixed(1)} MiB (not an acceptance gate)`);
console.log(checkOnly ? "Committed artifact:     reproducible" : `Wrote:                   ${artifactPath}`);
