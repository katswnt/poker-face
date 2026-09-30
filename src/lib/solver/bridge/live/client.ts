import { LIVE_LIMITS, parseLiveSpot } from "./admission";
import type { LiveCommand, LiveEvent } from "./model";

export interface LiveWorker {
  postMessage(command: LiveCommand): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<LiveEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}
export interface ClientHost {
  createWorker(): LiveWorker;
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}
type Request = Omit<Exclude<LiveCommand, { type: "cancel" }>, "id">;

/** Main-thread lifecycle only. Math, hashing, parsing the result and grading stay in Worker.
 * Cancelling immediately revokes publication; a main-thread timer can kill synchronous WASM.
 * Every request (even preflight) owns a new Worker. Disposing is silent and immediate. */
export function createLiveClient(host: ClientHost, emit: (event: LiveEvent) => void) {
  let nextId = 1, disposed = false;
  let job: { id: number; worker: LiveWorker; timer: unknown; started: number; cancelling: boolean; request: Request } | null = null;
  const retire = () => {
    const current = job; job = null;
    if (current) {
      host.clearTimer(current.timer);
      current.worker.onmessage = current.worker.onerror = current.worker.onmessageerror = null;
      current.worker.terminate();
    }
  };
  const fail = (id: number, message: string) => { retire(); emit({ type: "error", id, message }); };
  const cancelled = (id: number, started: number, hard: boolean) => {
    const elapsedMs = host.now() - started; retire(); emit({ type: "cancelled", id, elapsedMs, hard });
  };
  return {
    start(request: Request): number {
      if (disposed) throw new Error("Solver client is disposed.");
      retire(); const id = nextId++;
      try {
        const spot = parseLiveSpot(request.spotJson);
        const worker = host.createWorker(), started = host.now();
        job = { id, worker, started, cancelling: false, request, timer: undefined };
        job.timer = host.setTimer(() => {
          if (job?.id === id) fail(id, "Browser job timed out (including loading/export); no result published.");
        }, spot.solve.timeoutMs);
        worker.onmessage = ({ data: event }) => {
          if (job?.id !== id || event?.id !== id) return;
          if (job.cancelling) {
            if (event.type === "cancelled") cancelled(id, started, false);
            return;
          }
          if (host.now() - started > spot.solve.timeoutMs) { fail(id, "Browser job timed out; no result published."); return; }
          if (!["progress", "preview", "estimate", "result", "error"].includes(event.type)) {
            fail(id, "Invalid solver Worker message."); return;
          }
          const terminal = event.type === "result" || event.type === "error"
            || (event.type === "estimate" && (request.type === "estimate" || !event.verdict?.ok));
          if (event.type === "result" && (!event.result || event.result.spotId !== spot.id)) {
            fail(id, "Worker returned a result for another spot."); return;
          }
          if (terminal) retire();
          emit(event);
        };
        const workerFailed = (message: string) => {
          if (job?.id !== id) return;
          if (job.cancelling) cancelled(id, started, true); else fail(id, message);
        };
        worker.onerror = event => { event.preventDefault(); workerFailed("Solver Worker failed; start a new job to retry."); };
        worker.onmessageerror = () => workerFailed("Solver Worker message could not be read.");
        worker.postMessage({ ...request, id });
      } catch (error) { fail(id, error instanceof Error ? error.message : String(error)); }
      return id;
    },
    cancel(): void {
      if (!job || job.cancelling) return;
      const { id, worker, started } = job;
      job.cancelling = true; host.clearTimer(job.timer);
      job.timer = host.setTimer(() => {
        if (job?.id !== id) return;
        cancelled(id, started, true);
      }, LIVE_LIMITS.cancelGraceMs);
      try { worker.postMessage({ type: "cancel", id }); } catch {
        cancelled(id, started, true);
      }
    },
    dispose(): void { disposed = true; retire(); },
  };
}
