import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { runFlopJob } from "./flop-runner";
import { FLOP_WIDE_REQUEST } from "../src/lib/solver/postflop/flop/fixtures";
import { flopDigest } from "../src/lib/solver/postflop/flop/artifact-node";
import { compileVectorFlop } from "../src/lib/solver/postflop/flop/compiled";
import { gradeVectorFlop } from "../src/lib/solver/postflop/flop/scorekeeper";
import { atomicFlopWrite, decodeFlopPolicyFile, FLOP_BINARY_LIMIT, readFlopBinary } from "../src/lib/solver/postflop/flop/binary-node";

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !["--check", "--write"].includes(mode)) throw new Error("Usage: audit-vector-flop.ts --check|--write");
  const hashes = JSON.parse(readFileSync("tasks/vector-flop-v1-input-hashes.json", "utf8"));
  assert.equal(flopDigest(FLOP_WIDE_REQUEST), hashes[FLOP_WIDE_REQUEST.id]);
  const started = performance.now();
  const result = await runFlopJob({ request: FLOP_WIDE_REQUEST, options: { iterations: 100000, algorithm: "cfr-plus", averagingDelay: 20 }, maximumExploitability: 0.25 }, {
    onProgress: p => { if (p.stage !== "solving" || p.iterations % 32 === 0) console.error(JSON.stringify(p)); },
  });
  const artifact = JSON.parse(result.json), { payloadHash, ...payload } = artifact;
  assert.equal(payloadHash, flopDigest(payload)); assert.equal(artifact.inputHash, hashes[FLOP_WIDE_REQUEST.id]);
  assert.ok(artifact.acceptance.passed, "Locked wider flop quality gate failed");
  const game = compileVectorFlop(FLOP_WIDE_REQUEST), bytes = readFlopBinary(result.policyPath), decoded = decodeFlopPolicyFile(game, bytes);
  assert.equal(decoded.contentHash, artifact.policy.contentHash); assert.equal(decoded.iterations, artifact.iterations);
  assert.equal(decoded.rawBytes, artifact.policy.rawBytes); assert.equal(game.informationSets, artifact.informationSets);
  const grade = gradeVectorFlop(game, decoded.policy);
  for (const p of [0, 1]) {
    assert.ok(Math.abs(grade.value[p] - artifact.value[p]) <= 1e-10 * 125);
    assert.ok(Math.abs(grade.bestResponses[p].value - artifact.bestResponseValues[p]) <= 1e-10 * 125);
  }
  const directory = "src/lib/solver/postflop/flop/artifacts", base = `${directory}/${FLOP_WIDE_REQUEST.id}`;
  if (mode === "--check") {
    assert.equal(readFileSync(`${base}.json`, "utf8"), result.json, "Flop manifest differs");
    assert.deepEqual(gunzipSync(readFlopBinary(`${base}.policy.f64.gz`), { maxOutputLength: FLOP_BINARY_LIMIT }),
      gunzipSync(bytes, { maxOutputLength: FLOP_BINARY_LIMIT }), "Uncompressed flop policy differs");
  } else {
    mkdirSync(directory, { recursive: true });
    atomicFlopWrite(`${base}.policy.f64.gz`, bytes); atomicFlopWrite(`${base}.json`, Buffer.from(result.json));
  }
  console.log(JSON.stringify({ mode, counts: artifact.counts, informationSets: artifact.informationSets, iterations: artifact.iterations,
    value: artifact.value, gains: artifact.gains, exploitability: artifact.exploitability, convergence: artifact.convergence,
    payloadHash, policyHash: decoded.contentHash, rawPolicyBytes: decoded.rawBytes, compressedPolicyBytes: bytes.byteLength,
    jobElapsedMs: result.elapsedMs, auditElapsedMs: performance.now() - started, budgetBytes: result.memoryLimitBytes,
    sampledPeakWorkerRss: result.sampledPeakWorkerRss, sampledPeakCombinedRss: result.sampledPeakCombinedRss }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
