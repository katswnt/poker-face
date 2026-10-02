/** Public-only turn subgames. Historical chip commitments are forced, not re-conditioned. */
import { validateBridgeSpot, type BridgeAction, type BridgeExplicitNode, type BridgeSpotV1 } from "../solver/bridge/contract";
import type { HumanModelRequest } from "./hand";
import { derivePublicState } from "./public-state";
import { subgameIdentity } from "./subgame-identity";
import { preparationKey } from "./sources/policy";
import { buildPlaySpot } from "./sources/resolved";
import { buildExpandedTurnTree, buildLeanTurnTree } from "./turn-menu";
export { buildLeanTurnTree, leanTurnActions } from "./turn-menu";

function embed(request: HumanModelRequest, subtree: BridgeExplicitNode, id: string): BridgeSpotV1 {
  const p = request.publicState, split = p.events.length - p.streetActions;
  const root = derivePublicState(p, p.events.slice(0, split));
  const base = buildPlaySpot({ ...request, publicState: root });
  let tree = subtree;
  for (let i = p.events.length - 1; i >= split; i--) {
    const e = p.events[i]; if (e.kind !== "action") throw new Error("Turn prefix contains chance");
    tree = { kind: "player", player: e.player, actions: [{ action: e.action, next: tree }] };
  }
  return validateBridgeSpot({ ...base, id, tree: { mode: "turn-subgame-v1", prefixLength: p.streetActions, root: tree } });
}

export function buildNestedTurnSpot(request: HumanModelRequest, actual: BridgeAction): BridgeSpotV1 {
  preparationKey(request);
  const p = request.publicState;
  if (p.street !== "turn" || p.toAct === request.aiSeat) throw new Error("Nested turn action needs the human's turn decision");
  if (actual.type !== "bet" && actual.type !== "raise") throw new Error("Off-tree turn action must be a bet or raise");
  if (Object.keys(actual).sort().join() !== "to,type") throw new Error("Unexpected actual-action fields");
  if (p.streetActions > 8) throw new Error("Nested turn prefix exceeds eight public actions");
  return embed(request, buildExpandedTurnTree(p, actual), `hu-nested-turn-${subgameIdentity(p.events, actual)}`);
}

export function buildTurnResponseSpot(request: HumanModelRequest): BridgeSpotV1 {
  preparationKey(request);
  const p = request.publicState, last = p.events.at(-1);
  if (p.street !== "turn" || p.toAct !== request.aiSeat || p.streetActions < 1 || p.streetActions > 8
    || last?.kind !== "action" || last.player === request.aiSeat || (last.action.type !== "bet" && last.action.type !== "raise")) {
    throw new Error("Translated response requires an AI turn decision after the human's actual bet or raise");
  }
  return embed(request, buildLeanTurnTree(p), `hu-translated-turn-${subgameIdentity(p.events)}`);
}
