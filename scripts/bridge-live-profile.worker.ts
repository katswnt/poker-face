// Measurement-only entry: exactly the production runtime/loader/yield, with an observation
// at each event. Reading memory after finish captures growth hidden by the last solve status.
import { loadLiveEngine, sha256 } from "../src/lib/solver/bridge/live/loader";
import { createLiveRuntime } from "../src/lib/solver/bridge/live/runtime";
import type { LiveCommand, LiveEngine, LiveEvent } from "../src/lib/solver/bridge/live/model";

export type MeasuredLiveEvent = LiveEvent & { observedLinearMemoryBytes: number | null };
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<LiveCommand>) => void) | null;
  postMessage(event: MeasuredLiveEvent): void; close(): void;
};
let engine: LiveEngine | undefined;
const runtime = createLiveRuntime({
  emit: event => scope.postMessage({ ...event, observedLinearMemoryBytes: engine?.memoryBytes() ?? null }),
  now: () => performance.now(), yield: () => new Promise(resolve => setTimeout(resolve, 0)), hash: sha256,
  load: async base => { engine = await loadLiveEngine(base); return engine; }, close: () => scope.close(),
});
scope.onmessage = event => { void runtime.handle(event.data); };
