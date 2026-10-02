/** Real public controllers and production Workers; identical frozen cases to native. */
import type { BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { BrowserPublicSolver } from "../src/lib/hu-play/sources/browser";
import { createLiveClient } from "../src/lib/solver/bridge/live/client";
import type { LiveEvent } from "../src/lib/solver/bridge/live/model";
import { sha256 } from "../src/lib/solver/bridge/live/loader";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { mathProjection } from "./hu-play-wide-measurement";
import { playFlopCase } from "./hu-play-p4-playing-case";
import type { FlopOffTreeCase } from "./hu-play-p4-corpus";

const profileOf = (s: BridgeSpotV1) => s.tree.mode === "turn-subgame-v1" ? "play-turn-v1" as const
  : s.tree.mode === "river-subgame-v1" ? "play-river-v1" as const : "play-v1" as const;
async function run(c: FlopOffTreeCase, assetBase: string, measured: boolean) {
  const events: (LiveEvent & { observedLinearMemoryBytes?: number | null })[] = [];
  const results: BridgeResultV1[] = [], runners = new Map<ReturnType<typeof profileOf>, BrowserPublicSolver>();
  const attempts: { spotHash: string; street: "turn" | "river"; accepted: boolean; error: string | null; elapsedMs: number }[] = [];
  let workers = 0, terminated = 0;
  const runnerFor = (profile: ReturnType<typeof profileOf>) => {
    let runner = runners.get(profile);
    if (!runner) {
      runner = new BrowserPublicSolver({ assetBase, profile, environment: { profile: "unknown" }, onEvent: e => { events.push(e); },
        createClient: emit => createLiveClient({ now: () => performance.now(),
          setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: id => clearTimeout(id as number), createWorker: () => {
            workers++; const worker = new Worker(measured ? "/measured-worker.mjs" : "/play-worker.mjs", { type: "module" });
            const terminate = worker.terminate.bind(worker); worker.terminate = () => { terminated++; terminate(); }; return worker;
          } }, emit) });
      runners.set(profile, runner);
    }
    return runner;
  };
  let completed: Awaited<ReturnType<typeof playFlopCase>> | undefined, error: string | null = null;
  const catalog = await loadPlayCatalog();
  const started = performance.now();
  try { completed = await playFlopCase(c, catalog, async (spot, signal) => {
    const began = performance.now();
    const record = { spotHash: await sha256(new TextEncoder().encode(canonicalSolverJson(spot))),
      street: spot.board.river === null ? "turn" as const : "river" as const,
      accepted: false, error: null as string | null, elapsedMs: 0 }; attempts.push(record);
    try { const result = await runnerFor(profileOf(spot)).solve(spot, signal);
      record.accepted = true; results.push(result); return result;
    } catch (e) { record.error = String(e); throw e; }
    finally { record.elapsedMs = performance.now() - began; }
  }); } catch (e) { error = String(e); }
  finally { for (const runner of runners.values()) runner.dispose(); }
  const failedElapsedMs = performance.now() - started;
  const hash = (v: unknown) => sha256(new TextEncoder().encode(canonicalSolverJson(v) + "\n"));
  const statusBytes = events.flatMap(e => e.type === "progress" && e.status ? [e.status.linearMemoryBytes] : []);
  const observedBytes = events.flatMap(e => typeof e.observedLinearMemoryBytes === "number" ? [e.observedLinearMemoryBytes] : []);
  return { passed: !!completed && error === null, error, elapsedMs: completed?.elapsedMs ?? failedElapsedMs,
    responseElapsedMs: completed?.responseElapsedMs ?? null, logHash: completed?.logHash ?? null,
    passiveResponses: completed?.passiveResponses ?? null, workers, terminated, isolated: globalThis.crossOriginIsolated,
    publicSolveKeys: attempts.map(a => a.spotHash), attempts,
    solves: await Promise.all(results.map(async r => ({ spotHash: r.spotHash, numericalHash: await hash(mathProjection(r)),
      iterations: r.iterations, rawExploitability: r.exploitability }))),
    estimates: events.flatMap(e => e.type === "estimate" ? [{ estimate: e.estimate, verdict: e.verdict }] : []),
    maxStatusLinearMemoryBytes: statusBytes.length ? Math.max(...statusBytes) : null,
    observedPeakLinearMemoryBytes: measured && observedBytes.length ? Math.max(...observedBytes) : null,
    events: events.map(e => e.type) };
}
(globalThis as unknown as { profileFlopJob: typeof run }).profileFlopJob = run;
export type P4BrowserMeasurement = Awaited<ReturnType<typeof run>>;
