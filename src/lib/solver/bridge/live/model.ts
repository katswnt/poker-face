import type { BridgeResultV1 } from "../contract";
import type { BridgeEstimateV1, WasmEnvironment } from "../wasm-admission";
import type { LiveProfile } from "./play-profile";

export interface ExportReservation {
  version: 1; basis: "public-tree-upper-bound"; scope: "full" | "first-street";
  nodes: number; cells: number; edges: number; jsonBytesUpperBound: number; workingBytesEstimate: number;
}
export interface LiveEstimate extends BridgeEstimateV1 { estimateExport: ExportReservation }
export interface LiveVerdict {
  ok: boolean; reason: string; budgetBytes: number; totalBytes: number;
  engineBytes: number; exportBytes: number; overheadBytes: number;
}
export interface LiveStatus {
  iterations: number; maxIterations: number; measuredAtIteration: number | null; exploitability: number | null;
  target: number; allocated: boolean; done: boolean; failed: boolean; elapsedMs: number; linearMemoryBytes: number;
}
export interface LivePreview {
  type: "preview"; final: false; iteration: number; hands: string[]; engineActions: string[]; strategy: number[][];
}
export interface LiveSession {
  estimate(): string; status(): string; allocate(): string; step(count: number): string;
  root_strategy(): string; finish(): string; free(): void;
}
export interface LiveEngine {
  create(bytes: Uint8Array): LiveSession;
  memoryBytes(): number;
  provenance: { buildHash: string; sourceHash: string; sourceUrl: string; licenseUrl: string; engineCommit: string };
}
export type LiveCommand =
  | { type: "estimate" | "solve"; id: number; spotJson: string; environment: WasmEnvironment; assetBase: string; profile?: LiveProfile }
  | { type: "cancel"; id: number };
export type LiveEvent =
  | { type: "progress"; id: number; stage: "loading" | "building" | "allocating" | "solving" | "exporting" | "checking";
      elapsedMs: number; status: LiveStatus | null }
  | { type: "estimate"; id: number; estimate: LiveEstimate; verdict: LiveVerdict; provenance: LiveEngine["provenance"] }
  | { type: "preview"; id: number; preview: LivePreview }
  | { type: "result"; id: number; result: BridgeResultV1; elapsedMs: number; provenance: LiveEngine["provenance"] }
  | { type: "cancelled"; id: number; elapsedMs: number; hard: boolean }
  | { type: "error"; id: number; message: string };
