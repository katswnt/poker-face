import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurnV2Job } from "../scripts/turn-v2-runner";
import { TURN_V2_HELD_OUT } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { compileTurnV2 } from "../src/lib/solver/postflop/configurable-turn/game";
import { createReadableTurnV2 } from "../src/lib/solver/postflop/configurable-turn/readable";
import type { TurnV2Progress } from "../src/lib/solver/postflop/configurable-turn/protocol";
import { createVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { readVectorCheckpoint, vectorDigest, encodeVectorCheckpoint } from "../src/lib/solver/postflop/vector/artifact-node";
import { compileVectorTurn } from "../src/lib/solver/postflop/vector/game";
import { COMPACT_TURN_FIXTURES } from "../src/lib/solver/postflop/fixtures";
import { deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { buildGameTreeIndex } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";

const job = { request: TURN_V2_HELD_OUT[0], options: { iterations: 64, algorithm: "vanilla" as const }, maximumExploitability: 0 };
test("turn v2 isolated worker has reproducible complete policies, real progress and honest unmet quality", async () => {
  const progress: TurnV2Progress[] = [];
  const first = await runTurnV2Job(job, { onProgress: p => progress.push(p) }), second = await runTurnV2Job(job);
  assert.equal(first.json, second.json);
  assert.deepEqual(progress.filter(p => p.stage === "solving").map(p => p.iterations), [32, 64]);
  for (const [i, p] of progress.entries()) {
    assert.equal(p.regretPasses, p.iterations); assert.equal(p.requestedIterations, 64);
    assert.ok(p.elapsedMs >= (progress[i - 1]?.elapsedMs ?? 0));
    assert.ok(p.rssBytes > 0 && p.rssBytes <= first.sampledPeakWorkerRssBytes);
    if (p.lastGrade) assert.ok(p.lastGrade.iteration <= p.iterations);
  }
  assert.ok(first.sampledPeakParentRssBytes > 0); assert.ok(first.sampledPeakCombinedRssBytes <= first.memoryLimitBytes);
  const { payloadHash, ...payload } = JSON.parse(first.json);
  assert.equal(payloadHash, vectorDigest(payload)); assert.equal(payload.policyHash, vectorDigest(payload.strategy));
  assert.equal(payload.rules, "turn-v2"); assert.equal(payload.status, "iteration-budget-exhausted"); assert.equal(payload.acceptance.passed, false);
  const source = createReadableTurnV2(job.request), index = buildGameTreeIndex(source);
  const grade = gradeStrategy(source, deserializeBehavioralStrategy(index, payload.strategy), index);
  assert.ok(Math.abs(grade.exploitability - payload.exploitability) <= 5.5e-9);
});
for (const stage of ["compiling", "solving", "grading", "checkpointing", "exporting"] as const) test(`turn v2 cancellation during ${stage} exports no result`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "poker-turn-v2-cancel-"));
  try {
    const controller = new AbortController();
    await assert.rejects(runTurnV2Job({ ...job, checkpointEvery: 16 }, {
      signal: controller.signal, checkpointPath: join(directory, "checkpoint.json"),
      onProgress: p => { if (p.stage === stage) controller.abort(); },
    }), /cancelled/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("turn v2 retains only completed saved iterations and resumes without changing input", async () => {
  const directory = mkdtempSync(join(tmpdir(), "poker-turn-v2-resume-")), path = join(directory, "checkpoint.json");
  try {
    const controller = new AbortController();
    await assert.rejects(runTurnV2Job({ ...job, checkpointEvery: 16 }, {
      checkpointPath: path, signal: controller.signal,
      onProgress: p => { if (p.stage === "solving" && p.iterations === 32) controller.abort(); },
    }), /cancelled/);
    const original = readFileSync(path, "utf8"), saved = readVectorCheckpoint(path);
    assert.equal(saved.iterations, 16);
    const a = JSON.parse((await runTurnV2Job(job)).json), b = JSON.parse((await runTurnV2Job({ ...job, resume: saved })).json);
    assert.equal(a.policyHash, b.policyHash); assert.deepEqual(a.value, b.value); assert.deepEqual(a.gains, b.gains);
    assert.equal(b.convergence[0].iteration, 16); assert.equal(readFileSync(path, "utf8"), original);
    await assert.rejects(runTurnV2Job(job, { checkpointPath: path }), /already exists/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("turn v2 rejects timeout, pre-abort, bad options, corrupt resume and foreign rules", async () => {
  await assert.rejects(runTurnV2Job(job, { timeoutMs: 1 }), /timed out/);
  await assert.rejects(runTurnV2Job(job, { signal: AbortSignal.abort() }), /cancelled/);
  await assert.rejects(runTurnV2Job(job, { timeoutMs: 600001 }), /Timeout/);
  await assert.rejects(runTurnV2Job({ ...job, maximumExploitability: NaN }), /target/);
  await assert.rejects(runTurnV2Job({ ...job, checkpointEvery: 0 }), /interval/);
  await assert.rejects(runTurnV2Job(job, { onProgress: () => { throw new Error("consumer failed"); } }), /consumer failed/);
  const old = createVectorTurnSession(compileVectorTurn(COMPACT_TURN_FIXTURES[0]), job.options).checkpoint();
  await assert.rejects(runTurnV2Job({ ...job, resume: old }), /identity/);
  const game = compileTurnV2(job.request), checkpoint = createVectorTurnSession(game, job.options).checkpoint();
  await assert.rejects(runTurnV2Job({ ...job, resume: { ...checkpoint, strategySums: [] } }), /array/);
  await assert.rejects(runTurnV2Job({ ...job, resume: { ...checkpoint, options: { ...checkpoint.options, iterations: 1 } } }), /options differ/);
});
test("turn v2 CLI distinguishes quality, invalid inputs, resume and interruption", async () => {
  const run = (args: string[], cancel = false) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/solve-turn-v2.ts", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", sent = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI timed out")); }, 30000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => {
      stderr += data;
      if (cancel && !sent && stderr.includes('"stage":"solving"')) { sent = true; child.kill("SIGINT"); }
    });
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  const directory = mkdtempSync(join(tmpdir(), "poker-turn-v2-cli-"));
  try {
    const path = join(directory, "request.json"), checkpoint = join(directory, "saved.json");
    writeFileSync(path, JSON.stringify(job.request));
    const original = await run(["--request", path, "--algorithm", "vanilla", "--iterations", "32", "--target-chips", "0", "--checkpoint", checkpoint]);
    assert.equal(original.code, 2); assert.equal(JSON.parse(original.stdout).acceptance.passed, false);
    const saved = readFileSync(checkpoint, "utf8");
    const resumed = await run(["--resume", checkpoint, "--target-chips", "0"]);
    assert.equal(resumed.code, 2); assert.equal(JSON.parse(original.stdout).policyHash, JSON.parse(resumed.stdout).policyHash);
    assert.equal(readFileSync(checkpoint, "utf8"), saved);
    for (const args of [["--unknown", "1"], ["--iterations"], ["--fixture", "dry-value", "--fixture", "dry-value"],
      ["--request", path, "--resume", checkpoint], ["--resume", checkpoint, "--iterations", "100"]]) {
      const bad = await run(args); assert.equal(bad.code, 1); assert.equal(bad.stdout, "");
    }
    const legacy = join(directory, "legacy.json");
    writeFileSync(legacy, encodeVectorCheckpoint(createVectorTurnSession(compileVectorTurn(COMPACT_TURN_FIXTURES[0]), job.options).checkpoint()));
    const wrong = await run(["--resume", legacy]); assert.equal(wrong.code, 1); assert.equal(wrong.stdout, ""); assert.match(wrong.stderr, /turn-v1/);
    const cancelled = await run(["--request", path, "--iterations", "100000"], true);
    assert.equal(cancelled.code, 1); assert.equal(cancelled.stdout, ""); assert.match(cancelled.stderr, /cancelled/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
