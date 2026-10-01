/** Pure public river menu. Shared by construction and strict Worker admission. */
import type { BridgeAction, BridgeExplicitNode } from "../solver/bridge/contract";
import { actionToken, applyPublicEvent, illegalActionReason, validatePublicState } from "./public-state";
import type { HeadsUpPublicState } from "./types";

/** Pinned lean menu: P is pot after calling, B is current street bet.
 * A 60%-pot raise is to B + round(.6 P). Force all-in when remaining stack is at most
 * round(.2 * pot after the proposed bet is called). Bet counts enforce the one-raise cap.
 */
export function leanRiverActions(state: HeadsUpPublicState): readonly BridgeAction[] {
  if (state.street !== "river" || state.status !== "betting" || state.toAct === null) throw new Error("Lean river menu needs a river decision");
  const actor = state.toAct, previous = Math.max(...state.streetPut);
  const call = previous - state.streetPut[actor], potAfterCall = state.pot + call;
  const maximum = state.startingStack - state.closed;
  const facing = call > 0;
  const actions: BridgeAction[] = facing ? [{ type: "fold" }, { type: "call" }] : [{ type: "check" }];
  const riverEvents = state.events.slice(state.events.length - state.streetActions);
  const sized = riverEvents.filter(e => e.kind === "action" && (e.action.type === "bet" || e.action.type === "raise")).length;
  if (facing && (previous === maximum || sized > 1)) return actions;
  const minimum = Math.min(maximum, facing ? previous + call : state.minimumBet);
  const amounts = facing ? [previous + Math.round(potAfterCall * .6)]
    : (actor === 0 ? [.5, 1] : [.66]).map(f => Math.round(potAfterCall * f));
  const totals = amounts.map(amount => {
    const clamped = Math.max(minimum, Math.min(maximum, amount));
    const calledPot = potAfterCall + 2 * (clamped - previous);
    return maximum <= clamped + Math.round(calledPot * .2) ? maximum : clamped;
  });
  for (const to of [...new Set(totals)].sort((a, b) => a - b)) actions.push({ type: facing ? "raise" : "bet", to });
  return actions;
}

function grow(state: HeadsUpPublicState, extra?: BridgeAction): BridgeExplicitNode {
  if (state.status === "fold" || state.status === "showdown") return { kind: "terminal", outcome: state.status };
  if (state.toAct === null || state.street !== "river") throw new Error("River tree cannot contain chance");
  const actions = [...leanRiverActions(state)];
  if (extra) {
    const illegal = illegalActionReason(state, extra); if (illegal) throw new Error(`Illegal nested action: ${illegal}`);
    if (actions.some(a => actionToken(a) === actionToken(extra))) throw new Error("Actual action is already on-tree");
    actions.push(extra);
    const order = (a: BridgeAction) => ({ fold: 0, check: 1, call: 2, bet: 3, raise: 4 })[a.type] * 1e12 + ("to" in a ? a.to : 0);
    actions.sort((a, b) => order(a) - order(b));
  }
  return { kind: "player", player: state.toAct, actions: actions.map(action => ({ action,
    next: grow(applyPublicEvent(state, { kind: "action", player: state.toAct!, action })) })) };
}

export function buildLeanRiverTree(state: HeadsUpPublicState): BridgeExplicitNode {
  return grow(validatePublicState(state));
}
export function buildExpandedRiverTree(state: HeadsUpPublicState, actual: BridgeAction): BridgeExplicitNode {
  return grow(validatePublicState(state), actual);
}
