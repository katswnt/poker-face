import type { TurnRequest } from "../../turn/game";
import type { VectorTurnOptions, VectorCheckpoint } from "./session";
import type { VectorConvergence } from "./artifact-node";

export const VECTOR_GRADE_ITERATIONS = [256, 1024, 4096, 16384, 65536, 100000] as const;
export interface VectorJob {
  readonly request: TurnRequest;
  readonly options: VectorTurnOptions;
  readonly maximumExploitability: number;
  readonly resume?: VectorCheckpoint;
  readonly checkpointEvery?: number;
}
export interface VectorProgress {
  readonly type: "progress";
  readonly stage: "compiling" | "solving" | "grading" | "checkpointing" | "exporting";
  readonly iterations: number;
  readonly requestedIterations: number;
  readonly regretPasses: number;
  readonly elapsedMs: number;
  readonly rssBytes: number;
  readonly lastGrade?: VectorConvergence;
}
export type VectorWorkerMessage = VectorProgress | { readonly type: "checkpoint"; readonly json: string }
  | { readonly type: "result"; readonly json: string } | { readonly type: "error"; readonly message: string };
