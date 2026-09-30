import { loadLiveEngine, sha256 } from "./loader";
import { createLiveRuntime } from "./runtime";
import type { LiveCommand, LiveEvent } from "./model";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<LiveCommand>) => void) | null;
  postMessage(event: LiveEvent): void; close(): void;
};
const runtime = createLiveRuntime({ emit: event => scope.postMessage(event), now: () => performance.now(),
  yield: () => new Promise(resolve => setTimeout(resolve, 0)), hash: sha256, load: loadLiveEngine, close: () => scope.close() });
scope.onmessage = event => { void runtime.handle(event.data); };
