import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { solveMultiwayCfr } from "../src/lib/solver/multiway/cfr";
import {
  TWO_SIZE_RIVER_ACCEPTANCE,
  stringifyTwoSizeRiverArtifact,
} from "../src/lib/solver/multiway/two-size-artifact";
import {
  createTwoSizeRiverSolveArtifact,
  verifyTwoSizeRiverArtifactHash,
} from "../src/lib/solver/multiway/two-size-artifact-node";
import { twoSizeRiverV1Game } from "../src/lib/solver/multiway/two-size-fixture";

const ITERATIONS = 65_536;
const CHECKPOINTS = [256, 1_024, 4_096, 16_384, ITERATIONS] as const;
const artifactPath = join(
  process.cwd(),
  "src/lib/solver/multiway/artifacts/three-player-two-size-river-v1.json",
);
const checkOnly = process.argv.includes("--check");
const startedAt = performance.now();

const result = solveMultiwayCfr(twoSizeRiverV1Game, {
  iterations: ITERATIONS,
  checkpointIterations: CHECKPOINTS,
});
const artifact = createTwoSizeRiverSolveArtifact(result);
const serialized = stringifyTwoSizeRiverArtifact(artifact);
const elapsedSeconds = (performance.now() - startedAt) / 1_000;
const residentMemoryMiB = process.memoryUsage().rss / (1024 * 1024);
const artifactBytes = Buffer.byteLength(serialized, "utf8");

if (!verifyTwoSizeRiverArtifactHash(artifact)) throw new Error("Generated two-size artifact hash is invalid");
if (!artifact.acceptance.passed) {
  throw new Error(
    `Two-size candidate missed its locked gate: maximum unilateral gain=` +
    `${artifact.maximumUnilateralGain}`,
  );
}
if (elapsedSeconds > TWO_SIZE_RIVER_ACCEPTANCE.maximumRuntimeSeconds) {
  throw new Error(`Two-size solve took ${elapsedSeconds.toFixed(2)}s; budget is 600s`);
}
if (residentMemoryMiB > TWO_SIZE_RIVER_ACCEPTANCE.maximumResidentMemoryMiB) {
  throw new Error(`Two-size solve used ${residentMemoryMiB.toFixed(1)} MiB RSS; budget is 4096 MiB`);
}
if (artifactBytes > TWO_SIZE_RIVER_ACCEPTANCE.maximumArtifactBytes) {
  throw new Error(`Two-size artifact is ${artifactBytes} bytes; budget is 100 MiB`);
}

if (checkOnly) {
  if (readFileSync(artifactPath, "utf8") !== serialized) {
    throw new Error("Committed two-size artifact is stale; run npm run solve:multiway-two-size-river");
  }
} else {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized, "utf8");
}

console.log(`Two-size game:          ${artifact.game}`);
console.log(`Compatible deals:       ${artifact.tree.compatiblePrivateDeals}`);
console.log(`Tree states:            ${artifact.tree.totalStates}`);
console.log(`Information sets:       ${artifact.tree.informationSets}`);
console.log(`Iterations:             ${artifact.iterations}`);
console.log(`Profile values:         ${artifact.value.map(value => value.toFixed(9)).join(", ")}`);
console.log(`Best-response values:   ${artifact.bestResponseValue.map(value => value.toFixed(9)).join(", ")}`);
console.log(`Unilateral gains:       ${artifact.unilateralGains.map(value => value.toFixed(9)).join(", ")}`);
console.log(`Maximum gain:           ${artifact.maximumUnilateralGain.toFixed(9)} chips`);
console.log(`Rules SHA-256:          ${artifact.rulesFingerprint}`);
console.log(`Payload SHA-256:        ${artifact.payloadHash}`);
console.log(`Artifact size:          ${(artifactBytes / 1024).toFixed(1)} KiB`);
console.log(`Observed runtime:       ${elapsedSeconds.toFixed(2)} seconds`);
console.log(`End-of-run RSS:         ${residentMemoryMiB.toFixed(1)} MiB`);
console.log(checkOnly ? "Committed artifact:     reproducible" : `Wrote:                   ${artifactPath}`);
