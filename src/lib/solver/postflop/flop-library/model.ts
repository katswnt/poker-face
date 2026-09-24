import type { FlopRequest, FlopState } from "../flop/rules";
import type { FlopPreset } from "./fixtures";

export const FLOP_SLICE_BYTES = 1024 * 1024;
export const FLOP_INITIAL_BYTES = 256 * 1024;
export const FLOP_CONDITIONAL_MIN = 1e-12;
export const FLOP_RARE_REACH = 1e-6;
export interface FlopFileRef { url: string; bytes: number; sha256: string }
export interface PublicFlopFacts { reach: number; support: number; value0: number | null }
export interface FlopHandFacts {
  hand: number;
  reach: number;
  checkdownShare: number | null;
  /** Actor's hand-start EV; own fold, other fold, showdown win, split, loss. */
  actions: { ev: number | null; outcomes: number[] | null }[];
}
export interface FlopViewNode {
  id: number;
  parent: number | null;
  state: FlopState;
  edges: { node: number; label: string; preview: PublicFlopFacts | null }[];
  /** Exact saved rows, indexed by acting hand. Impossible rows contain two zeros. */
  policy: number[][] | null;
  summary: PublicFlopFacts | null;
  hands: FlopHandFacts[];
}
export interface FlopSlice { version: 1; scenario: string; sourceHash: string; key: string; nodes: FlopViewNode[] }
export interface FlopScenario {
  version: 1;
  id: string;
  title: string;
  texture: FlopPreset["texture"];
  description: string;
  provenance: string;
  request: FlopRequest;
  hands: string[][];
  weights: number[][];
  quality: { iterations: number; exploitability: number; percentOfPot: number; gains: number[]; value: number[] };
  sourceHash: string;
  policyHash: string;
  counts: { compatibleDeals: number; publicStates: number; informationSets: number };
  chunks: Record<string, FlopFileRef>;
  riverGroups: Record<string, string[]>;
  inputs: FlopFileRef;
}
export interface FlopCatalog { version: 1; scenarios: { id: string; title: string; texture: FlopPreset["texture"]; description: string;
  sourceHash: string; metadata: FlopFileRef }[] }

export const flopStreet = (street: number) => ["Flop", "Turn", "River"][street];
export function flopHistory(state: FlopState) {
  return state.histories.map((actions, street) => street > state.street ? "" : `${flopStreet(street)}${street === 1 ? ` ${state.turn}` : street === 2 ? ` ${state.river}` : ""}: ${actions.join(" → ") || "starts"}`).filter(Boolean).join(" / ");
}
