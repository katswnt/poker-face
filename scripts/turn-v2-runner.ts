import { fork } from "node:child_process";
import { totalmem } from "node:os";
import { preflightTurnV2, TURN_V2_MEMORY_LIMIT } from "../src/lib/solver/postflop/configurable-turn/game";
import type { TurnV2Job, TurnV2Progress, TurnV2WorkerMessage } from "../src/lib/solver/postflop/configurable-turn/protocol";
import { validateVectorOptions } from "../src/lib/solver/postflop/vector/session";
import { createVectorCheckpointWriter } from "../src/lib/solver/postflop/vector/artifact-node";

export interface TurnV2RunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: TurnV2Progress) => void;
  readonly checkpointPath?: string;
}
export async function runTurnV2Job(job: TurnV2Job, options: TurnV2RunOptions = {}): Promise<{
  json: string; elapsedMs: number; memoryLimitBytes: number; sampledPeakWorkerRssBytes: number;
  sampledPeakParentRssBytes: number; sampledPeakCombinedRssBytes: number;
}> {
  const started = performance.now(), timeoutMs = options.timeoutMs ?? 600000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error("Timeout must be 1..600000 ms");
  if (options.signal?.aborted) throw new Error("Turn v2 solve cancelled");
  const checked = validateVectorOptions(job.options);
  if (!Number.isFinite(job.maximumExploitability) || job.maximumExploitability < 0) throw new Error("Invalid exploitability target");
  if (job.minimumIterations !== undefined && (!Number.isSafeInteger(job.minimumIterations) || job.minimumIterations < 1
    || job.minimumIterations > checked.iterations)) throw new Error("Minimum iterations must be 1..requested iterations");
  if (job.resume && JSON.stringify(validateVectorOptions(job.resume.options)) !== JSON.stringify(checked)) throw new Error("Resume options differ");
  if (job.checkpointEvery !== undefined && (!Number.isSafeInteger(job.checkpointEvery) || job.checkpointEvery < 1 || job.checkpointEvery > 100000)) throw new Error("Invalid checkpoint interval");
  const memoryLimitBytes = Math.min(TURN_V2_MEMORY_LIMIT, Math.floor(totalmem() / 8));
  if (!(memoryLimitBytes > 0)) throw new Error("Memory budget could not be established");
  preflightTurnV2(job.request, memoryLimitBytes);
  const save = options.checkpointPath ? createVectorCheckpointWriter(options.checkpointPath) : undefined;
  let sampledPeakParentRssBytes = process.memoryUsage().rss;
  if (sampledPeakParentRssBytes > memoryLimitBytes) throw new Error("Turn v2 parent sampled RSS exceeded the job budget");
  if (performance.now() - started >= timeoutMs) throw new Error("Turn v2 solve timed out before worker start");
  return new Promise((resolve, reject) => {
    const worker = fork(new URL("./turn-v2-worker.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx", `--max-old-space-size=${Math.max(64, Math.floor(memoryLimitBytes / 1024 / 1024 * 0.75))}`],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let settled = false, pending: string | undefined, diagnostics = "", sampledPeakWorkerRssBytes = 0, sampledPeakCombinedRssBytes = sampledPeakParentRssBytes, lastWorkerRss = 0;
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); worker.kill("SIGKILL"); reject(error); };
    const abort = () => fail(new Error("Turn v2 solve cancelled; last completed checkpoint retained if saved"));
    const timer = setTimeout(() => fail(new Error("Turn v2 solve timed out; no accepted result exported")), Math.max(1, timeoutMs - (performance.now() - started)));
    const observe = () => {
      const parent = process.memoryUsage().rss;
      sampledPeakParentRssBytes = Math.max(sampledPeakParentRssBytes, parent);
      sampledPeakCombinedRssBytes = Math.max(sampledPeakCombinedRssBytes, parent + lastWorkerRss);
      if (parent + lastWorkerRss > memoryLimitBytes) throw new Error("Turn v2 sampled parent plus worker RSS exceeded its memory budget");
    };
    worker.stderr?.on("data", data => { diagnostics = (diagnostics + String(data)).slice(-4096); });
    worker.on("error", fail); options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    worker.on("message", (message: TurnV2WorkerMessage) => {
      if (settled) return;
      try {
        if (message.type === "error") fail(new Error(message.message));
        else if (message.type === "result") pending = message.json;
        else if (message.type === "checkpoint") save?.(message.json);
        else {
          lastWorkerRss = message.rssBytes; sampledPeakWorkerRssBytes = Math.max(sampledPeakWorkerRssBytes, lastWorkerRss);
          observe(); options.onProgress?.({ ...message, elapsedMs: performance.now() - started });
        }
        observe();
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    worker.on("close", (code, signal) => {
      if (settled) return;
      if (performance.now() - started > timeoutMs) { fail(new Error("Turn v2 solve timed out; no accepted result exported")); return; }
      if (code !== 0 || signal || !pending) { fail(new Error(`Turn v2 worker ended without a complete result (${code ?? signal}): ${diagnostics}`)); return; }
      try { observe(); } catch (error) { fail(error as Error); return; }
      settled = true; cleanup(); resolve({ json: pending, elapsedMs: performance.now() - started, memoryLimitBytes,
        sampledPeakWorkerRssBytes, sampledPeakParentRssBytes, sampledPeakCombinedRssBytes });
    });
    if (!settled) worker.send({ ...job, options: checked, checkpointEvery: save ? job.checkpointEvery ?? 256 : undefined });
  });
}
