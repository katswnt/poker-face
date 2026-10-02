/** P4 action projection: saved prices choose a policy, real prices alone move chips.
 * This is action translation, not an EV transformation or an equilibrium guarantee.
 */
import type { BridgeAction } from "../solver/bridge/contract";
import { actionToken, illegalActionReason, sizedActionBounds, validatePublicState } from "./public-state";
import type { HeadsUpPublicState } from "./types";

export function projectFlopAction(realInput: HeadsUpPublicState, savedInput: HeadsUpPublicState,
  action: BridgeAction): BridgeAction {
  const real = validatePublicState(realInput), saved = validatePublicState(savedInput);
  if (real.street !== "flop" || saved.street !== "flop" || real.status !== "betting" || saved.status !== "betting"
    || real.toAct !== saved.toAct) throw new Error("Projection needs matching flop player decisions");
  const sized = action.type === "bet" || action.type === "raise";
  if (Object.keys(action).sort().join() !== (sized ? "to,type" : "type")) throw new Error("Unexpected saved action fields");
  const illegal = illegalActionReason(saved, action); if (illegal) throw new Error("Illegal saved action: " + illegal);
  const actor = real.toAct!, previous = Math.max(...real.streetPut), facing = real.streetPut[actor] < previous;
  if (action.type === "fold") {
    if (!facing) throw new Error("A saved fold has no real price; no fold-to-check policy is invented");
    return { type: "fold" };
  }
  if (action.type === "check" || action.type === "call") return { type: facing ? "call" : "check" };
  const bounds = sizedActionBounds(real);
  if (!bounds) return { type: "call" }; // A real all-in has no legal raise.
  const savedPrevious = Math.max(...saved.streetPut);
  const savedAfterCall = saved.pot + savedPrevious - saved.streetPut[actor];
  const realAfterCall = real.pot + previous - real.streetPut[actor];
  const target = action.to === saved.startingStack - saved.closed ? bounds.max
    : previous + Math.round((action.to - savedPrevious) * realAfterCall / savedAfterCall);
  return { type: bounds.type, to: Math.min(bounds.max, Math.max(bounds.min, target)) };
}

export interface FlopProjectionGroup {
  readonly action: BridgeAction;
  readonly saved: readonly BridgeAction[];
  readonly representative: BridgeAction;
}

/** A collision is safe to represent by one saved child only when there can be no later
 * AI decision on this street: a call closes it, or an all-in leaves just fold/call.
 * The actual probability still sums ALL saved members, never only the representative.
 */
export function projectFlopMenu(real: HeadsUpPublicState, saved: HeadsUpPublicState,
  actions: readonly BridgeAction[]): FlopProjectionGroup[] {
  if (!actions.length || new Set(actions.map(actionToken)).size !== actions.length) throw new Error("Invalid saved flop menu");
  const groups = new Map<string, { action: BridgeAction; saved: BridgeAction[] }>();
  for (const original of actions) {
    const action = projectFlopAction(real, saved, original), key = actionToken(action);
    if (!groups.has(key)) groups.set(key, { action, saved: [] });
    groups.get(key)!.saved.push(structuredClone(original));
  }
  return [...groups.values()].map(group => {
    if (group.saved.length > 1 && group.action.type !== "call"
      && (!("to" in group.action) || group.action.to !== real.startingStack - real.closed)) {
      throw new Error("Ambiguous projected nonterminal branch; no saved continuation may be silently chosen");
    }
    const representative = group.action.type === "call"
      ? group.saved.find(a => a.type === "call") ?? group.saved.find(a => a.type === "check") ?? group.saved.at(-1)!
      : [...group.saved].sort((a, b) => ("to" in b ? b.to : 0) - ("to" in a ? a.to : 0))[0];
    return { ...group, representative: structuredClone(representative) };
  });
}
