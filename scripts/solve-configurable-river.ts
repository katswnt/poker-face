import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import referenceData from "../test/fixtures/solver/configurable-river-brown-6a104428.json" with { type: "json" };
import {
  createConfigurableRiverArtifact,
  verifyConfigurableRiverArtifactHash,
} from "../src/lib/solver/river/configurable/artifact-node";
import {
  stringifyConfigurableRiverArtifact,
  type ConfigurableRiverReferenceFixture,
} from "../src/lib/solver/river/configurable/artifact";
import { configurableRiverV2DemoGame } from "../src/lib/solver/river/configurable/fixture";
import { solveCfr } from "../src/lib/solver/toy/cfr";

const ITERATIONS = 51_200;
const CHECKPOINTS = [100, 400, 1_600, 6_400, 25_600, ITERATIONS] as const;
const artifactPath = join(
  process.cwd(),
  "src/lib/solver/river/configurable/artifacts/configurable-river-v2.json",
);
const checkOnly = process.argv.includes("--check");
const startedAt = performance.now();
const result = solveCfr(configurableRiverV2DemoGame, {
  iterations: ITERATIONS,
  checkpointIterations: CHECKPOINTS,
});
const artifact = createConfigurableRiverArtifact(
  result,
  referenceData as unknown as ConfigurableRiverReferenceFixture,
);
const serialized = stringifyConfigurableRiverArtifact(artifact);
const seconds = (performance.now() - startedAt) / 1_000;

if (!verifyConfigurableRiverArtifactHash(artifact)) throw new Error("V2 artifact hash is invalid");
if (!artifact.acceptance.passed) {
  throw new Error(
    `V2 missed acceptance: exploitability=${artifact.exploitability}, ` +
    `reference delta=${artifact.acceptance.referenceValueDifference}`,
  );
}
if (checkOnly) {
  if (readFileSync(artifactPath, "utf8") !== serialized) {
    throw new Error("Committed configurable river artifact is stale; run npm run solve:river:v2");
  }
} else {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized, "utf8");
}

console.log(`Configurable river:     ${artifact.game}`);
console.log(`Compatible deals:       ${artifact.preflight.compatibleDeals}`);
console.log(`Projected/tree states:  ${artifact.preflight.projectedFullStates}/${artifact.tree.totalStates}`);
console.log(`Iterations:             ${artifact.iterations}`);
console.log(`Player 0 value:         ${artifact.value[0].toFixed(9)} chips`);
console.log(`Reference value:        ${artifact.reference.value[0].toFixed(9)} chips`);
console.log(`Best-response gains:    ${artifact.gains.map(value => value.toFixed(9)).join(", ")}`);
console.log(`Exploitability:         ${artifact.exploitability.toFixed(9)} chips`);
console.log(`Rules SHA-256:          ${artifact.rulesFingerprint}`);
console.log(`Payload SHA-256:        ${artifact.payloadHash}`);
console.log(`Observed runtime:       ${seconds.toFixed(2)} seconds (not an acceptance gate)`);
console.log(checkOnly ? "Committed artifact:     reproducible" : `Wrote:                   ${artifactPath}`);
