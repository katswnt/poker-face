import { fork } from "node:child_process";
import { COMPACT_TURN_MEMORY_LIMIT, preflightCompactTurn } from "../src/lib/solver/postflop/compact-turn";
import { validateCompactTurnOptions } from "../src/lib/solver/postflop/session";
import type { CompactTurnJob, CompactTurnProgress, CompactTurnWorkerMessage } from "../src/lib/solver/postflop/protocol";

export interface CompactTurnRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: CompactTurnProgress) => void;
}

/** Owns cancellation outside all compile/solve/grade/export work. Never returns a partial policy. */
export async function runCompactTurnJob(job: CompactTurnJob, options: CompactTurnRunOptions = {}): Promise<{
  json: string; elapsedMs: number; sampledPeakWorkerRssBytes: number;
}> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error("Timeout must be 1..600000 ms");
  if (options.signal?.aborted) throw new Error("Compact turn cancelled");
  const validatedOptions = validateCompactTurnOptions(job.options);
  preflightCompactTurn(job.request);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const worker = fork(new URL("./compact-turn-worker.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx", "--max-old-space-size=384"], stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let settled = false, pending: string | undefined, sampledPeakWorkerRssBytes = 0, diagnostics = "";
    const clean = () => { clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; clean(); worker.kill("SIGKILL"); reject(error);
    };
    const abort = () => fail(new Error("Compact turn cancelled; no completed result exported"));
    const timeout = setTimeout(() => fail(new Error("Compact turn timed out; no completed result exported")), timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    worker.stderr?.on("data", data => { diagnostics = (diagnostics + String(data)).slice(-4096); });
    worker.on("error", fail);
    worker.on("message", (message: CompactTurnWorkerMessage) => {
      if (settled) return;
      if (message.type === "error") fail(new Error(message.message));
      else if (message.type === "result") pending = message.json;
      else if (message.type === "progress") {
        sampledPeakWorkerRssBytes = Math.max(sampledPeakWorkerRssBytes, message.rssBytes);
        if (message.rssBytes > COMPACT_TURN_MEMORY_LIMIT) { fail(new Error("Compact turn sampled worker RSS exceeded 512 MiB")); return; }
        try { options.onProgress?.({ ...message, elapsedMs: performance.now() - started }); }
        catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    worker.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0 || signal || !pending) { fail(new Error(`Compact turn worker exited without a completed result (${code ?? signal}): ${diagnostics}`)); return; }
      settled = true; clean();
      resolve({ json: pending, elapsedMs: performance.now() - started, sampledPeakWorkerRssBytes });
    });
    if (!settled) worker.send({ request: job.request, options: validatedOptions });
  });
}
