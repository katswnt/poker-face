/// <reference lib="webworker" />
import { runTrainerWorkerRequest } from "@/lib/poker/trainer-worker-runtime";
import type { TrainerWorkerRequest } from "@/lib/poker/trainer-worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<TrainerWorkerRequest>) => {
  scope.postMessage(runTrainerWorkerRequest(event.data));
};
