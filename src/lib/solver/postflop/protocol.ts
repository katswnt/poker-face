import type { TurnRequest } from "../turn/game";
import type { CompactTurnOptions } from "./session";

/** Offline process protocol; no React, browser worker or untrusted compiled arrays. */
export interface CompactTurnJob {
  readonly request: TurnRequest;
  readonly options: CompactTurnOptions;
}
export interface CompactTurnProgress {
  readonly type: "progress";
  readonly stage: "compiling" | "solving" | "grading" | "serializing";
  readonly iterations: number;
  readonly requestedIterations: number;
  readonly elapsedMs: number;
  readonly rssBytes: number;
}
export type CompactTurnWorkerMessage = CompactTurnProgress
  | { readonly type: "result"; readonly json: string }
  | { readonly type: "error"; readonly message: string };
