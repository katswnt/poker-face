import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TURN_V2_CORPUS, TURN_V2_HELD_OUT, TURN_V2_MINIMUM_ITERATIONS } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { compileTurnV2 } from "../src/lib/solver/postflop/configurable-turn/game";
import type { TurnV2Artifact } from "../src/lib/solver/postflop/configurable-turn/artifact-node";
import { vectorDigest } from "../src/lib/solver/postflop/vector/artifact-node";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { runTurnV2Job } from "./turn-v2-runner";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--check", "--write"].includes(args[0])) throw new Error("Usage: audit-turn-v2.ts --check|--write");
  const hashes = JSON.parse(readFileSync("tasks/configurable-turn-v2-input-hashes.json", "utf8"));
  for (const request of [...TURN_V2_CORPUS, ...TURN_V2_HELD_OUT]) assert.equal(vectorDigest(request), hashes[request.id], "Locked input changed");
  for (const request of TURN_V2_CORPUS) {
    const result = await runTurnV2Job({ request, options: { iterations: 100000, algorithm: "cfr-plus", averagingDelay: 20 }, maximumExploitability: 0.25,
      minimumIterations: TURN_V2_MINIMUM_ITERATIONS[request.id] }, {
      onProgress: p => { if (p.stage !== "solving" || p.iterations % 256 === 0) console.error(JSON.stringify({ fixture: request.id, ...p })); },
    });
    const artifact = JSON.parse(result.json) as TurnV2Artifact, { payloadHash, ...payload } = artifact;
    assert.equal(payloadHash, vectorDigest(payload)); assert.equal(artifact.policyHash, vectorDigest(artifact.strategy));
    assert.ok(artifact.acceptance.passed, `Locked M3 quality gate failed: ${request.id}`);
    const game = compileTurnV2(request), scale = request.committedPerPlayer + Math.min(...request.stackBehind);
    for (const street of [0, 1] as const) assert.ok(game.publicStates.some((state, n) => state.street === street && game.actions[n].some(action => action.startsWith("raise-to-"))), "Missing declared raise branch");
    const explicit = gradeVectorTurn(game, deserializeBehavioralStrategy(game.index, artifact.strategy), "naive");
    for (const p of [0, 1] as const) {
      assert.ok(Math.abs(explicit.value[p] - artifact.value[p]) <= 1e-10 * scale);
      assert.ok(Math.abs(explicit.bestResponses[p].value - artifact.bestResponseValues[p]) <= 1e-10 * scale);
    }
    const path = join(process.cwd(), `src/lib/solver/postflop/configurable-turn/artifacts/${request.id}.json`), json = `${result.json}\n`;
    if (args[0] === "--check") assert.equal(readFileSync(path, "utf8"), json, "Turn v2 artifact is not reproducible");
    else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, json); }
    const observations = { elapsedMs: result.elapsedMs, memoryLimitBytes: result.memoryLimitBytes,
      sampledPeakWorkerRssBytes: result.sampledPeakWorkerRssBytes, sampledPeakParentRssBytes: result.sampledPeakParentRssBytes,
      sampledPeakCombinedRssBytes: result.sampledPeakCombinedRssBytes };
    console.log(JSON.stringify({ fixture: request.id, mode: args[0], counts: artifact.counts, iterations: artifact.iterations,
      convergence: artifact.convergence, value: artifact.value, gains: artifact.gains, exploitability: artifact.exploitability,
      payloadHash, policyHash: artifact.policyHash, explicitPairExploitability: explicit.exploitability, ...observations }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
