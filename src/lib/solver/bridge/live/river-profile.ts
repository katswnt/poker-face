/** P2 river-only engineering envelope. Never admits arbitrary menus or extra future sizes. */
import type { BridgeSpotV1 } from "../contract";
import { canonicalSolverJson } from "../../toy/artifact";
import { actionToken, applyPublicEvent, initialPublicState } from "../../../hu-play/public-state";
import { buildExpandedRiverTree, buildLeanRiverTree, leanRiverActions } from "../../../hu-play/river-menu";
import { validatePlayBudget } from "./play-profile";

/** Frozen experiment's maximum was 27 nodes; 32 bounds this deliberately narrow family.
 * Actual memory still needs the Worker estimate; no phone or latency guarantee is implied.
 */
export const RIVER_PLAY_MAX_NODES = 32;

export function validateRiverPlaySpot(spot: BridgeSpotV1): BridgeSpotV1 {
  validatePlayBudget(spot);
  if (!spot.board.river || spot.tree.mode !== "river-subgame-v1") throw new Error("River play requires a river-subgame-v1 tree");
  let nodes = 0;
  const pending = [spot.tree.root];
  while (pending.length) {
    const n = pending.pop()!;
    if (++nodes > RIVER_PLAY_MAX_NODES) throw new Error("River play is limited to 32 public nodes");
    if (n.kind === "chance") throw new Error("River play cannot contain chance");
    if (n.kind === "player") pending.push(...n.actions.map(e => e.next));
  }
  let p = initialPublicState({ startingPot: spot.startingPot, startingStack: spot.effectiveStack, minimumBet: 1, flop: spot.board.flop });
  for (const [street, card] of [["turn", spot.board.turn!], ["river", spot.board.river]] as const) {
    p = applyPublicEvent(p, { kind: "action", player: 0, action: { type: "check" } });
    p = applyPublicEvent(p, { kind: "action", player: 1, action: { type: "check" } });
    p = applyPublicEvent(p, { kind: "card", street, card });
  }
  let parent = spot.tree.root;
  for (let i = 0; i < spot.tree.prefixLength; i++) {
    if (parent.kind !== "player" || parent.actions.length !== 1) throw new Error("Invalid forced river prefix");
    const edge = parent.actions[0];
    p = applyPublicEvent(p, { kind: "action", player: parent.player, action: edge.action }); parent = edge.next;
  }
  if (parent.kind !== "player") throw new Error("River subgame needs a parent decision");
  const original = new Set(leanRiverActions(p).map(actionToken));
  const added = parent.actions.filter(e => !original.has(actionToken(e.action)));
  const last = p.events.at(-1);
  const response = added.length === 0 && spot.tree.prefixLength > 0 && last?.kind === "action"
    && (last.action.type === "bet" || last.action.type === "raise")
    && canonicalSolverJson(parent) === canonicalSolverJson(buildLeanRiverTree(p));
  if (response) return spot; // separately labelled translated-posterior response, never an expanded parent
  if (added.length !== 1 || (added[0].action.type !== "bet" && added[0].action.type !== "raise")
    || canonicalSolverJson(parent) !== canonicalSolverJson(buildExpandedRiverTree(p, added[0].action))) {
    throw new Error("River play allows the lean menu plus one actual parent size, or its smaller translated-model response");
  }
  return spot;
}
