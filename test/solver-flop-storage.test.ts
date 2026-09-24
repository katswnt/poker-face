import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { FLOP_REFERENCE_REQUEST } from "../src/lib/solver/postflop/flop/fixtures";
import { compileVectorFlop } from "../src/lib/solver/postflop/flop/compiled";
import { createVectorFlopSession, restoreVectorFlopSession } from "../src/lib/solver/postflop/flop/session";
import { atomicFlopWrite, decodeFlopCheckpointFile, decodeFlopPolicyFile, encodeFlopCheckpointFile, encodeFlopPolicyFile,
  FLOP_BINARY_LIMIT, readFlopBinary } from "../src/lib/solver/postflop/flop/binary-node";
import { runFlopJob } from "../scripts/flop-runner";
const request = { ...FLOP_REFERENCE_REQUEST, rangeText: ["AsQs KdKh:0.3", "9h9d"] as const, stackBehind: [2, 3] as const, betSizes: [1, 1, 1] as const };

test("little-endian policy/checkpoint files round-trip bit-identically and reject transport corruption", () => {
  const game = compileVectorFlop(request), session = createVectorFlopSession(game, { iterations: 4, algorithm: "cfr-plus", averagingDelay: 1 });
  session.advance(2); const encoded = encodeFlopCheckpointFile(game, session.checkpoint()), saved = decodeFlopCheckpointFile(game, encoded.compressed);
  const resumed = restoreVectorFlopSession(game, saved); resumed.advance(2); session.advance(2);
  assert.deepEqual(resumed.snapshot(), session.snapshot());
  const file = encodeFlopPolicyFile(game, session.snapshot()), decoded = decodeFlopPolicyFile(game, file.compressed);
  assert.deepEqual(decoded.policy, session.snapshot().policy); assert.equal(decoded.contentHash, file.contentHash); assert.equal(decoded.rawBytes, file.rawBytes);
  const raw = gunzipSync(file.compressed), head = raw.readUInt32LE(8), offset = 12 + head;
  assert.equal(raw.subarray(0, 8).toString(), "PFFLP001"); assert.equal(raw.readDoubleLE(offset), decoded.policy[0]);
  for (const bytes of [file.compressed.subarray(0, 30), gzipSync(raw.subarray(0, raw.length - 1)), gzipSync(Buffer.concat([raw, Buffer.from([0])]))]) assert.throws(() => decodeFlopPolicyFile(game, bytes));
  const corrupt = Buffer.from(raw); corrupt[offset] ^= 1; assert.throws(() => decodeFlopPolicyFile(game, gzipSync(corrupt)), /checksum/);
  assert.throws(() => decodeFlopPolicyFile(game, encoded.compressed), /version, game/);
  assert.throws(() => decodeFlopCheckpointFile(game, file.compressed), /version, game/);
  const wrong = compileVectorFlop({ ...request, id: "other-flop" }); assert.throws(() => decodeFlopPolicyFile(wrong, file.compressed), /game/);
  const oversize = Object.defineProperty(new Uint8Array(0), "byteLength", { value: FLOP_BINARY_LIMIT + 1 });
  assert.throws(() => decodeFlopPolicyFile(game, oversize), /size limit/);
});

test("valid checksums do not excuse invalid binary dimensions, values or algorithm settings", () => {
  const game = compileVectorFlop(request), session = createVectorFlopSession(game, { iterations: 2 }); session.advance(2);
  const file = encodeFlopPolicyFile(game, session.snapshot()), raw = gunzipSync(file.compressed), headerLength = raw.readUInt32LE(8);
  const mutate = (fn: (header: Record<string, unknown>, data: Buffer) => void) => {
    const header = JSON.parse(raw.subarray(12, 12 + headerLength).toString()), data = Buffer.from(raw.subarray(12 + headerLength, -32)); fn(header, data);
    const text = Buffer.from(canonicalSolverJson(header)), prefix = Buffer.alloc(12); prefix.write("PFFLP001"); prefix.writeUInt32LE(text.length, 8);
    const body = Buffer.concat([prefix, text, data]); return gzipSync(Buffer.concat([body, createHash("sha256").update(body).digest()]));
  };
  for (const value of [NaN, -1, 2]) assert.throws(() => decodeFlopPolicyFile(game, mutate((_, data) => data.writeDoubleLE(value, 0))), /probabilities/);
  assert.throws(() => decodeFlopPolicyFile(game, mutate(header => { header.arrays = [{ name: "policy", length: 2 ** 40 }]; })), /dimensions/);
  assert.throws(() => decodeFlopPolicyFile(game, mutate(header => { header.iterations = 3; })), /iteration/);
  assert.throws(() => decodeFlopPolicyFile(game, mutate(header => { header.options = { iterations: 2, algorithm: "made-up" }; })));
});

test("atomic checkpoint replacement preserves the prior file if validation fails", () => {
  const game = compileVectorFlop(request), session = createVectorFlopSession(game, { iterations: 2 }); session.advance(1);
  const directory = mkdtempSync(join(tmpdir(), "poker-flop-storage-test-")), path = join(directory, "checkpoint.gz");
  const file = encodeFlopCheckpointFile(game, session.checkpoint()); atomicFlopWrite(path, file.compressed);
  const before = readFileSync(path), invalid = session.checkpoint(); invalid.strategySums[0] = Infinity;
  assert.throws(() => atomicFlopWrite(path, Buffer.from("not allowed"), false), /EEXIST/);
  assert.throws(() => atomicFlopWrite(path, encodeFlopCheckpointFile(game, invalid).compressed), /bounds/);
  assert.deepEqual(readFileSync(path), before); assert.equal(decodeFlopCheckpointFile(game, readFlopBinary(path)).iterations, 1);
  session.advance(1); atomicFlopWrite(path, encodeFlopCheckpointFile(game, session.checkpoint()).compressed);
  assert.equal(decodeFlopCheckpointFile(game, readFlopBinary(path)).iterations, 2);
});

test("real flop worker cancellation preserves a complete checkpoint and resumes the same policy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "poker-flop-runner-test-")), checkpointPath = join(directory, "checkpoint.gz");
  const job = { request, options: { iterations: 10, algorithm: "cfr-plus" as const, averagingDelay: 2 }, maximumExploitability: 0 };
  const controller = new AbortController(); let saved = false;
  await assert.rejects(runFlopJob(job, { checkpointPath, checkpointEvery: 8, signal: controller.signal, onProgress: p => {
    if (p.stage === "checkpointing" && p.iterations === 8 && existsSync(checkpointPath)) { saved = true; controller.abort(); }
  } }), /cancelled/);
  assert.ok(saved); const game = compileVectorFlop(request);
  assert.equal(decodeFlopCheckpointFile(game, readFlopBinary(checkpointPath)).iterations, 8);
  const checkpointBefore = readFileSync(checkpointPath);
  await assert.rejects(runFlopJob(job, { checkpointPath }), /new path/);
  await assert.rejects(runFlopJob(job, { checkpointPath, resumePath: checkpointPath }), /new path/);
  assert.deepEqual(readFileSync(checkpointPath), checkpointBefore);
  const resumed = await runFlopJob(job, { resumePath: checkpointPath });
  const direct = createVectorFlopSession(game, job.options); direct.advance(10);
  assert.deepEqual(decodeFlopPolicyFile(game, readFlopBinary(resumed.policyPath)).policy, direct.snapshot().policy);
  await assert.rejects(runFlopJob({ ...job, options: { ...job.options, iterations: 11 } }, { resumePath: checkpointPath }), /options differ/);
  await assert.rejects(runFlopJob(job, { timeoutMs: 1 }), /timed out/);
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(runFlopJob(job, { signal: cancelled.signal }), /cancelled before/);
});
