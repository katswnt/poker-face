import type { BridgeAction } from "../solver/bridge/contract";
import type { HuPublicEvent } from "./types";
import { fnv1a } from "./rng";

/** Identity only, after strict public-input validation. Use the original reducer's
 * schema order to retain published IDs without depending on JSON property insertion.
 * Array/event order, action types and real amounts are never sorted or discarded.
 */
export function subgameIdentity(events: readonly HuPublicEvent[], actual?: BridgeAction): string {
  const action = (a: BridgeAction) => "to" in a ? { type: a.type, to: a.to } : { type: a.type };
  const history = events.map(e => e.kind === "action"
    ? { kind: e.kind, player: e.player, action: action(e.action) }
    : { kind: e.kind, street: e.street, card: e.card });
  return fnv1a(JSON.stringify(actual === undefined ? history : [history, action(actual)])).toString(16);
}
