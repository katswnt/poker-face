import assert from "node:assert/strict";
import test from "node:test";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { buildNestedRiverSpot } from "../src/lib/hu-play/river-tree";
import { parseLiveSpot } from "../src/lib/solver/bridge/live/admission";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";

test("river play profile admits only the bounded lean-plus-one tree, without changing teaching or on-tree admission", () => {
  const root = loadP1ProductionRoots()[0], aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  const s = buildNestedRiverSpot(q, { type: "bet", to: 101 });
  const parse = (spot: BridgeSpotV1) => parseLiveSpot(JSON.stringify(spot), "play-river-v1" as never);
  assert.deepEqual(parse(s), s);
  assert.throws(() => parseLiveSpot(JSON.stringify(s), "play-v1"), /menu/i);
  assert.throws(() => parseLiveSpot(JSON.stringify(s)), /64 hands|profile/i);
  assert.throws(() => parse(root.playingSpot), /river.*tree|subgame/i);
  assert.throws(() => parse({ ...s, solve: { ...s.solve, maxIterations: 1001 } }), /1,000|1000|iteration/i);
  assert.throws(() => parse({ ...s, effectiveStack: 19 * s.startingPot }), /18|stack/i);
  const bad = structuredClone(s);
  if (bad.tree.mode !== "river-subgame-v1" || bad.tree.root.kind !== "player") throw new Error("wrong tree");
  // A lawful check-down branch is still a different game, not the measured lean tree.
  const check = bad.tree.root.actions[0].next;
  if (check.kind !== "player") throw new Error("wrong branch");
  Object.assign(check, { actions: [check.actions[0]] });
  assert.throws(() => parse(bad), /lean|one|menu/i);
});
