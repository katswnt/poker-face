/** Measurement entry only. Actual production source/client/Worker, no parser replacement. */
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { BrowserResolveSource } from "../src/lib/hu-play/sources/browser";
import { createLiveClient } from "../src/lib/solver/bridge/live/client";
import type { LiveEvent } from "../src/lib/solver/bridge/live/model";
import { sha256 } from "../src/lib/solver/bridge/live/loader";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { mathProjection } from "./hu-play-wide-measurement";

async function run(request: HumanModelRequest, assetBase: string) {
  const events: LiveEvent[] = []; let workers = 0, terminated = 0;
  const source = new BrowserResolveSource({ assetBase, environment: { profile: "unknown" }, onEvent: e => { events.push(e); },
    createClient: emit => createLiveClient({ now: () => performance.now(), setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: id => clearTimeout(id as number), createWorker: () => {
        workers++; const worker = new Worker("/play-worker.mjs", { type: "module" });
        const terminate = worker.terminate.bind(worker); worker.terminate = () => { terminated++; terminate(); }; return worker;
      } }, emit) });
  const started = performance.now();
  let error: string | null = null;
  try { await source.prepare(request); source.policy(request); }
  catch (e) { error = e instanceof Error ? e.message : String(e); }
  const elapsedMs = performance.now() - started;
  source.dispose(); // disposal is counted; result fingerprinting is outside the latency window
  const final = events.findLast(e => e.type === "result"), estimate = events.find(e => e.type === "estimate");
  const status = events.flatMap(e => e.type === "progress" && e.status ? [e.status] : []);
  return { passed: error === null && final?.type === "result", error, elapsedMs, workers, terminated,
    isolated: globalThis.crossOriginIsolated, numericalHash: final?.type === "result"
      ? await sha256(new TextEncoder().encode(canonicalSolverJson(mathProjection(final.result)))) : null,
    iterations: final?.type === "result" ? final.result.iterations : null,
    exploitability: final?.type === "result" ? final.result.exploitability : null,
    reservedBytes: estimate?.type === "estimate" ? estimate.verdict.totalBytes : null,
    budgetBytes: estimate?.type === "estimate" ? estimate.verdict.budgetBytes : null,
    // Production status reports allocation/iteration memory, not finish's growth. Do not
    // mislabel this as the full WASM peak; full export peaks are in the W2 study harness.
    maxStatusLinearMemoryBytes: status.length ? Math.max(...status.map(s => s.linearMemoryBytes)) : null };
}
(globalThis as unknown as { profilePlayJob: typeof run }).profilePlayJob = run;
export type P1BrowserMeasurement = Awaited<ReturnType<typeof run>>;
