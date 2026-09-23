import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TURN_DEMO_REQUEST } from "../src/lib/solver/turn/fixture";
import { solveTurn } from "../src/lib/solver/turn/solve";
import {
  createTurnArtifact, stringifyTurnArtifact, verifyTurnArtifactHash,
  TURN_ARTIFACT_ITERATIONS, TURN_ARTIFACT_CHECKPOINTS,
} from "../src/lib/solver/turn/artifact-node";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  throw new Error("Usage: solve-heads-up-turn.ts [--check]");
}
const started = performance.now();
const { result } = solveTurn(TURN_DEMO_REQUEST, {
  iterations: TURN_ARTIFACT_ITERATIONS, checkpointIterations: TURN_ARTIFACT_CHECKPOINTS,
});
const artifact = createTurnArtifact(result);
if (!verifyTurnArtifactHash(artifact) || !artifact.acceptance.passed) {
  throw new Error(`Turn artifact failed acceptance: exploitability ${artifact.exploitability}`);
}
const path = join(process.cwd(), "src/lib/solver/turn/artifacts/heads-up-turn-v1.json");
const serialized = stringifyTurnArtifact(artifact);
if (args[0] === "--check") {
  if (readFileSync(path, "utf8") !== serialized) throw new Error("Turn artifact is stale; run npm run solve:turn");
} else {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized, "utf8");
}
console.log(`Heads-up turn: ${artifact.game}; ordinary full-tree CFR; ${artifact.iterations} iterations`);
console.log("Approximate strategy for this bounded two-player game, not universal or exact GTO.");
console.log(`Deals/deal-river pairs/full states/information sets: ${artifact.preflight.compatibleDeals}/${artifact.preflight.dealRiverPairs}/${artifact.preflight.totalStates}/${artifact.informationSets}`);
console.log(`Player 0 value: ${artifact.value[0].toFixed(9)} chips`);
console.log(`Best-response gains: ${artifact.gains.map(value => value.toFixed(9)).join(", ")} chips`);
console.log(`Exploitability (half Nash gap): ${artifact.exploitability.toFixed(9)} chips`);
console.log(`Rules SHA-256: ${artifact.rulesFingerprint}`);
console.log(`Payload SHA-256: ${artifact.payloadHash}`);
console.log(`Observed runtime: ${((performance.now() - started) / 1000).toFixed(2)} seconds (not an acceptance gate)`);
console.log(args[0] === "--check" ? "Committed artifact: reproducible" : `Wrote ${path}`);
