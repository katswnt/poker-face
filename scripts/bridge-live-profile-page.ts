import { createLiveClient } from "../src/lib/solver/bridge/live/client";
import type { LiveCommand, LiveEvent } from "../src/lib/solver/bridge/live/model";
import { summarizeMeasuredJob } from "./bridge-live-measurement";
import type { MeasuredLiveEvent } from "./bridge-live-profile.worker";

type Request = Omit<Exclude<LiveCommand, { type: "cancel" }>, "id">;
async function run(request: Request) {
  const events: MeasuredLiveEvent[] = []; let workers = 0, terminated = 0;
  const started = performance.now(); let terminalElapsedMs = 0;
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
    if (["result", "error", "cancelled"].includes(event.type)
      || (event.type === "estimate" && !event.verdict.ok)) {
      terminalElapsedMs = performance.now() - started; resolve(event);
    }
  });
  try {
    client.start(request); const final = await terminal;
    const measured = summarizeMeasuredJob(events, terminalElapsedMs);
    let digest: string | null = null;
    if (final.type === "result") {
      const { timings, memory, ...math } = final.result; void timings; void memory;
      const projection = { ...math, convergence: final.result.convergence.map(({ iteration, exploitability }) => ({ iteration, exploitability })) };
      digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(projection))))]
        .map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return { ...measured, digest, workers, terminated, isolated: globalThis.crossOriginIsolated };
  } finally { client.dispose(); }
}
(globalThis as unknown as { profileLiveJob: typeof run }).profileLiveJob = run;
export type BrowserJobMeasurement = Awaited<ReturnType<typeof run>>;
