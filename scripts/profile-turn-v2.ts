import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { TURN_V2_CORPUS } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { compileTurnV2 } from "../src/lib/solver/postflop/configurable-turn/game";
import { createVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { encodeVectorCheckpoint, vectorDigest } from "../src/lib/solver/postflop/vector/artifact-node";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";

const measure = <T>(fn: () => T) => { const start = performance.now(); const value = fn(); return { value, ms: performance.now() - start }; };
const args = process.argv.slice(2);
if (!args.length) {
  console.log(JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
    reportedPhysicalMemoryBytes: totalmem(), iterations: 64, algorithm: "cfr-plus", averagingDelay: 20, samples: 5,
    note: "Separate process per fixture, one warmup then five samples. Fixed-iteration phase costs, not time-to-quality. RSS includes retained/discarded samples and runtime, not an OS cap." }));
  for (const id of ["turn-v2-wide-64", "turn-v2-dry-value"]) console.log(execFileSync(process.execPath,
    ["--import", "tsx", fileURLToPath(import.meta.url), id], { encoding: "utf8", timeout: 180000 }).trim());
} else {
  const request = TURN_V2_CORPUS.find(r => r.id === args[0]);
  if (args.length !== 1 || !request) throw new Error("Usage: npm run profile:turn:v2");
  const rows: Record<string, number>[] = [];
  let last: Record<string, unknown> = {};
  for (let sample = -1; sample < 5; sample++) {
    const compiled = measure(() => compileTurnV2(request)), game = compiled.value, n = sample < 0 ? 8 : 64;
    const session = createVectorTurnSession(game, { iterations: n, algorithm: "cfr-plus", averagingDelay: 20 });
    const advance = measure(() => session.advance(n)), snapshot = measure(() => session.snapshot());
    const grade = measure(() => gradeVectorTurn(game, snapshot.value.averageStrategy));
    const pair = measure(() => gradeVectorTurn(game, snapshot.value.averageStrategy, "naive"));
    const tolerance = 1e-10 * (request.committedPerPlayer + Math.min(...request.stackBehind));
    assert.ok(Math.abs(grade.value.exploitability - pair.value.exploitability) <= tolerance);
    const serialized = measure(() => canonicalSolverJson(serializeBehavioralStrategy(snapshot.value.averageStrategy)));
    const checkpoint = measure(() => encodeVectorCheckpoint(session.checkpoint()));
    assert.ok(Buffer.byteLength(checkpoint.value) <= game.preflight.estimatedCheckpointBytes);
    if (sample >= 0) rows.push({ compileMs: compiled.ms, iterationMs: advance.ms / n, snapshotMs: snapshot.ms,
      gradeMs: grade.ms, pairGradeMs: pair.ms, serializationMs: serialized.ms, checkpointMs: checkpoint.ms });
    last = { request: request.id, requestHash: vectorDigest(request), preflight: game.preflight,
      compiledTypedBytes: game.typedStorageBytes, sessionTypedBytes: snapshot.value.workingStorageBytes,
      gradeTypedBytes: grade.value.workingStorageBytes, serializedPolicyBytes: Buffer.byteLength(serialized.value),
      checkpointBytes: Buffer.byteLength(checkpoint.value), processMaxRssKiB: process.resourceUsage().maxRSS,
      policyHash: vectorDigest(serializeBehavioralStrategy(snapshot.value.averageStrategy)), value: grade.value.value,
      exploitability: grade.value.exploitability, kernelObservations: snapshot.value.kernelObservationsSinceStart };
  }
  console.log(JSON.stringify({ ...last, medianMs: Object.fromEntries(Object.keys(rows[0]).map(key => [key, rows.map(r => r[key]).sort((a, b) => a - b)[2]])), samplesMs: rows }));
}
