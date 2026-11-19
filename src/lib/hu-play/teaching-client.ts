import type { RangeEquityInput } from "./teaching";
import type { TeachingEvent } from "./teaching-worker";

export interface TeachingWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
  terminate(): void;
}
export class TeachingClient {
  private worker: TeachingWorker | null = null;
  private serial = 0;
  private disposed = false;
  constructor(private readonly emit: (event: TeachingEvent) => void,
    private readonly create: () => TeachingWorker = () => new Worker(new URL("./teaching.worker.ts", import.meta.url), { type: "module" })) {}
  private stop() { this.worker?.terminate(); this.worker = null; }
  start(input: RangeEquityInput): number {
    if (this.disposed) throw new Error("Teaching client is disposed");
    this.stop(); const id = ++this.serial;
    try {
      const w = this.create(); this.worker = w;
      const current = () => !this.disposed && this.worker === w && id === this.serial;
      const error = () => { if (current()) { this.stop(); this.emit({ type: "error", id, message: "Equity Worker unavailable. Retry; no main-thread calculation was substituted." }); } };
      w.onmessage = event => {
        if (!current()) return;
        const value = event.data as TeachingEvent;
        if (!value || value.id !== id) return;
        if (!["result", "progress", "error"].includes(value.type)) { error(); return; }
        if (value.type !== "progress") this.stop();
        this.emit(value);
      };
      w.onerror = error; w.onmessageerror = error;
      w.postMessage({ type: "equity", id, input });
    } catch { this.stop(); this.emit({ type: "error", id, message: "Could not start the equity Worker. Retry in a browser with Worker support." }); }
    return id;
  }
  cancel(): void { if (this.worker && !this.disposed) { const id = this.serial; this.stop(); this.serial++; this.emit({type: "cancelled", id}); } }
  dispose(): void { if (!this.disposed) { this.disposed = true; this.serial++; this.stop(); } }
}
