import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { runCompactTurnJob } from "../scripts/compact-turn-runner";
import { COMPACT_TURN_FIXTURES, POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";
import { canonicalSolverJson, deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { buildGameTreeIndex } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { createTurnGame } from "../src/lib/solver/turn/game";
import type { CompactTurnProgress } from "../src/lib/solver/postflop/protocol";

const job = { request: COMPACT_TURN_FIXTURES[0], options: { iterations: 64 } };
test("isolated turn worker exports a reproducible complete independently graded policy", async () => {
  const progress: CompactTurnProgress[] = [];
  const a = await runCompactTurnJob(job, { onProgress: p => progress.push(p) });
  const b = await runCompactTurnJob(job);
  assert.equal(a.json, b.json);
  assert.deepEqual(progress.map(p => p.stage), ["compiling", "solving", "solving", "solving", "grading", "serializing"]);
  assert.deepEqual(progress.filter(p => p.stage === "solving").map(p => p.iterations), [0, 32, 64]);
  progress.forEach((p, i) => {
    assert.ok(p.elapsedMs >= (progress[i - 1]?.elapsedMs ?? 0));
    assert.equal(p.requestedIterations, 64);
    assert.ok(p.rssBytes > 0);
  });
  const { payloadHash, ...payload } = JSON.parse(a.json);
  assert.equal(payloadHash, createHash("sha256").update(canonicalSolverJson(payload)).digest("hex"));
  assert.equal(payload.status, "completed-and-independently-graded");
  assert.equal(payload.iterations, 64);
  const source = createTurnGame(payload.request), index = buildGameTreeIndex(source);
  const grade = gradeStrategy(source, deserializeBehavioralStrategy(index, payload.strategy), index);
  assert.equal(grade.exploitability, payload.exploitability);
  assert.ok(a.sampledPeakWorkerRssBytes >= progress[0].rssBytes);
});

for (const stage of ["compiling", "solving", "grading", "serializing"] as const) {
  test(`cancellation during ${stage} never returns a completed result`, async () => {
    const controller = new AbortController();
    await assert.rejects(runCompactTurnJob(job, { signal: controller.signal, onProgress: p => {
      if (p.stage === stage) controller.abort();
    } }), /cancelled/);
  });
}
test("timeout, pre-abort, invalid options and oversized requests fail closed", async () => {
  await assert.rejects(runCompactTurnJob(job, { timeoutMs: 1 }), /timed out/);
  await assert.rejects(runCompactTurnJob(job, { signal: AbortSignal.abort() }), /cancelled/);
  await assert.rejects(runCompactTurnJob(job, { timeoutMs: 600001 }), /Timeout/);
  await assert.rejects(runCompactTurnJob({ ...job, request: POSTFLOP_M2_PROBE }), /range exceeds/);
  await assert.rejects(runCompactTurnJob({ ...job, options: { iterations: NaN } }), /iterations/);
  await assert.rejects(runCompactTurnJob(job, { onProgress: () => { throw new Error("consumer failed"); } }), /consumer failed/);
});
test("CLI refuses unknown flags and SIGINT cancels without stdout policy", async () => {
  const run = (args: string[], cancel: boolean) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/solve-compact-turn.ts", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", signalled = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI test timed out")); }, 15000);
    child.on("error", reject);
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => {
      stderr += data;
      if (cancel && !signalled && stderr.includes('"stage":"solving"')) { signalled = true; child.kill("SIGINT"); }
    });
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  const bad = await run(["--bad", "yes"], false);
  assert.equal(bad.code, 1); assert.equal(bad.stdout, ""); assert.match(bad.stderr, /Usage/);
  const cancelled = await run(["--iterations", "100000"], true);
  assert.equal(cancelled.code, 1); assert.equal(cancelled.stdout, ""); assert.match(cancelled.stderr, /cancelled/);
});
