"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createTrainerTaskStore, type TrainerWorkerPort } from "@/lib/poker/trainer-worker-store";
import type { TrainerTask } from "@/lib/poker/trainer-worker-protocol";

export function useTrainerTask(task: TrainerTask | null, retry = 0) {
  // Complete raw input identity, not a lossy hash. No worker is created in render.
  const key = JSON.stringify({ task, retry });
  const store = useMemo(() => createTrainerTaskStore((JSON.parse(key) as { task: TrainerTask | null }).task, () => {
    if (typeof Worker === "undefined") throw new Error("Web Workers unavailable.");
    return new Worker(new URL("./trainer.worker.ts", import.meta.url), { type: "module" }) as unknown as TrainerWorkerPort;
  }), [key]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
