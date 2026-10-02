import { buildBridgeFixture } from "../../src/lib/solver/bridge/fixtures";
import { applyPublicEvent, initialPublicState } from "../../src/lib/hu-play/public-state";
import { rangeFromBridge } from "../../src/lib/hu-play/reach";
import type { HumanModelRequest } from "../../src/lib/hu-play/hand";

export function smallTurnRequest(): HumanModelRequest {
  const s = buildBridgeFixture("referee-turn-v2-dry-value");
  let p = initialPublicState({ startingPot: 100, startingStack: 1800, minimumBet: 1, flop: s.board.flop });
  p = applyPublicEvent(p, { kind: "action", player: 0, action: { type: "check" } });
  p = applyPublicEvent(p, { kind: "action", player: 1, action: { type: "check" } });
  p = applyPublicEvent(p, { kind: "card", street: "turn", card: s.board.turn! });
  return { publicState: p, aiSeat: 1, ranges: { ai: rangeFromBridge(s.ranges[1]), human: rangeFromBridge(s.ranges[0]) } };
}
