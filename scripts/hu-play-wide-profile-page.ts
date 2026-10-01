// Private study page: production client/runtime, exact-input parser shim at bundle time.
import { createLiveClient } from "../src/lib/solver/bridge/live/client";
import type { LiveCommand, LiveEvent } from "../src/lib/solver/bridge/live/model";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import type { MeasuredLiveEvent } from "./bridge-live-profile.worker";
import { mathProjection, summarizeWideEvents } from "./hu-play-wide-measurement";

type Request = Omit<Exclude<LiveCommand, { type: "cancel" }>, "id">;
async function run(request: Request) {
  const events: MeasuredLiveEvent[] = [];
  let workers = 0, terminated = 0, terminalElapsedMs = 0;
  const started = performance.now();
  let resolve!: (event: LiveEvent) => void;
  const terminal = new Promise<LiveEvent>(r => { resolve = r; });
  const client = createLiveClient({ now: () => performance.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: id => clearTimeout(id as number),
    createWorker: () => {
      workers++; const worker = new Worker("/profile-worker.mjs", { type: "module" });
      const terminate = worker.terminate.bind(worker); worker.terminate = () => { terminated++; terminate(); }; return worker;
    },
  }, event => {
    events.push(event as MeasuredLiveEvent);
    if (["result", "error", "cancelled"].includes(event.type) || (event.type === "estimate" && !event.verdict.ok)) {
      terminalElapsedMs = performance.now() - started; resolve(event);
    }
  });
  try {
    client.start(request); const final = await terminal;
    const measured = summarizeWideEvents(events, terminalElapsedMs);
    let numericalHash: string | null = null;
    if (final.type === "result") {
      numericalHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(canonicalSolverJson(mathProjection(final.result)))))]
        .map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return { ...measured, numericalHash, workers, terminated, isolated: globalThis.crossOriginIsolated };
  } finally { client.dispose(); }
}
(globalThis as unknown as { profileWideJob: typeof run }).profileWideJob = run;
export type WideBrowserMeasurement = Awaited<ReturnType<typeof run>>;
