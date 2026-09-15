import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  RAISED_RIVER_ACCEPTANCE,
  stringifyRaisedRiverArtifact,
} from "../src/lib/solver/multiway/raised-artifact";
import {
  createRaisedRiverSolveArtifact,
  verifyRaisedRiverArtifactHash,
} from "../src/lib/solver/multiway/raised-artifact-node";
import { solveMultiwayCfr } from "../src/lib/solver/multiway/cfr";
import { raisedRiverV1Game } from "../src/lib/solver/multiway/raised-fixture";

const ITERATIONS = 65_536;
const CHECKPOINTS = [256, 1_024, 4_096, 16_384, ITERATIONS] as const;
const artifactPath = join(
  process.cwd(),
  "src/lib/solver/multiway/artifacts/three-player-raised-river-v1.json",
);
const checkOnly = process.argv.includes("--check");
const startedAt = performance.now();

const result = solveMultiwayCfr(raisedRiverV1Game, {
  iterations: ITERATIONS,
  checkpointIterations: CHECKPOINTS,
});
const artifact = createRaisedRiverSolveArtifact(result);
const serialized = stringifyRaisedRiverArtifact(artifact);
const elapsedSeconds = (performance.now() - startedAt) / 1_000;
const residentMemoryMiB = process.memoryUsage().rss / (1024 * 1024);
const artifactBytes = Buffer.byteLength(serialized, "utf8");

if (!verifyRaisedRiverArtifactHash(artifact)) throw new Error("Generated raised artifact hash is invalid");
if (!artifact.acceptance.passed) {
  throw new Error(
    `Raised river candidate missed its locked gate: maximum unilateral gain=` +
    `${artifact.maximumUnilateralGain}`,
  );
}
if (elapsedSeconds > RAISED_RIVER_ACCEPTANCE.maximumRuntimeSeconds) {
  throw new Error(`Raised river solve took ${elapsedSeconds.toFixed(2)}s; budget is 600s`);
}
if (residentMemoryMiB > RAISED_RIVER_ACCEPTANCE.maximumResidentMemoryMiB) {
  throw new Error(`Raised river solve used ${residentMemoryMiB.toFixed(1)} MiB RSS; budget is 4096 MiB`);
}
if (artifactBytes > RAISED_RIVER_ACCEPTANCE.maximumArtifactBytes) {
  throw new Error(`Raised river artifact is ${artifactBytes} bytes; budget is 100 MiB`);
}

if (checkOnly) {
  if (readFileSync(artifactPath, "utf8") !== serialized) {
    throw new Error("Committed raised river artifact is stale; run npm run solve:multiway-raised-river");
  }
} else {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized, "utf8");
}

console.log(`Raised multiway game:   ${artifact.game}`);
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
