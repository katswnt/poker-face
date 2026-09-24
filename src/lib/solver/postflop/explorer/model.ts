import type { TurnV2Action, TurnV2Request, TurnV2State } from "../configurable-turn/rules";

export const EXPLORER_VERSION = 1;
export const CONDITIONAL_MIN_REACH = 1e-12;
export const RARE_REACH = 1e-6;
export const CHUNK_BYTE_LIMIT = 1024 * 1024;
export const TURN_BYTE_LIMIT = 256 * 1024;
export interface ActionView {
  action: TurnV2Action;
  frequency: number;
  ev: number | null;
  evFromNow: number | null;
  behindBest: number | null;
  /** Own fold, opponent fold, showdown win, split, loss. */
  outcomes: number[] | null;
  showdownShare: number | null;
  foldNext: number | null;
  responses: { action: TurnV2Action; probability: number | null; opponent: number[] | null }[];
}
export interface HandView {
  hand: number;
  reach: number;
  opponent: number[] | null;
  checkdownShare: number | null;
  actions: ActionView[];
}
export interface NodeView {
  id: number;
  parent: number | null;
  state: TurnV2State;
  reach: number;
  compatibleDeals: number;
  children: { label: string; node: number; card: string | null; probability: number | null; compatibleDeals: number; value0: number | null }[];
  hands: HandView[];
  /** Reach-weighted frequencies for the acting range, aligned with children. */
  mix: number[] | null;
  terminalValue0: number | null;
}
export interface ExplorerChunk {
  version: 1;
  scenario: string;
  sourceHash: string;
  card: string | null;
  nodes: NodeView[];
}
export interface ChunkRef { url: string; sha256: string; bytes: number }
export interface SavedScenario {
  id: string;
  title: string;
  description: string;
  request: TurnV2Request;
  hands: string[][];
  quality: { iterations: number; exploitability: number; percentOfPot: number; gains: number[]; value: number[] };
  provenance: { requestHash: string; policyHash: string; payloadHash: string };
  counts: { deals: number; publicStates: number; informationSets: number };
  chunks: Record<string, ChunkRef>;
}
export interface ExplorerCatalog { version: 1; scenarios: SavedScenario[] }

export function actionLabel(action: string): string {
  if (action.startsWith("bet-to-")) return `Bet ${action.slice(7)}`;
  if (action.startsWith("raise-to-")) return `Raise to ${action.slice(9)}`;
  return action[0].toUpperCase() + action.slice(1);
}
export function historyLabel(state: TurnV2State): string {
  const street = (actions: readonly string[]) => actions.map((a, i) => `${i % 2 === 0 ? "First" : "Second"}: ${actionLabel(a)}`).join(" → ");
  return `${street(state.histories[0]) || "Turn starts"}${state.river ? ` / ${state.river} / ${street(state.histories[1]) || "River starts"}` : ""}`;
}
export function conditionalStatus(reach: number): "off" | "tiny" | "rare" | "reached" {
  return reach === 0 ? "off" : reach <= CONDITIONAL_MIN_REACH ? "tiny" : reach < RARE_REACH ? "rare" : "reached";
}
export function callPrice(request: TurnV2Request, state: TurnV2State) {
  if (state.actor === null) return { cost: 0, potAfterCall: 0, shareRequired: null };
  const p = state.actor, cost = Math.min(Math.max(0, state.currentBet - state.streetPaid[p]), request.stackBehind[p] - state.carried - state.streetPaid[p]);
  // A short call cannot win uncalled excess: match both street payments first.
  const potAfterCall = 2 * (request.committedPerPlayer + state.carried + Math.min(state.streetPaid[p] + cost, state.streetPaid[1 - p]));
  return { cost, potAfterCall, shareRequired: cost > 0 ? cost / potAfterCall : null };
}
