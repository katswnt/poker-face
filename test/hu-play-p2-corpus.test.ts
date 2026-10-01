import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { illegalActionReason } from "../src/lib/hu-play/public-state";
import { leanRiverActions } from "../src/lib/hu-play/river-tree";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { solveNativePlay } from "../src/lib/hu-play/sources/native";
import { requireRiverPlayingResult } from "../src/lib/solver/bridge/live/river-quality";
import { gradeRiverHands } from "../src/lib/solver/bridge/river-hand-values";
import { parseBridgeCombo, type BridgeResultV1 } from "../src/lib/solver/bridge/contract";

test("off-tree corpus selection is seeded, public-only and includes both seats, tiny bets, all-ins and raises", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  assert.ok(existsSync("scripts/hu-play-p2-corpus.ts"), "Frozen P2 corpus builder required");
  const { makeRiverOffTreeCase } = await import("../scripts/hu-play-p2-corpus");
  const root = loadP1ProductionRoots().find(r => r.street === "river" && r.spot.effectiveStack > 4 * r.spot.startingPot)!;
  const { result } = await runBridgeSpot(root.playingSpot, { threads: 1 });
  const cases = Array.from({ length: 200 }, (_, seed) => makeRiverOffTreeCase(seed, root.request, result));
  for (const c of cases) {
    assert.deepEqual(makeRiverOffTreeCase(c.seed, root.request, result), c);
    assert.equal(illegalActionReason(c.request.publicState, c.actual), null);
    assert.ok(!leanRiverActions(c.request.publicState).some(a => JSON.stringify(a) === JSON.stringify(c.actual)));
    assert.ok(!/aiHand|humanHand|runout/.test(JSON.stringify(c)));
    assert.equal(c.request.publicState.toAct, 1 - c.request.aiSeat);
  }
  assert.equal(new Set(cases.map(c => c.request.aiSeat)).size, 2);
  assert.ok(cases.some(c => c.actual.type === "raise"));
  assert.ok(cases.some(c => c.category === "minimum"));
  assert.ok(cases.some(c => c.category === "all-in"));
  assert.ok(cases.some(c => c.request.publicState.streetActions >= 2));
});

test("the shared browser/native P2 case driver completes and replays a real reducer continuation", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  assert.ok(existsSync("scripts/hu-play-p2-playing-case.ts"), "Shared real-source case driver required");
  const { playRiverCase } = await import("../scripts/hu-play-p2-playing-case");
  const { makeRiverOffTreeCase } = await import("../scripts/hu-play-p2-corpus");
  const root = loadP1ProductionRoots()[0], { result } = await runBridgeSpot(root.playingSpot, { threads: 1 });
  const c = makeRiverOffTreeCase(0, root.request, result), requests: string[] = [];
  const solve = async (s: typeof root.spot) => { requests.push(hashBridgeSpot(s)); return solveNativePlay(s, {}, undefined, "play-river-v1"); };
  const a = await playRiverCase(c, root.request, result, solve), first = [...requests]; requests.length = 0;
  const b = await playRiverCase(c, root.request, result, solve);
  assert.equal(a.logHash, b.logHash); assert.deepEqual(first, requests); assert.ok(a.state.result);
  assert.equal(a.responseRequest.publicState.events.length, c.request.publicState.events.length + 1);
  assert.deepEqual(a.response.result.tree[a.response.parentNode].committed, a.responseRequest.publicState.streetPut);
});

for (const seed of [118, 124, 126]) test(`frozen P2 failure ${seed}: translated response preserves the exact game and quality contract`, {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  const { playRiverCase } = await import("../scripts/hu-play-p2-playing-case");
  const { makeRiverOffTreeCase } = await import("../scripts/hu-play-p2-corpus");
  const root = loadP1ProductionRoots().filter(r => r.street === "river")[seed % 32];
  const { result } = await runBridgeSpot(root.playingSpot, { threads: 1 });
  const c = makeRiverOffTreeCase(seed, root.request, result);
  const completed = await playRiverCase(c, root.request, result, async spot => {
    const response = await solveNativePlay(spot, {}, undefined, "play-river-v1");
    requireRiverPlayingResult(response, spot, hashBridgeSpot(spot));
    assert.ok(gradeRiverHands(spot, response).exploitabilityPctPot <= .3);
    return response;
  });
  assert.ok(completed.state.result);
  assert.equal(completed.provenance.source, "translation");
});

test("real P2 re-solving and translated response never depend on the human's actual private hand", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  const { playRiverCase } = await import("../scripts/hu-play-p2-playing-case");
  const { makeRiverOffTreeCase } = await import("../scripts/hu-play-p2-corpus");
  const roots = loadP1ProductionRoots().filter(r => r.street === "river");
  for (const seed of [0, 2, 118]) {
    const root = roots[seed % 32], { result } = await runBridgeSpot(root.playingSpot, { threads: 1 });
    const c = makeRiverOffTreeCase(seed, root.request, result), cache = new Map<string, BridgeResultV1>(), firstKeys: string[] = [];
    const first = await playRiverCase(c, root.request, result, async spot => {
      const key = hashBridgeSpot(spot); firstKeys.push(key);
      const r = await solveNativePlay(spot, {}, undefined, "play-river-v1"); cache.set(key, r); return r;
    });
    const blocked = new Set([...parseBridgeCombo(first.state.deal.aiHand), ...first.state.public.board.flop,
      first.state.public.board.turn!, first.state.public.board.river!]);
    const alternatives = c.request.ranges.human.entries.filter(h => h.weight > 0 && h.combo !== first.state.deal.humanHand
      && parseBridgeCombo(h.combo).every(card => !blocked.has(card))).slice(0, 4);
    assert.equal(alternatives.length, 4);
    for (const { combo: humanHand } of alternatives) {
      const keys: string[] = [];
      const changed = await playRiverCase(c, root.request, result, async spot => {
        const key = hashBridgeSpot(spot); keys.push(key); const r = cache.get(key); assert.ok(r, "Private cards changed a solve"); return r;
      }, undefined, { humanHand });
      assert.deepEqual(keys, firstKeys); assert.deepEqual(changed.state.decisions, first.state.decisions);
      assert.deepEqual(changed.provenance, first.provenance); assert.deepEqual(changed.state.public, first.state.public);
    }
  }
});
