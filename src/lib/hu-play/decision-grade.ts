/** Teaching only: differences between exported, quantized original-policy action values.
 * This is not a value/grade of the composed live opponent. Never import into the solve path.
 */
import type { BridgeAction } from "../solver/bridge/contract";
import { actionToken, derivePublicState, validatePublicState } from "./public-state";
import type { HeadsUpPublicState } from "./types";
import type { PlayDecisionView } from "./ui-controller";

export type SavedDecisionGrade =
  | { readonly status: "pending" }
  | { readonly status: "unavailable"; readonly reason: "history-mismatch" | "not-exported" | "off-menu" }
  | { readonly status: "ready"; readonly basis: "original-saved-policy";
      readonly action: BridgeAction; readonly selectedEvChips: number; readonly bestEvChips: number;
      readonly bestActions: readonly BridgeAction[]; readonly gapChips: number;
      /** Two values each rounded to 0.1 chip: difference error at most 0.1 chip.
       * This does NOT bound solve error or differences from the composed opponent. */
      readonly roundingBoundChips: 0.1 };

export function gradeSavedDecision(d: PlayDecisionView, history: HeadsUpPublicState): SavedDecisionGrade {
  let before: HeadsUpPublicState, current: HeadsUpPublicState;
  try {
    before = validatePublicState(d.public); current = validatePublicState(history);
    const prefix = derivePublicState(current, current.events.slice(0, before.events.length));
    if (JSON.stringify(prefix) !== JSON.stringify(before)) return {status:"unavailable",reason:"history-mismatch"};
  } catch { return {status:"unavailable",reason:"history-mismatch"}; }
  if (d.actor !== "human" || d.actionEvBasis !== "original-saved-policy" || d.provenance.source !== "library"
    || !d.strategy?.length || !d.actionEvs || d.actionEvs.length !== d.strategy.length
    || d.actionEvs.some(ev => ev === null || !Number.isFinite(ev))) return {status:"unavailable",reason:"not-exported"};
  const event = current.events[before.events.length];
  if (!event) return {status:"pending"};
  if (event.kind !== "action" || event.player !== before.toAct) return {status:"unavailable",reason:"history-mismatch"};
  const chosen = d.strategy.findIndex(row => actionToken(row.action) === actionToken(event.action));
  if (chosen < 0) return {status:"unavailable",reason:"off-menu"};
  const values = d.actionEvs as readonly number[], bestEvChips = Math.max(...values), selectedEvChips = values[chosen];
  return {status:"ready",basis:"original-saved-policy",action:event.action,selectedEvChips,bestEvChips,
    bestActions:d.strategy.filter((_,i) => values[i] === bestEvChips).map(row => row.action),
    gapChips:Math.max(0, bestEvChips - selectedEvChips),roundingBoundChips:0.1};
}
