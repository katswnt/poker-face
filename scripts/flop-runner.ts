import { execFile, fork } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { FLOP_VECTOR_MEMORY_LIMIT, preflightVectorFlop } from "../src/lib/solver/postflop/flop/compiled";
import type { FlopJob, FlopProgress, FlopWorkerMessage } from "../src/lib/solver/postflop/flop/protocol";
import { validateVectorOptions } from "../src/lib/solver/postflop/vector/session";

export async function runFlopJob(job: FlopJob, options: { timeoutMs?: number; signal?: AbortSignal;
  checkpointPath?: string; resumePath?: string; checkpointEvery?: number; onProgress?: (p: FlopProgress) => void } = {}) {
  const started = performance.now(), timeoutMs = options.timeoutMs ?? 600000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error("Flop timeout must be 1..600000 ms");
  if (options.signal?.aborted) throw new Error("Flop job cancelled before start");
  if (options.checkpointPath && (existsSync(options.checkpointPath)
    || (options.resumePath && resolve(options.checkpointPath) === resolve(options.resumePath)))) {
    throw new Error("Checkpoint output must be a new path, separate from the resume input");
  }
  const checked = validateVectorOptions(job.options);
  if (!Number.isFinite(job.maximumExploitability) || job.maximumExploitability < 0) throw new Error("Invalid flop quality target");
  if (options.checkpointEvery !== undefined && (!Number.isSafeInteger(options.checkpointEvery) || options.checkpointEvery < 1 || options.checkpointEvery > 100000)) throw new Error("Invalid flop checkpoint interval");
  const memoryLimitBytes = Math.min(FLOP_VECTOR_MEMORY_LIMIT, Math.floor(totalmem() / 4));
  preflightVectorFlop(job.request, memoryLimitBytes);
  if (process.memoryUsage().rss > memoryLimitBytes) throw new Error("Flop controller exceeds memory budget");
  const outputDirectory = mkdtempSync(join(tmpdir(), "poker-flop-job-"));
  return new Promise<{ outputDirectory: string; json: string; policyPath: string; elapsedMs: number;
    memoryLimitBytes: number; sampledPeakWorkerRss: number; sampledPeakCombinedRss: number }>((resolveJob, reject) => {
    const worker = fork(new URL("./flop-worker.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx", `--max-old-space-size=${Math.max(64, Math.floor(memoryLimitBytes / 1024 ** 2 * 0.75))}`], stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let settled = false, complete = false, diagnostics = "", polling = false, lastWorkerRss = 0;
    let sampledPeakWorkerRss = 0, sampledPeakCombinedRss = process.memoryUsage().rss;
    const cleanup = () => { clearInterval(sampler); clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); worker.kill("SIGKILL"); reject(error); };
    const cancel = () => fail(new Error("Flop job cancelled; last complete requested checkpoint retained"));
    const observe = (rss: number) => {
      lastWorkerRss = rss; sampledPeakWorkerRss = Math.max(sampledPeakWorkerRss, rss);
      sampledPeakCombinedRss = Math.max(sampledPeakCombinedRss, rss + process.memoryUsage().rss);
      if (sampledPeakCombinedRss > memoryLimitBytes) fail(new Error("Flop sampled combined RSS exceeds budget"));
    };
    const timer = setTimeout(() => fail(new Error("Flop job timed out; no completed result published")), Math.max(1, timeoutMs - (performance.now() - started)));
    const sampler = setInterval(() => {
      if (settled || polling || !worker.pid) return; polling = true;
      try { execFile("ps", ["-o", "rss=", "-p", String(worker.pid)], (error, stdout) => {
        polling = false; if (settled) return;
        if (error) { if (["EPERM", "EACCES", "ENOENT"].includes(String(error.code))) fail(new Error("Cannot sample flop worker memory")); return; }
        const rss = Number(stdout.trim()) * 1024; if (Number.isFinite(rss) && rss > 0) observe(rss);
      }); } catch (error) { polling = false; fail(new Error(`Cannot sample flop worker memory: ${String(error)}`)); }
    }, 200);
    options.signal?.addEventListener("abort", cancel, { once: true }); if (options.signal?.aborted) cancel();
    worker.stderr?.on("data", data => { diagnostics = (diagnostics + String(data)).slice(-4096); }); worker.on("error", fail);
    worker.on("message", (message: FlopWorkerMessage) => {
      if (settled) return;
      try {
        if (message.type === "error") fail(new Error(message.message));
        else if (message.type === "result") { complete = true; observe(lastWorkerRss); }
        else { observe(message.rssBytes); options.onProgress?.({ ...message, elapsedMs: performance.now() - started }); }
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    worker.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0 || signal || !complete) { fail(new Error(`Flop worker incomplete (${code ?? signal}): ${diagnostics}`)); return; }
      try {
        const manifest = join(outputDirectory, "artifact.json"), policyPath = join(outputDirectory, "policy.f64.gz");
        if (statSync(manifest).size > 65536) throw new Error("Flop manifest exceeds 64 KiB");
        const json = readFileSync(manifest, "utf8"); statSync(policyPath);
        observe(0); if (performance.now() - started > timeoutMs) throw new Error("Flop job timed out during export");
        if (settled) return; settled = true; cleanup();
        resolveJob({ outputDirectory, json, policyPath, elapsedMs: performance.now() - started, memoryLimitBytes, sampledPeakWorkerRss, sampledPeakCombinedRss });
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    if (!settled) worker.send({ ...job, options: checked, outputDirectory, memoryLimitBytes,
      checkpointPath: options.checkpointPath ? resolve(options.checkpointPath) : undefined,
      resumePath: options.resumePath ? resolve(options.resumePath) : undefined, checkpointEvery: options.checkpointEvery });
  });
}
