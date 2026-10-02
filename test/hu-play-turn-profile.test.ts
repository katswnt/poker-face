import assert from "node:assert/strict";
import test from "node:test";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { buildNestedTurnSpot, buildTurnResponseSpot } from "../src/lib/hu-play/turn-tree";
import { parseLiveSpot } from "../src/lib/solver/bridge/live/admission";
import { applyPublicEvent } from "../src/lib/hu-play/public-state";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";

test("turn play profile admits only lean-plus-one or the real-price translated response, preserving other profiles", () => {
  const root = loadP1ProductionRoots().find(r => r.request.publicState.street === "turn")!, aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  const s = buildNestedTurnSpot(q, { type: "bet", to: 101 });
  const parse = (spot: BridgeSpotV1) => parseLiveSpot(JSON.stringify(spot), "play-turn-v1" as never);
  assert.deepEqual(parse(s), s);
  assert.throws(() => parseLiveSpot(JSON.stringify(s), "play-v1"), /menu/i);
  assert.throws(() => parseLiveSpot(JSON.stringify(s)), /64 hands|profile/i);
  assert.throws(() => parseLiveSpot(JSON.stringify(s), "play-river-v1"), /river/i);
  assert.throws(() => parse(root.playingSpot), /turn.*tree|subgame/i);
  assert.throws(() => parse({ ...s, solve: { ...s.solve, maxIterations: 1001 } }), /1,000|1000|iteration/i);
  assert.throws(() => parse({ ...s, solve: { ...s.solve, exportScope: "full" } }), /first.street/i);
  assert.throws(() => parse({ ...s, effectiveStack: 19 * s.startingPot }), /18|stack/i);
  const bad = structuredClone(s);
  if (bad.tree.mode !== "turn-subgame-v1" || bad.tree.root.kind !== "player") throw new Error("tree");
  const check = bad.tree.root.actions[0].next;
  if (check.kind !== "player") throw new Error("branch");
  Object.assign(check, { actions: [check.actions[0]] });
  assert.throws(() => parse(bad), /lean|one|menu/i);
  const p = applyPublicEvent(q.publicState, { kind: "action", player: 0, action: { type: "bet", to: 101 } });
  assert.doesNotThrow(() => parse(buildTurnResponseSpot({ ...q, publicState: p })));
});

test("teaching admission does not silently enable forced turn prefixes even with small ranges", () => {
  const root = loadP1ProductionRoots().find(r => r.request.publicState.street === "turn")!, aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  const s = buildNestedTurnSpot(q, { type: "bet", to: 101 });
  const small = { ...s, ranges: s.ranges.map(r => ({ ...r, combos: r.combos.slice(0, 10) })) };
  assert.throws(() => parseLiveSpot(JSON.stringify(small)), /play-turn-v1/);
});
