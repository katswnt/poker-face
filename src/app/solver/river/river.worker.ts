import { createRiverLabRuntime } from "@/lib/solver/river/lab/runtime";
import type { RiverLabCommand, RiverLabEvent } from "@/lib/solver/river/lab/model";

const worker = globalThis as unknown as {
  postMessage(message: RiverLabEvent): void;
  onmessage: ((event: MessageEvent<RiverLabCommand>) => void) | null;
};
const runtime = createRiverLabRuntime({
  emit: event => worker.postMessage(event),
  now: () => performance.now(),
  yield: () => new Promise(resolve => setTimeout(resolve, 0)),
});
worker.onmessage = event => { void runtime.handle(event.data); };
