import type { ConfigurableRiverDecisionFacts, ConfigurableRiverOpponentComboWeight } from "../configurable/explain";
import type { ConfigurableRiverAction } from "../configurable/game";
import type { ConfigurableRiverV3Preflight } from "../configurable-v3/game";
import type { ConfigurableRiverV3Request } from "../configurable-v3/solve";

export const BROWSER_STATE_LIMIT = 100_000;
export const BROWSER_ITERATION_LIMIT = 2_000;
export const AVERAGING_DELAY = 20;

export interface RiverLabInput {
  board: string;
  range0: string;
  range1: string;
  pot: string;
  stack0: string;
  stack1: string;
  bets: string;
  raises: string;
  maxRaises: string;
  iterations: string;
}

export const EXAMPLE_INPUT: RiverLabInput = {
  board: "Ks 8s 4s 2c 9d", range0: "AA AQs 76s", range1: "JJ ATs 65s",
  pot: "100", stack0: "200", stack1: "200", bets: "50 100 200",
  raises: "100 150 200", maxRaises: "2", iterations: "1000",
};

export const SMALL_INPUT: RiverLabInput = {
  ...EXAMPLE_INPUT, range0: "AsQs AhAd 7h6h", range1: "AsTs JhJd 6c5c",
  stack0: "100", stack1: "100", bets: "50 100", raises: "100",
  maxRaises: "1", iterations: "500",
};

export type RiverLabErrors = Partial<Record<keyof RiverLabInput | "form", string>>;

export interface RiverLabPreflight {
  counts: ConfigurableRiverV3Preflight;
  allowed: boolean;
  iterations: number;
  /** Two forward/backward regret passes and one forward averaging pass per iteration. */
  approximateNodeVisits: number;
  blockedCombos: readonly [number, number];
}

export interface RiverLabQuality {
  iteration: number;
  value: readonly [number, number];
  gains: readonly [number, number];
  exploitability: number;
}

export interface RiverLabDecision {
  facts: ConfigurableRiverDecisionFacts;
  /** Posterior after forcing our action, then observing the opponent's response. */
  responses: readonly {
    action: ConfigurableRiverAction;
    response: ConfigurableRiverAction;
    probability: number;
    range: readonly ConfigurableRiverOpponentComboWeight[];
  }[];
  callCost: number;
  finalCallPot: number | null;
}

export interface RiverLabResult {
  source: "example" | "custom";
  request: ConfigurableRiverV3Request;
  preflight: RiverLabPreflight;
  quality: RiverLabQuality;
  elapsedMs: number | null;
  decisions: readonly Pick<ConfigurableRiverDecisionFacts,
    "informationSet" | "player" | "privateCards" | "history" | "offPath">[];
  initialDecision: RiverLabDecision;
  provenance: { rulesHash: string; payloadHash: string } | null;
}

export type RiverLabCommand =
  | { type: "preflight"; id: number; input: RiverLabInput }
  | { type: "solve"; id: number; input: RiverLabInput }
  | { type: "cancel"; id: number }
  | { type: "inspect"; id: number; source: "example" | "custom"; key: string };

export type RiverLabEvent =
  | { type: "preflight"; id: number; preflight: RiverLabPreflight }
  | { type: "progress"; id: number; phase: "preparing" | "solving" | "grading" | "explaining";
      iterations: number; total: number; elapsedMs: number; quality: RiverLabQuality | null }
  | { type: "result"; id: number; result: RiverLabResult }
  | { type: "decision"; id: number; decision: RiverLabDecision }
  | { type: "cancelled"; id: number; iterations: number; elapsedMs: number }
  | { type: "error"; id: number; errors: RiverLabErrors };

export function riverActionLabel(action: ConfigurableRiverAction): string {
  if (action.startsWith("bet-to-")) return `Bet ${action.slice(7)}`;
  if (action.startsWith("raise-to-")) return `Raise to ${action.slice(9)}`;
  return action[0].toUpperCase() + action.slice(1);
}

export function riverHistoryLabel(history: readonly ConfigurableRiverAction[]): string {
  return history.length ? history.map((action, index) =>
    `${index % 2 === 0 ? "First" : "Second"}: ${riverActionLabel(action).toLowerCase()}`,
  ).join(" → ") : "Start of river";
}
