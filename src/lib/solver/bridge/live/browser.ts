import { createLiveClient } from "./client";
import type { LiveEvent } from "./model";

/** Lazy: call from a client-side event/effect, never during server rendering. W4 wires UI. */
export function createBrowserSolver(emit: (event: LiveEvent) => void) {
  return createLiveClient({
    createWorker: () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "poker-face-postflop-st" }),
    now: () => performance.now(), setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  }, emit);
}
