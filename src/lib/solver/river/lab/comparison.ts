import type { RiverLabDecision, RiverLabEvent, RiverLabInput, RiverLabPreflight, RiverLabQuality, RiverLabResult } from "./model";

export type RiverComparisonKind = "range" | "bets" | "stack";
export interface RiverComparisonChange { kind: RiverComparisonKind; value: string }
export interface RiverComparisonAnchor {
  input: RiverLabInput;
  decision: Pick<RiverLabDecision["facts"], "player" | "privateCards" | "history">;
}
export interface RiverComparisonPreflight {
  before: RiverLabPreflight;
  after: RiverLabPreflight;
  totalStates: number;
  allowed: boolean;
  decisionAvailable: boolean;
}
export interface RiverComparisonResult {
  change: RiverComparisonChange;
  result: RiverLabResult;
  decision: RiverLabDecision | null;
}
export type RiverComparisonCommand =
  | { type: "preflight" | "solve"; id: number; anchor: RiverComparisonAnchor; change: RiverComparisonChange }
  | { type: "cancel"; id: number };
export type RiverComparisonEvent =
  | Extract<RiverLabEvent, { type: "progress" | "cancelled" }>
  | { type: "preflight"; id: number; preflight: RiverComparisonPreflight }
  | { type: "result"; id: number; comparison: RiverComparisonResult }
  | { type: "error"; id: number; message: string };

export function comparisonAnchor(result: RiverLabResult, decision: RiverLabDecision): RiverComparisonAnchor {
  const r = result.request;
  return {
    input: { board: r.board.join(" "), range0: r.rangeText[0], range1: r.rangeText[1],
      pot: String(r.committed[0] + r.committed[1]), stack0: String(r.stackBehind[0]), stack1: String(r.stackBehind[1]),
      bets: r.openingBetSizes.join(" "), raises: r.raiseToSizes.join(" "), maxRaises: String(r.maxRaises),
      iterations: String(result.quality.iteration) },
    decision: { player: decision.facts.player, privateCards: [...decision.facts.privateCards], history: [...decision.facts.history] },
  };
}

export function comparisonField(anchor: RiverComparisonAnchor, kind: RiverComparisonKind): "range0" | "range1" | "stack0" | "stack1" | "bets" {
  if (anchor.decision.player !== 0 && anchor.decision.player !== 1) throw new Error("Pin a valid acting player first.");
  if (kind === "range") return anchor.decision.player === 0 ? "range1" : "range0";
  if (kind === "stack") return anchor.decision.player === 0 ? "stack1" : "stack0";
  if (kind === "bets") return "bets";
  throw new Error("Choose opponent range, opening bets, or opponent stack.");
}

/** Builds the change here, rather than accepting a second independently editable game. */
export function comparisonInput(anchor: RiverComparisonAnchor, change: RiverComparisonChange): RiverLabInput {
  if (typeof change.value !== "string" || change.value.length > 2000) throw new Error("Keep the changed value under 2000 characters.");
  return { ...anchor.input, [comparisonField(anchor, change.kind)]: change.value };
}

export function sameComparisonDecision(left: RiverComparisonAnchor["decision"], right: RiverComparisonAnchor["decision"]): boolean {
  return left.player === right.player && [...left.privateCards].sort().join("") === [...right.privateCards].sort().join("")
    && left.history.length === right.history.length && left.history.every((action, index) => action === right.history[index]);
}

export function comparisonActions(before: RiverLabDecision, after: RiverLabDecision) {
  if (!sameComparisonDecision(before.facts, after.facts)) throw new Error("Only the same player, hand, and history can be compared.");
  const actions = [...new Set([...before.facts.actions, ...after.facts.actions].map(row => row.action))];
  return actions.map(action => {
    const old = before.facts.actions.find(row => row.action === action) ?? null;
    const next = after.facts.actions.find(row => row.action === action) ?? null;
    const reachable = !before.facts.offPath && !after.facts.offPath;
    return { action, before: old, after: next,
      frequencyDifference: reachable && old && next ? 100 * (next.frequency - old.frequency) : null,
      valueDifference: reachable && old?.expectedAdditionalValue != null && next?.expectedAdditionalValue != null
        ? next.expectedAdditionalValue - old.expectedAdditionalValue : null };
  });
}

/** Whole-game minimax bounds, never conditional action-value error bars. */
export function riverValueBounds(quality: RiverLabQuality, player: 0 | 1) {
  const value = quality.value[player];
  return { low: value - quality.gains[1 - player], high: value + quality.gains[player] };
}
export function riverValueChangeBounds(before: RiverLabQuality, after: RiverLabQuality, player: 0 | 1) {
  const old = riverValueBounds(before, player), next = riverValueBounds(after, player);
  return { low: next.low - old.high, high: next.high - old.low };
}
