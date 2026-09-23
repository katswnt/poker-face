import type { EquityEstimate } from "./equity";
import type { TrainerHandInput } from "./trainer-hand";
import type { CallEstimate, CallQuote, CardObj, Stage, TableStyle } from "./types";

export type TrainerTask =
  | { kind: "hand"; input: TrainerHandInput }
  | { kind: "call"; hole: CardObj[]; board: CardObj[]; quote: CallQuote; opponents: number; style: TableStyle; seed: number }
  | { kind: "comparison"; hole: CardObj[]; board: CardObj[]; style: TableStyle; seed: number };

export type TrainerResult =
  | { kind: "hand"; stages: Stage[] }
  | { kind: "call"; estimate: CallEstimate }
  | { kind: "comparison"; rows: Array<{ opponents: number; estimate: EquityEstimate }> };

export interface TrainerWorkerRequest { id: number; task: TrainerTask }
export type TrainerWorkerResponse =
  | { id: number; type: "complete"; result: TrainerResult; elapsedMs: number }
  | { id: number; type: "error"; message: string };
