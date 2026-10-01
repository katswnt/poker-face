/** Browser measurement of the SAME real-source/reducer cases as the native audit. */
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { BrowserPublicSolver } from "../src/lib/hu-play/sources/browser";
import { createLiveClient } from "../src/lib/solver/bridge/live/client";
import type { LiveEvent } from "../src/lib/solver/bridge/live/model";
import { sha256 } from "../src/lib/solver/bridge/live/loader";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { mathProjection } from "./hu-play-wide-measurement";
import { playRiverCase, type RiverOffTreeCase } from "./hu-play-p2-playing-case";

async function run(c: RiverOffTreeCase, root: HumanModelRequest, blueprint: BridgeResultV1, assetBase: string, measured: boolean) {
  const events: (LiveEvent & { observedLinearMemoryBytes?: number | null })[] = [];
  const results: BridgeResultV1[] = []; let workers = 0, terminated = 0;
  const runner = new BrowserPublicSolver({ assetBase, profile: "play-river-v1", environment: { profile: "unknown" },
    onEvent: e => { events.push(e); }, createClient: emit => createLiveClient({ now: () => performance.now(),
      setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: id => clearTimeout(id as number), createWorker: () => {
        workers++; const worker = new Worker(measured ? "/measured-worker.mjs" : "/play-worker.mjs", { type: "module" });
        const terminate = worker.terminate.bind(worker); worker.terminate = () => { terminated++; terminate(); }; return worker;
      } }, emit) });
  let completed: Awaited<ReturnType<typeof playRiverCase>> | undefined, error: string | null = null;
  const started = performance.now();
  try { completed = await playRiverCase(c, root, blueprint, async (spot, signal) => {
    const result = await runner.solve(spot, signal); results.push(result); return result;
  }); } catch (e) { error = String(e); }
  const failedElapsedMs = performance.now() - started; runner.dispose();
  const hash = (value: unknown) => sha256(new TextEncoder().encode(canonicalSolverJson(value)));
  const estimates = events.flatMap(e => e.type === "estimate" ? [{ estimate: e.estimate, verdict: e.verdict }] : []);
  const statusBytes = events.flatMap(e => e.type === "progress" && e.status ? [e.status.linearMemoryBytes] : []);
  const observedBytes = events.flatMap(e => typeof e.observedLinearMemoryBytes === "number" ? [e.observedLinearMemoryBytes] : []);
  return { passed: !!completed && error === null, error, elapsedMs: completed?.elapsedMs ?? failedElapsedMs,
    logHash: completed?.logHash ?? null, provenance: completed?.provenance ?? null,
    workers, terminated, isolated: globalThis.crossOriginIsolated,
    solves: await Promise.all(results.map(async result => ({ spotHash: result.spotHash,
      numericalHash: await hash(mathProjection(result)), iterations: result.iterations, rawExploitability: result.exploitability }))),
    estimates, maxStatusLinearMemoryBytes: statusBytes.length ? Math.max(...statusBytes) : null,
    observedPeakLinearMemoryBytes: measured && observedBytes.length ? Math.max(...observedBytes) : null,
    events: events.map(e => e.type),
  };
}
(globalThis as unknown as { profileRiverJob: typeof run }).profileRiverJob = run;
export type P2BrowserMeasurement = Awaited<ReturnType<typeof run>>;
