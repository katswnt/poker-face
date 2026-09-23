import { estimateCall, estimateEquity, TRAINER_EQUITY_SAMPLES } from "./equity";
import { calculateTrainerHand } from "./trainer-hand";
import type { TrainerTask, TrainerResult, TrainerWorkerRequest, TrainerWorkerResponse } from "./trainer-worker-protocol";

export function calculateTrainerTask(task: TrainerTask): TrainerResult {
  switch (task.kind) {
    case "hand": return { kind: "hand", stages: calculateTrainerHand(task.input) };
    case "call": return { kind: "call", estimate: estimateCall(task.hole, task.board, task.quote, task.opponents, TRAINER_EQUITY_SAMPLES, task.style, task.seed) };
    case "comparison": return {
      kind: "comparison",
      rows: [1, 2, 3, 4, 5].map(opponents => ({ opponents, estimate: estimateEquity(task.hole, task.board, opponents, TRAINER_EQUITY_SAMPLES, task.style, task.seed) })),
    };
    default: throw new Error("Unknown trainer calculation.");
  }
}

export function runTrainerWorkerRequest(request: TrainerWorkerRequest, now = () => performance.now()): TrainerWorkerResponse {
  const started = now();
  try {
    if (!Number.isSafeInteger(request.id) || request.id < 1) throw new Error("Invalid trainer request identifier.");
    const result = calculateTrainerTask(request.task);
    return { id: request.id, type: "complete", result, elapsedMs: Math.max(0, now() - started) };
  } catch (error) {
    return { id: request.id, type: "error", message: error instanceof Error ? error.message : "The trainer calculation failed." };
  }
}
