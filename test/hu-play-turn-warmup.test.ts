import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { RIVER_DECK } from "../src/lib/solver/river/cards";
import type { CommonTurnRoot } from "../scripts/hu-play-turn-warmup";

test("P3 warm-up enumerates all four unraised common flop lines and all 49 public turn cards for all 12 flops", async () => {
  assert.ok(existsSync("scripts/hu-play-turn-warmup.ts"), "Complete prospective warm-up corpus required before cache timings");
  const { commonTurnRoots } = await import("../scripts/hu-play-turn-warmup");
  const fetcher: typeof fetch = async input => {
    assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(input).includes(".."));
    return new Response(readFileSync(`public${input}`));
  };
  const catalog = await loadPlayCatalog(undefined, fetcher), roots = await commonTurnRoots(catalog, fetcher);
  assert.equal(roots.length, 12 * 4 * 49);
  assert.ok(roots.every(r => r.status === "ready"), "Unsupported/empty common roots must be reported, never silently skipped");
  const hashes = new Set<string>();
  for (const entry of catalog.library.spots) {
    const group: CommonTurnRoot[] = roots.filter(r => r.librarySpotId === entry.id);
    assert.equal(group.length, 4 * 49);
    assert.deepEqual([...new Set(group.map(r => r.flopPath.join(" ")))].sort(), ["b182 c", "b363 c", "x b363 c", "x x"]);
    for (const path of ["b182 c", "b363 c", "x b363 c", "x x"]) {
      assert.deepEqual(group.filter(r => r.flopPath.join(" ") === path).map(r => r.turn).sort(),
        RIVER_DECK.filter(c => !entry.flop.includes(c)).sort());
    }
  }
  for (const r of roots) {
    assert.equal(r.request.publicState.street, "turn"); assert.equal(r.spot.board.river, null);
    assert.equal(r.spotHash, hashBridgeSpot(r.spot)); assert.ok(!hashes.has(r.spotHash)); hashes.add(r.spotHash);
    assert.deepEqual(r.spot, buildPlaySpot(r.request));
    // Full played per-mille flop model, not the old partial saved slices; no reach pruning.
    assert.deepEqual(r.spot.ranges.map(x => x.combos.length),
      [r.request.ranges.ai, r.request.ranges.human].map(x => x.entries.filter(h => h.weight > 0).length));
    assert.ok(!/aiHand|humanHand|runout|handSeed/.test(JSON.stringify(r)));
  }
});
