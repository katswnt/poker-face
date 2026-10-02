import assert from "node:assert/strict";
import test from "node:test";
import { smallTurnRequest } from "./helpers/hu-play-turn";
import { applyPublicEvent } from "../src/lib/hu-play/public-state";
import { buildNestedTurnSpot, buildTurnResponseSpot } from "../src/lib/hu-play/turn-tree";
import { buildNestedRiverSpot, buildRiverResponseSpot } from "../src/lib/hu-play/river-tree";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { RIVER_DECK } from "../src/lib/solver/river/cards";
import { fnv1a } from "../src/lib/hu-play/rng";
import type { BridgeAction } from "../src/lib/solver/bridge/contract";

for (const street of ["turn", "river"] as const) test(`${street} subgame IDs survive canonical JSON and retain historical in-memory IDs`, () => {
  let q = smallTurnRequest();
  if (street === "river") {
    let p = q.publicState;
    for (const player of [0, 1] as const) p = applyPublicEvent(p, { kind: "action", player, action: { type: "check" } });
    const card = RIVER_DECK.find(c => !p.board.flop.includes(c) && c !== p.board.turn)!;
    q = { ...q, publicState: applyPublicEvent(p, { kind: "card", street: "river", card }) };
  }
  const nested = street === "turn" ? buildNestedTurnSpot : buildNestedRiverSpot;
  const response = street === "turn" ? buildTurnResponseSpot : buildRiverResponseSpot;
  const actual: BridgeAction = { type: "bet", to: 37 };
  const normal = nested(q, actual);
  assert.equal(normal.id, `hu-nested-${street}-${fnv1a(JSON.stringify([q.publicState.events, actual])).toString(16)}`);
  const restored = nested(JSON.parse(canonicalSolverJson(q)), JSON.parse(canonicalSolverJson(actual)));
  assert.equal(restored.id, normal.id, "Key order must not create a different solve or replay identity");
  assert.equal(hashBridgeSpot(restored), hashBridgeSpot(normal));
  assert.notEqual(hashBridgeSpot(nested(q, { type: "bet", to: 38 })), hashBridgeSpot(normal));
  const after = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action: actual }) };
  const reply = response(after), restoredReply = response(JSON.parse(canonicalSolverJson(after)));
  assert.equal(reply.id, `hu-translated-${street}-${fnv1a(JSON.stringify(after.publicState.events)).toString(16)}`);
  assert.equal(hashBridgeSpot(restoredReply), hashBridgeSpot(reply));
});
