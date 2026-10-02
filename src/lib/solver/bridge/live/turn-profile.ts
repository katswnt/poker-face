/** P3-only tree family. Numerical quality and resource admission remain separate gates. */
import type { BridgeSpotV1 } from "../contract";
import { canonicalSolverJson } from "../../toy/artifact";
import { actionToken, applyPublicEvent, initialPublicState } from "../../../hu-play/public-state";
import { buildExpandedTurnTree, buildLeanTurnTree, leanTurnActions } from "../../../hu-play/turn-menu";
import { validatePlayBudget } from "./play-profile";

/** Structural bound, NOT a latency or memory claim: a lean river has at most 21 nodes;
 * lean turn = 6 players + 4 folds + 5 * (chance + river) = 120. One extra parent bet adds
 * at most 2 players + 2 folds + 2 * (chance + river) = 48. Add eight forced prefix nodes.
 * The Worker must still estimate and admit actual strategy/export storage before solving.
 */
export const TURN_PLAY_MAX_NODES = 176;

export function validateTurnPlaySpot(spot: BridgeSpotV1): BridgeSpotV1 {
  validatePlayBudget(spot);
  if (!spot.board.turn || spot.board.river || spot.tree.mode !== "turn-subgame-v1") throw new Error("Turn play requires a turn-subgame-v1 tree with an undealt river");
  let nodes = 0;
  const pending = [spot.tree.root];
  while (pending.length) {
    const n = pending.pop()!;
    if (++nodes > TURN_PLAY_MAX_NODES) throw new Error("Turn play is limited to 176 abstract public nodes");
    if (n.kind === "chance") pending.push(n.next);
    if (n.kind === "player") pending.push(...n.actions.map(e => e.next));
  }
  let p = initialPublicState({ startingPot: spot.startingPot, startingStack: spot.effectiveStack, minimumBet: 1, flop: spot.board.flop });
  p = applyPublicEvent(p, { kind: "action", player: 0, action: { type: "check" } });
  p = applyPublicEvent(p, { kind: "action", player: 1, action: { type: "check" } });
  p = applyPublicEvent(p, { kind: "card", street: "turn", card: spot.board.turn });
  let parent = spot.tree.root;
  for (let i = 0; i < spot.tree.prefixLength; i++) {
    if (parent.kind !== "player" || parent.actions.length !== 1) throw new Error("Invalid forced turn prefix");
    const edge = parent.actions[0];
    p = applyPublicEvent(p, { kind: "action", player: parent.player, action: edge.action }); parent = edge.next;
  }
  if (parent.kind !== "player") throw new Error("Turn subgame needs a parent decision");
  const original = new Set(leanTurnActions(p).map(actionToken));
  const added = parent.actions.filter(e => !original.has(actionToken(e.action)));
  const last = p.events.at(-1);
  const response = added.length === 0 && spot.tree.prefixLength > 0 && last?.kind === "action"
    && (last.action.type === "bet" || last.action.type === "raise")
    && canonicalSolverJson(parent) === canonicalSolverJson(buildLeanTurnTree(p));
  if (response) return spot;
  if (added.length !== 1 || (added[0].action.type !== "bet" && added[0].action.type !== "raise")
    || canonicalSolverJson(parent) !== canonicalSolverJson(buildExpandedTurnTree(p, added[0].action))) {
    throw new Error("Turn play allows the lean menu plus one actual parent size, or its smaller translated-model response");
  }
  return spot;
}
