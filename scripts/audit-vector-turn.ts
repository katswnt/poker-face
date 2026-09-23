import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";
import { vectorDigest } from "../src/lib/solver/postflop/vector/artifact-node";
import { compileVectorTurn } from "../src/lib/solver/postflop/vector/game";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { runVectorTurnJob } from "./vector-turn-runner";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--check", "--write"].includes(args[0])) throw new Error("Usage: audit-vector-turn.ts --check|--write");
  assert.equal(vectorDigest(POSTFLOP_M2_PROBE), "279c58fd54b45fac11db44dcd2e840335496d6dbd69c400038e1bc37ce34f533");
  const result = await runVectorTurnJob({ request: POSTFLOP_M2_PROBE,
    options: { iterations: 100000, algorithm: "cfr-plus", averagingDelay: 20 }, maximumExploitability: 0.25 }, {
    onProgress: p => { if (p.stage !== "solving" || p.iterations % 256 === 0) console.error(JSON.stringify(p)); },
  });
  const artifact = JSON.parse(result.json), { payloadHash, ...payload } = artifact;
  assert.equal(payloadHash, vectorDigest(payload)); assert.equal(artifact.policyHash, vectorDigest(artifact.strategy));
  assert.ok(artifact.acceptance.passed, "Locked M2 quality gate failed");
  assert.equal(artifact.counts.compatibleDeals, 3773);
  const game = compileVectorTurn(POSTFLOP_M2_PROBE);
  const explicit = gradeVectorTurn(game, deserializeBehavioralStrategy(game.index, artifact.strategy), "naive");
  for (const p of [0, 1] as const) {
    assert.ok(Math.abs(explicit.value[p] - artifact.value[p]) <= 2e-8);
    assert.ok(Math.abs(explicit.bestResponses[p].value - artifact.bestResponseValues[p]) <= 2e-8);
  }
  const path = join(process.cwd(), "src/lib/solver/postflop/vector/artifacts/heads-up-turn-vector-v1.json");
  const json = `${result.json}\n`;
  if (args[0] === "--check") assert.equal(readFileSync(path, "utf8"), json, "Vector artifact is not reproducible");
  else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, json); }
  console.log(JSON.stringify({ mode: args[0], counts: artifact.counts, iterations: artifact.iterations, convergence: artifact.convergence,
    value: artifact.value, gains: artifact.gains, exploitability: artifact.exploitability, payloadHash, policyHash: artifact.policyHash,
    explicitPairExploitability: explicit.exploitability, elapsedMs: result.elapsedMs, sampledPeakWorkerRssBytes: result.sampledPeakWorkerRssBytes }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
