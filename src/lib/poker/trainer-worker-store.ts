import type { TrainerTask, TrainerResult, TrainerWorkerRequest, TrainerWorkerResponse } from "./trainer-worker-protocol";

export interface TrainerWorkerPort {
  postMessage(request: TrainerWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<TrainerWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export type TrainerTaskSnapshot =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "complete"; result: TrainerResult; elapsedMs: number };

// Subscription owns the worker. React can subscribe/unsubscribe twice in strict
// mode; each run has a new ID, and an old worker can never publish into a new run.
export function createTrainerTaskStore(task: TrainerTask | null, createWorker: () => TrainerWorkerPort) {
  let snapshot: TrainerTaskSnapshot = task ? { status: "pending" } : { status: "idle" };
  let worker: TrainerWorkerPort | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: TrainerTaskSnapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  const stop = () => {
    generation += 1;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
  };
  const start = () => {
    if (!task || snapshot.status === "complete" || snapshot.status === "error") return;
    const id = ++generation;
    const fail = (message: string) => { if (generation !== id) return; stop(); publish({ status: "error", message }); };
    try {
      worker = createWorker();
      worker.onmessage = event => {
        if (generation !== id || event.data.id !== id) return;
        if (event.data.type === "error") { fail(event.data.message); return; }
        if (event.data.type !== "complete" || event.data.result?.kind !== task.kind || !Number.isFinite(event.data.elapsedMs)) {
          fail("The trainer returned an invalid result. Please retry."); return;
        }
        stop();
        publish({ status: "complete", result: event.data.result, elapsedMs: event.data.elapsedMs });
      };
      worker.onerror = () => fail("The background trainer could not finish. Please retry.");
      worker.onmessageerror = () => fail("The background trainer response could not be read. Please retry.");
      worker.postMessage({ id, task });
    } catch {
      fail("Background calculations are unavailable in this browser. Please try a browser with Web Worker support.");
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => { listeners.delete(listener); if (listeners.size === 0) stop(); };
    },
  };
}
