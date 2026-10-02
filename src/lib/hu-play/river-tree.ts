/** Public-only river subgame construction. No React, Worker, private deal or engine state. */
import { validateBridgeSpot, type BridgeAction, type BridgeSpotV1 } from "../solver/bridge/contract";
import type { HumanModelRequest } from "./hand";
import { derivePublicState } from "./public-state";
import { subgameIdentity } from "./subgame-identity";
import { preparationKey } from "./sources/policy";
import { buildPlaySpot } from "./sources/resolved";
import { buildExpandedRiverTree, buildLeanRiverTree } from "./river-menu";
export { buildLeanRiverTree, leanRiverActions } from "./river-menu";

/** Ranges at the parent are fixed. The forced historical prefix must NOT apply their
 * old action probabilities again. Its sole role is to reconstruct actual commitments.
 */
export function buildNestedRiverSpot(request: HumanModelRequest, actual: BridgeAction): BridgeSpotV1 {
  preparationKey(request);
  const p = request.publicState;
  if (p.street !== "river" || p.toAct === request.aiSeat) throw new Error("Nested river action needs the human's river decision");
  if (actual.type !== "bet" && actual.type !== "raise") throw new Error("Off-tree river action must be a bet or raise");
  if (Object.keys(actual).sort().join() !== "to,type") throw new Error("Unexpected actual-action fields");
  if (p.streetActions > 8) throw new Error("Nested river prefix exceeds eight public actions");
  const split = p.events.length - p.streetActions;
  const root = derivePublicState(p, p.events.slice(0, split));
  const base = buildPlaySpot({ ...request, publicState: root });
  let tree = buildExpandedRiverTree(p, actual);
  for (let i = p.events.length - 1; i >= split; i--) {
    const e = p.events[i]; if (e.kind !== "action") throw new Error("River prefix contains chance");
    tree = { kind: "player", player: e.player, actions: [{ action: e.action, next: tree }] };
  }
  return validateBridgeSpot({ ...base, id: `hu-nested-river-${subgameIdentity(p.events, actual)}`,
    tree: { mode: "river-subgame-v1", prefixLength: p.streetActions, root: tree } });
}

/** Translation has already defined the human posterior. Re-solve the AI response with the
 * real public bet included in the forced prefix, not with the translated pot or price.
 */
export function buildRiverResponseSpot(request: HumanModelRequest): BridgeSpotV1 {
  preparationKey(request);
  const p = request.publicState, last = p.events.at(-1);
  if (p.street !== "river" || p.toAct !== request.aiSeat || p.streetActions < 1 || p.streetActions > 8
    || last?.kind !== "action" || last.player === request.aiSeat || (last.action.type !== "bet" && last.action.type !== "raise")) {
    throw new Error("Translated response requires an AI river decision after the human's actual bet or raise");
  }
  const split = p.events.length - p.streetActions, root = derivePublicState(p, p.events.slice(0, split));
  const base = buildPlaySpot({ ...request, publicState: root });
  let tree = buildLeanRiverTree(p);
  for (let i = p.events.length - 1; i >= split; i--) {
    const e = p.events[i]; if (e.kind !== "action") throw new Error("River response prefix contains chance");
    tree = { kind: "player", player: e.player, actions: [{ action: e.action, next: tree }] };
  }
  return validateBridgeSpot({ ...base, id: `hu-translated-river-${subgameIdentity(p.events)}`,
    tree: { mode: "river-subgame-v1", prefixLength: p.streetActions, root: tree } });
}
