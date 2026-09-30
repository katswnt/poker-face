// Test page only; bundles the production client, while /worker.mjs is the production entry.
import { createLiveClient } from "../src/lib/solver/bridge/live/client";
import type { LiveCommand, LiveEvent } from "../src/lib/solver/bridge/live/model";

type Request = Omit<Exclude<LiveCommand, { type: "cancel" }>, "id">;
const page = globalThis as unknown as { runLiveHarness: typeof run };
async function run(request: Request, cancelStage?: string, busy = false) {
  const events: LiveEvent[] = []; let heartbeat = 0, workers = 0, terminated = 0;
  const timer = setInterval(() => heartbeat++, 5), started = performance.now();
  let resolve!: (event: LiveEvent) => void;
  const terminal = new Promise<LiveEvent>(r => { resolve = r; });
  const client = createLiveClient({ now: () => performance.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: id => clearTimeout(id as number),
    createWorker: () => {
      workers++; const worker = new Worker(busy ? (cancelStage ? `/busy-${cancelStage}.mjs` : "/busy.mjs") : "/worker.mjs", { type: "module" });
      const terminate = worker.terminate.bind(worker); worker.terminate = () => { terminated++; terminate(); }; return worker;
    },
  }, event => {
    events.push(event);
    if (event.type === "progress" && event.stage === cancelStage) client.cancel();
    if (["result", "cancelled", "error"].includes(event.type)
      || (event.type === "estimate" && (request.type === "estimate" || !event.verdict.ok))) resolve(event);
  });
  try {
    client.start(request);
    if (busy && !cancelStage) setTimeout(() => client.cancel(), 30);
    const final = await terminal;
    // Exercise suppression of late queued messages, not just the first terminal callback.
    await new Promise(r => setTimeout(r, 40));
    let digest: string | undefined;
    if (final.type === "result") {
      const { timings, memory, ...math } = final.result; void timings; void memory;
      const projection = { ...math, convergence: final.result.convergence.map(({ iteration, exploitability }) => ({ iteration, exploitability })) };
      digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(projection))))]
        .map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return { digest, final: final.type === "result" ? { type: final.type, iterations: final.result.iterations } : final,
      heartbeat, workers, terminated, elapsedMs: performance.now() - started, isolated: globalThis.crossOriginIsolated,
      stages: events.filter(e => e.type === "progress").map(e => e.stage),
      progress: events.flatMap(e => e.type === "progress" && e.status ? [e.status] : []),
      resultCount: events.filter(e => e.type === "result").length,
      terminalCount: events.filter(e => ["result", "cancelled", "error"].includes(e.type)).length,
    };
  } finally { client.dispose(); clearInterval(timer); }
}
page.runLiveHarness = run;
