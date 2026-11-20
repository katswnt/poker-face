// Measurement-only entry: exactly the production runtime/loader/yield, with an observation
// at each event. Reading memory after finish captures growth hidden by the last solve status.
import { loadLiveEngine, sha256 } from "../src/lib/solver/bridge/live/loader";
import { createLiveRuntime } from "../src/lib/solver/bridge/live/runtime";
import type { LiveCommand, LiveEngine, LiveEvent } from "../src/lib/solver/bridge/live/model";
import { observeLiveExports } from "./bridge-live-observation";

export type MeasuredLiveEvent = LiveEvent & { observedLinearMemoryBytes: number | null;
  observedExport: { jsonBytes: number; elapsedMs: number } | null; observedWorkerHeapBytes: number | null };
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<LiveCommand>) => void) | null;
  postMessage(event: MeasuredLiveEvent): void; close(): void;
};
let engine: LiveEngine | undefined;
let observation: ReturnType<typeof observeLiveExports> | undefined;
const runtime = createLiveRuntime({
  emit: event => scope.postMessage({ ...event, observedLinearMemoryBytes: engine?.memoryBytes() ?? null,
    observedExport: observation?.read() ?? null,
    observedWorkerHeapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null }),
  now: () => performance.now(), yield: () => new Promise(resolve => setTimeout(resolve, 0)), hash: sha256,
  load: async base => { observation = observeLiveExports(await loadLiveEngine(base), () => performance.now());
    engine = observation.engine; return engine; }, close: () => scope.close(),
});
scope.onmessage = event => { void runtime.handle(event.data); };
