import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createConfigurableRiverV3Artifact,
  verifyConfigurableRiverV3ArtifactHash,
} from "../src/lib/solver/river/configurable-v3/artifact-node";
import { stringifyConfigurableRiverV3Artifact } from "../src/lib/solver/river/configurable-v3/artifact";
import { configurableRiverV3DemoGame } from "../src/lib/solver/river/configurable-v3/fixture";
import { solveCompiledFactorizedRiverCfr } from "../src/lib/solver/river/factorized/cfr";
import { compileFactorizedRiverGame } from "../src/lib/solver/river/factorized/game";

const ITERATIONS = 1_000;
const AVERAGING_DELAY = 20;
const CHECKPOINTS = [100, 400, ITERATIONS] as const;
const artifactPath = join(
  process.cwd(),
  "src/lib/solver/river/configurable-v3/artifacts/configurable-river-v3.json",
);
const checkOnly = process.argv.includes("--check");
const startedAt = performance.now();
const compiled = compileFactorizedRiverGame(configurableRiverV3DemoGame);
const result = solveCompiledFactorizedRiverCfr(compiled, {
  iterations: ITERATIONS,
  algorithm: "cfr-plus",
  averagingDelay: AVERAGING_DELAY,
  checkpointIterations: CHECKPOINTS,
});
const artifact = createConfigurableRiverV3Artifact(result);
const serialized = stringifyConfigurableRiverV3Artifact(artifact);
const seconds = (performance.now() - startedAt) / 1_000;

if (!verifyConfigurableRiverV3ArtifactHash(artifact)) throw new Error("v3 artifact hash is invalid");
if (!artifact.acceptance.passed) {
  throw new Error(
    `v3 missed acceptance: exploitability=${artifact.exploitability}, ` +
    `ordinary difference=${artifact.independentChecks.ordinaryCfrMaximumDifference}`,
  );
}
if (checkOnly) {
  if (readFileSync(artifactPath, "utf8") !== serialized) {
    throw new Error("Committed river v3 artifact is stale; run npm run solve:river:v3");
  }
} else {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized, "utf8");
}

console.log(`Configurable river:     ${artifact.game}`);
console.log(`Compatible deals:       ${artifact.preflight.compatibleDeals}`);
console.log(`Public/repeated states: ${artifact.factorizedTree.publicStates}/${artifact.factorizedTree.equivalentRepeatedStates}`);
console.log(`Information sets:       ${artifact.factorizedTree.informationSets}`);
console.log(`Iterations:             ${artifact.iterations} CFR+`);
console.log(`Player 0 value:         ${artifact.value[0].toFixed(9)} chips`);
console.log(`Best-response gains:    ${artifact.gains.map(value => value.toFixed(9)).join(", ")}`);
console.log(`Exploitability:         ${artifact.exploitability.toFixed(9)} chips`);
console.log(`Rules SHA-256:          ${artifact.rulesFingerprint}`);
console.log(`Payload SHA-256:        ${artifact.payloadHash}`);
console.log(`Observed runtime:       ${seconds.toFixed(2)} seconds (not an acceptance gate)`);
console.log(checkOnly ? "Committed artifact:     reproducible" : `Wrote:                   ${artifactPath}`);
