import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { applyPublicEvent, initialPublicState } from "../src/lib/hu-play/public-state";
import { applyStrategy, rangeFromBridge } from "../src/lib/hu-play/reach";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";

const fetcher: typeof fetch = async input => {
  const path = String(input); assert.match(path, /^\/solver-data\//); assert.ok(!path.includes(".."));
  return new Response(readFileSync(`public${path}`));
};

test("real library source covers every positive-reach flop column through every on-tree line", async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/library.ts"), "LibraryPolicySource has not been implemented");
  const { loadLibraryPolicySource } = await import("../src/lib/hu-play/sources/library");
  const catalog = await loadPlayCatalog(undefined, fetcher);
  let decisions = 0, columns = 0;
  for (const entry of catalog.library.spots) {
    const source = await loadLibraryPolicySource(catalog, entry.id, undefined, fetcher);
    const initial: HumanModelRequest = { publicState: initialPublicState({ startingPot: 550, startingStack: 9750,
      minimumBet: 100, flop: source.spot.board.flop }), aiSeat: 0,
      ranges: { ai: rangeFromBridge(source.spot.ranges[0]), human: rangeFromBridge(source.spot.ranges[1]) } };
    const walk = async (request: HumanModelRequest) => {
      if (request.publicState.street !== "flop" || request.publicState.status !== "betting") return;
      await source.prepare(request);
      const policy = source.policy(request), actor = request.publicState.toAct!;
      const range = actor === 0 ? request.ranges.ai : request.ranges.human;
      assert.equal(policy.player, actor);
      assert.equal(policy.provenance.ladder?.rung, "library");
      assert.deepEqual(policy.provenance.ladder?.prunedMass, [0, 0]);
      for (const h of range.entries) if (h.weight > 0) {
        const distribution = policy.distribution(h.combo);
        assert.ok(Math.abs(distribution.reduce((s, a) => s + a.probability, 0) - 1) < 1e-12); columns++;
      }
      decisions++;
      for (const action of policy.actions) {
        const changed = applyStrategy(range, h => policy.probability(action, h));
        // Off-support public lines have no posterior and are not fabricated.
        if (!changed.entries.some(h => h.weight > 0)) continue;
        await walk({ ...request, publicState: applyPublicEvent(request.publicState, { kind: "action", player: actor, action }),
          ranges: actor === 0 ? { ...request.ranges, ai: changed } : { ...request.ranges, human: changed } });
      }
    };
    await walk(initial);
    await assert.rejects(() => source.prepare({ ...initial, humanHand: "AsKs" } as HumanModelRequest), /unexpected|public/i);
    await source.prepare(initial);
    const response = source.decide({ ...initial, aiHand: source.spot.ranges[0].combos[0].combo, index: 0 });
    assert.equal(response.provenance.source, "library");
    assert.throws(() => source.policy({ ...initial, aiSeat: 1 }), /prepared/i);
  }
  assert.equal(decisions, 96);
  assert.ok(columns > 20000);
});
