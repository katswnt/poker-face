/** Card-independent legal turn/river tree. The engine, not this builder, deals all rivers. */
import type { BridgeAction, BridgeExplicitNode } from "../solver/bridge/contract";
import { RIVER_DECK } from "../solver/river/cards";
import { actionToken, applyPublicEvent, illegalActionReason, validatePublicState } from "./public-state";
import { buildLeanRiverTree } from "./river-menu";
import type { HeadsUpPublicState } from "./types";

/** Same pinned lean turn menu as playTree: 66% opening, 60% raise, one raise, 20% all-in
 * threshold. Street totals and integer rounding match the bridge menu, not displayed bb.
 */
export function leanTurnActions(state: HeadsUpPublicState): readonly BridgeAction[] {
  if (state.street !== "turn" || state.status !== "betting" || state.toAct === null) throw new Error("Lean turn menu needs a turn decision");
  const actor = state.toAct, previous = Math.max(...state.streetPut);
  const call = previous - state.streetPut[actor], potAfterCall = state.pot + call;
  const maximum = state.startingStack - state.closed, facing = call > 0;
  const actions: BridgeAction[] = facing ? [{ type: "fold" }, { type: "call" }] : [{ type: "check" }];
  const sized = state.events.slice(state.events.length - state.streetActions)
    .filter(e => e.kind === "action" && (e.action.type === "bet" || e.action.type === "raise")).length;
  if (facing && (previous === maximum || sized > 1)) return actions;
  const minimum = Math.min(maximum, facing ? previous + call : state.minimumBet);
  const amount = facing ? previous + Math.round(potAfterCall * .6) : Math.round(potAfterCall * .66);
  const clamped = Math.max(minimum, Math.min(maximum, amount));
  const calledPot = potAfterCall + 2 * (clamped - previous);
  const to = maximum <= clamped + Math.round(calledPot * .2) ? maximum : clamped;
  actions.push({ type: facing ? "raise" : "bet", to });
  return actions;
}

function grow(state: HeadsUpPublicState, extra?: BridgeAction): BridgeExplicitNode {
  if (state.status === "fold" || state.status === "showdown") return { kind: "terminal", outcome: state.status };
  if (state.status === "chance") {
    if (state.closed === state.startingStack) return { kind: "terminal", outcome: "showdown" };
    if (state.street !== "turn") throw new Error("A turn tree has exactly one future street");
    // A structural witness only: it is never serialized into the explicit tree or spot.
    // Every real river has these same legal chip actions. Native/WASM chance enumerates
    // all compatible actual cards using the real ranges, not this witness card.
    const card = RIVER_DECK.find(c => !state.board.flop.includes(c) && c !== state.board.turn)!;
    return { kind: "chance", next: buildLeanRiverTree(applyPublicEvent(state, { kind: "card", street: "river", card })) };
  }
  if (state.toAct === null) throw new Error("Turn tree needs a decision");
  const actions = [...leanTurnActions(state)];
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

export function buildLeanTurnTree(state: HeadsUpPublicState): BridgeExplicitNode {
  const p = validatePublicState(state);
  if (p.street !== "turn" || p.status !== "betting") throw new Error("Turn tree needs a turn decision");
  return grow(p);
}
export function buildExpandedTurnTree(state: HeadsUpPublicState, actual: BridgeAction): BridgeExplicitNode {
  const p = validatePublicState(state);
  if (p.street !== "turn" || p.status !== "betting") throw new Error("Turn tree needs a turn decision");
  return grow(p, actual);
}
