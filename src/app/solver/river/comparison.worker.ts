import { createRiverComparisonRuntime } from "@/lib/solver/river/lab/comparison-runtime";
import type { RiverComparisonCommand, RiverComparisonEvent } from "@/lib/solver/river/lab/comparison";

const worker = globalThis as unknown as {
  postMessage(message: RiverComparisonEvent): void;
  onmessage: ((event: MessageEvent<RiverComparisonCommand>) => void) | null;
};
const runtime = createRiverComparisonRuntime({
  emit: event => worker.postMessage(event), now: () => performance.now(),
  yield: () => new Promise(resolve => setTimeout(resolve, 0)),
});
worker.onmessage = event => { void runtime.handle(event.data); };
