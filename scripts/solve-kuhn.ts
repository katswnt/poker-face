import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createKuhnSolveArtifact,
  verifyKuhnArtifactHash,
} from "../src/lib/solver/toy/artifact-node";
import { stringifyKuhnArtifact } from "../src/lib/solver/toy/artifact";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { kuhnGame } from "../src/lib/solver/toy/kuhn";

interface BrownKuhnFixture {
  readonly commit: string;
  readonly iterations: number;
  readonly value: readonly [number, number];
  readonly exploitability: number;
}

const ITERATIONS = 100_000;
const CHECKPOINTS = [100, 1_000, 10_000, ITERATIONS] as const;
const projectRoot = process.cwd();
const artifactPath = join(projectRoot, "src/lib/solver/toy/artifacts/kuhn-v1.json");
const brownFixturePath = join(projectRoot, "test/fixtures/solver/kuhn-brown-6a104428.json");
const checkOnly = process.argv.includes("--check");

const result = solveCfr(kuhnGame, {
  iterations: ITERATIONS,
  checkpointIterations: CHECKPOINTS,
});
const artifact = createKuhnSolveArtifact(result);
const serialized = stringifyKuhnArtifact(artifact);

if (!verifyKuhnArtifactHash(artifact)) throw new Error("Generated Kuhn artifact hash is invalid");
if (!artifact.acceptance.passed) {
  throw new Error(
    `Kuhn solve missed its acceptance gate: value=${artifact.value[0]}, exploitability=${artifact.exploitability}`,
  );
}

const brown = JSON.parse(readFileSync(brownFixturePath, "utf8")) as BrownKuhnFixture;
const valueDifference = Math.abs(artifact.value[0] - brown.value[0]);
if (valueDifference > artifact.acceptance.player0ValueTolerance) {
  throw new Error(
    `Kuhn value differs from Brown commit ${brown.commit} by ${valueDifference}`,
  );
}

if (checkOnly) {
  const existing = readFileSync(artifactPath, "utf8");
  if (existing !== serialized) {
    throw new Error("Committed Kuhn artifact is stale; run npm run solve:kuhn");
  }
} else {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized, "utf8");
}

console.log(`Kuhn game:             ${artifact.game}`);
console.log(`Tree states:           ${artifact.tree.totalStates}`);
console.log(`Information sets:      ${artifact.tree.informationSets}`);
console.log(`Iterations:            ${artifact.iterations}`);
console.log(`Player 0 value:        ${artifact.value[0].toFixed(9)} chips`);
console.log(`Reference value:       ${artifact.acceptance.referencePlayer0Value.toFixed(9)} chips`);
console.log(`Best-response values:  ${artifact.bestResponseValue.map(value => value.toFixed(9)).join(", ")}`);
console.log(`Nash gap:              ${artifact.nashGap.toFixed(9)} chips`);
console.log(`Exploitability:        ${artifact.exploitability.toFixed(9)} chips`);
console.log(`Brown value delta:     ${valueDifference.toFixed(9)} chips`);
console.log(`Brown exploitability:  ${brown.exploitability.toFixed(9)} chips at ${brown.iterations} iterations`);
console.log(`Payload SHA-256:       ${artifact.payloadHash}`);
console.log(checkOnly ? "Committed artifact:    reproducible" : `Wrote:                  ${artifactPath}`);
