import type { VectorTurnOptions } from "../vector/session";
import type { FlopRequest } from "./rules";
export interface FlopJob { request: FlopRequest; options: VectorTurnOptions; maximumExploitability: number }
export interface FlopProgress { type: "progress"; stage: "compiling" | "solving" | "grading" | "checkpointing" | "exporting";
  iterations: number; requestedIterations: number; elapsedMs: number; rssBytes: number; lastExploitability?: number }
export type FlopWorkerMessage = FlopProgress | { type: "result" } | { type: "error"; message: string };
export interface FlopWorkerJob extends FlopJob { outputDirectory: string; memoryLimitBytes: number; checkpointPath?: string; resumePath?: string; checkpointEvery?: number }
export const FLOP_GRADE_ITERATIONS = [256, 1024, 4096, 16384, 65536, 100000] as const;
