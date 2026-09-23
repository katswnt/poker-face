import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVectorTurnJob } from "../scripts/vector-turn-runner";
import { COMPACT_TURN_FIXTURES } from "../src/lib/solver/postflop/fixtures";
import { compileVectorTurn } from "../src/lib/solver/postflop/vector/game";
import { createVectorTurnSession, restoreVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { createVectorCheckpointWriter, decodeVectorCheckpoint, encodeVectorCheckpoint, readVectorCheckpoint, vectorDigest } from "../src/lib/solver/postflop/vector/artifact-node";
import { deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { buildGameTreeIndex } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { createTurnGame } from "../src/lib/solver/turn/game";
import type { VectorProgress } from "../src/lib/solver/postflop/vector/protocol";

const job = { request: COMPACT_TURN_FIXTURES[0], options: { iterations: 64, algorithm: "cfr-plus" as const, averagingDelay: 20 }, maximumExploitability: 0.25 };
test("vector worker returns a reproducible complete, independently graded policy with real progress", async () => {
  const progress: VectorProgress[] = [];
  const a = await runVectorTurnJob(job, { onProgress: p => progress.push(p) });
  const b = await runVectorTurnJob(job);
  assert.equal(a.json, b.json);
  assert.deepEqual(progress.filter(p => p.stage === "solving").map(p => p.iterations), [32, 64]);
  progress.forEach((p, i) => {
    assert.ok(p.elapsedMs >= (progress[i - 1]?.elapsedMs ?? 0));
    assert.equal(p.regretPasses, 2 * p.iterations); assert.equal(p.requestedIterations, 64);
    assert.ok(p.rssBytes > 0); assert.ok(a.sampledPeakWorkerRssBytes >= p.rssBytes);
    if (p.lastGrade) assert.ok(p.lastGrade.iteration <= p.iterations);
  });
  const { payloadHash, ...payload } = JSON.parse(a.json);
  assert.equal(payloadHash, vectorDigest(payload)); assert.equal(payload.policyHash, vectorDigest(payload.strategy));
  assert.equal(payload.status, "quality-target-met");
  const source = createTurnGame(payload.request), index = buildGameTreeIndex(source);
  const grade = gradeStrategy(source, deserializeBehavioralStrategy(index, payload.strategy), index);
  assert.equal(grade.exploitability, payload.exploitability);
});
for (const stage of ["compiling", "solving", "grading", "checkpointing", "exporting"] as const) {
  test(`vector cancellation during ${stage} never returns a result`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "poker-vector-cancel-"));
    try {
      const controller = new AbortController();
      await assert.rejects(runVectorTurnJob({ ...job, checkpointEvery: 32 }, {
        signal: controller.signal, checkpointPath: join(directory, "checkpoint.json"),
        onProgress: p => { if (p.stage === stage) controller.abort(); },
      }), /cancelled/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
test("a saved completed iteration survives cancellation and resumes to the identical policy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "poker-vector-resume-")), path = join(directory, "checkpoint.json");
  try {
    // Use a target this short ordinary-CFR run will not reach, so both runs
    // finish at the same iteration rather than stopping at the resume regrade.
    const restartJob = { ...job, options: { iterations: 64, algorithm: "vanilla" as const }, maximumExploitability: 0 };
    const controller = new AbortController();
    await assert.rejects(runVectorTurnJob({ ...restartJob, checkpointEvery: 16 }, { signal: controller.signal, checkpointPath: path,
      onProgress: p => { if (p.stage === "solving" && p.iterations === 32) controller.abort(); },
    }), /cancelled/);
    const saved = readVectorCheckpoint(path); assert.equal(saved.iterations, 16);
    const complete = JSON.parse((await runVectorTurnJob(restartJob)).json);
    const resumed = JSON.parse((await runVectorTurnJob({ ...restartJob, resume: saved })).json);
    assert.equal(resumed.policyHash, complete.policyHash); assert.deepEqual(resumed.value, complete.value);
    assert.deepEqual(resumed.gains, complete.gains); assert.equal(resumed.iterations, complete.iterations);
    assert.equal(resumed.convergence[0].iteration, 16); // Regrade restored policy; do not trust saved quality.
    assert.equal(readVectorCheckpoint(path).iterations, 16); // Input is never overwritten.
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("checkpoint checksums, dimensions, versions, iterations, ownership and failed writes fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "poker-vector-checkpoint-")), path = join(directory, "state.json");
  try {
    const game = compileVectorTurn(job.request), session = createVectorTurnSession(game, job.options);
    session.advance(10); const first = encodeVectorCheckpoint(session.checkpoint());
    const save = createVectorCheckpointWriter(path); save(first);
    assert.equal(readFileSync(path, "utf8"), first); assert.throws(() => createVectorCheckpointWriter(path), /already exists/);
    assert.throws(() => save(first.slice(0, -10))); assert.equal(readFileSync(path, "utf8"), first);
    const bad = JSON.parse(first); bad.checkpoint.regrets[0] += 1;
    assert.throws(() => decodeVectorCheckpoint(JSON.stringify(bad)), /checksum/);
    for (const mutate of [(c: Record<string, unknown>) => { c.schemaVersion = 2; }, (c: Record<string, unknown>) => { c.iterations = 65; },
      (c: Record<string, unknown>) => { c.iterations = 1.5; }, (c: Record<string, unknown>) => { c.strategySums = []; }]) {
      const checkpoint = JSON.parse(first).checkpoint; mutate(checkpoint);
      assert.throws(() => restoreVectorTurnSession(game, decodeVectorCheckpoint(encodeVectorCheckpoint(checkpoint))));
    }
    session.advance(10); save(encodeVectorCheckpoint(session.checkpoint())); assert.equal(readVectorCheckpoint(path).iterations, 20);
    renameSync(path, join(directory, "previous.json")); writeFileSync(path, "external user data");
    assert.throws(() => save(first), /externally/); assert.equal(readFileSync(path, "utf8"), "external user data");
    assert.deepEqual(readdirSync(directory).sort(), ["previous.json", "state.json"]);
    const raced = join(directory, "raced.json"), racedWriter = createVectorCheckpointWriter(raced);
    writeFileSync(raced, "created after writer"); assert.throws(() => racedWriter(first));
    assert.equal(readFileSync(raced, "utf8"), "created after writer");
    assert.equal(readdirSync(directory).filter(name => name.endsWith(".tmp")).length, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("timeouts, pre-abort, invalid targets, bad callbacks and resume mismatch fail without results", async () => {
  await assert.rejects(runVectorTurnJob(job, { timeoutMs: 1 }), /timed out/);
  await assert.rejects(runVectorTurnJob(job, { signal: AbortSignal.abort() }), /cancelled/);
  await assert.rejects(runVectorTurnJob(job, { timeoutMs: 600001 }), /Timeout/);
  await assert.rejects(runVectorTurnJob({ ...job, maximumExploitability: NaN }), /target/);
  await assert.rejects(runVectorTurnJob({ ...job, options: { iterations: NaN } }), /iterations/);
  await assert.rejects(runVectorTurnJob({ ...job, checkpointEvery: 0 }), /interval/);
  await assert.rejects(runVectorTurnJob(job, { onProgress: () => { throw new Error("consumer failed"); } }), /consumer failed/);
  const resume = createVectorTurnSession(compileVectorTurn(job.request), { iterations: 1 }).checkpoint();
  await assert.rejects(runVectorTurnJob({ ...job, resume }), /options differ/);
});
test("CLI reports unmet quality separately, rejects malformed input, and SIGINT exports no policy", async () => {
  const run = (args: string[], cancel = false) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/solve-vector-turn.ts", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", signalled = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI timed out")); }, 20000);
    child.on("error", reject); child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => {
      stderr += data;
      if (cancel && !signalled && stderr.includes('"stage":"solving"')) { signalled = true; child.kill("SIGINT"); }
    });
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  const failed = await run(["--fixture", "demo", "--algorithm", "vanilla", "--iterations", "1", "--target-chips", "0"]);
  assert.equal(failed.code, 2); assert.equal(JSON.parse(failed.stdout).status, "iteration-budget-exhausted");
  assert.equal(JSON.parse(failed.stdout).acceptance.passed, false);
  for (const args of [["--unknown", "yes"], ["--iterations"], ["--fixture", "demo", "--fixture", "demo"], ["--fixture", "wide", "--resume", "missing"]]) {
    const bad = await run(args); assert.equal(bad.code, 1); assert.equal(bad.stdout, "");
  }
  const directory = mkdtempSync(join(tmpdir(), "poker-vector-cli-"));
  try {
    const requestPath = join(directory, "request.json"), checkpointPath = join(directory, "checkpoint.json");
    writeFileSync(requestPath, JSON.stringify({ ...job.request, id: "cli-canonical-weights",
      rangeText: ["KdKh:2 AsQs", "QsJs 9h9d:2"] }));
    const original = await run(["--request", requestPath, "--algorithm", "vanilla", "--iterations", "64", "--target-chips", "0", "--checkpoint", checkpointPath]);
    assert.equal(original.code, 2);
    const saved = readFileSync(checkpointPath, "utf8");
    const resumed = await run(["--resume", checkpointPath, "--target-chips", "0", "--checkpoint", join(directory, "new-checkpoint.json")]);
    assert.equal(resumed.code, 2);
    assert.equal(JSON.parse(resumed.stdout).policyHash, JSON.parse(original.stdout).policyHash);
    assert.equal(JSON.parse(resumed.stdout).gameHash, JSON.parse(original.stdout).gameHash);
    assert.equal(readFileSync(checkpointPath, "utf8"), saved);
    const forbidden = await run(["--resume", checkpointPath, "--iterations", "100"]);
    assert.equal(forbidden.code, 1); assert.equal(forbidden.stdout, ""); assert.match(forbidden.stderr, /preserves/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const cancelled = await run(["--fixture", "wide"], true);
  assert.equal(cancelled.code, 1); assert.equal(cancelled.stdout, ""); assert.match(cancelled.stderr, /cancelled/);
});
