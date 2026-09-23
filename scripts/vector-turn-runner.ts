import { fork } from "node:child_process";
import { totalmem } from "node:os";
import { preflightVectorTurn, VECTOR_MEMORY_LIMIT } from "../src/lib/solver/postflop/vector/game";
import { validateVectorOptions } from "../src/lib/solver/postflop/vector/session";
import { createVectorCheckpointWriter } from "../src/lib/solver/postflop/vector/artifact-node";
import type { VectorJob, VectorProgress, VectorWorkerMessage } from "../src/lib/solver/postflop/vector/protocol";

export interface VectorRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: VectorProgress) => void;
  readonly checkpointPath?: string;
}
export async function runVectorTurnJob(job: VectorJob, options: VectorRunOptions = {}): Promise<{
  json: string; elapsedMs: number; sampledPeakWorkerRssBytes: number;
}> {
  const started = performance.now(), timeoutMs = options.timeoutMs ?? 600000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error("Timeout must be 1..600000 ms");
  if (options.signal?.aborted) throw new Error("Vector solve cancelled");
  const checked = validateVectorOptions(job.options);
  if (!Number.isFinite(job.maximumExploitability) || job.maximumExploitability < 0) throw new Error("Invalid exploitability target");
  if (job.resume && JSON.stringify(validateVectorOptions(job.resume.options)) !== JSON.stringify(checked)) throw new Error("Resume options differ");
  if (job.checkpointEvery !== undefined && (!Number.isSafeInteger(job.checkpointEvery) || job.checkpointEvery < 1 || job.checkpointEvery > 100000)) throw new Error("Invalid checkpoint interval");
  const memoryLimit = Math.min(VECTOR_MEMORY_LIMIT, Math.floor(totalmem() / 8));
  if (!(memoryLimit > 0)) throw new Error("Available memory budget could not be established");
  preflightVectorTurn(job.request, memoryLimit);
  const save = options.checkpointPath ? createVectorCheckpointWriter(options.checkpointPath) : undefined;
  if (performance.now() - started >= timeoutMs) throw new Error("Vector solve timed out before worker start");
  return new Promise((resolve, reject) => {
    const worker = fork(new URL("./vector-turn-worker.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx", `--max-old-space-size=${Math.max(64, Math.floor(memoryLimit / 1024 / 1024 * 0.75))}`],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let settled = false, pending: string | undefined, diagnostics = "", sampledPeakWorkerRssBytes = 0;
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); worker.kill("SIGKILL"); reject(error); };
    const abort = () => fail(new Error("Vector solve cancelled; last completed checkpoint retained if saved"));
    const timer = setTimeout(() => fail(new Error("Vector solve timed out; no accepted result exported")), Math.max(1, timeoutMs - (performance.now() - started)));
    worker.stderr?.on("data", data => { diagnostics = (diagnostics + String(data)).slice(-4096); });
    worker.on("error", fail);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    worker.on("message", (message: VectorWorkerMessage) => {
      if (settled) return;
      try {
        if (message.type === "error") fail(new Error(message.message));
        else if (message.type === "result") pending = message.json;
        else if (message.type === "checkpoint") save?.(message.json);
        else {
          sampledPeakWorkerRssBytes = Math.max(sampledPeakWorkerRssBytes, message.rssBytes);
          if (message.rssBytes > memoryLimit) { fail(new Error("Vector worker sampled RSS exceeded its memory budget")); return; }
          options.onProgress?.({ ...message, elapsedMs: performance.now() - started });
        }
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    worker.on("close", (code, signal) => {
      if (settled) return;
      if (performance.now() - started > timeoutMs) { fail(new Error("Vector solve timed out; no accepted result exported")); return; }
      if (code !== 0 || signal || !pending) { fail(new Error(`Vector worker ended without a complete result (${code ?? signal}): ${diagnostics}`)); return; }
      settled = true; cleanup(); resolve({ json: pending, elapsedMs: performance.now() - started, sampledPeakWorkerRssBytes });
    });
    if (!settled) worker.send({ ...job, options: checked, checkpointEvery: save ? job.checkpointEvery ?? 256 : undefined });
  });
}
