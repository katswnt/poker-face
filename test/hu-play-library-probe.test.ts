import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { probeLibraryPrefixes } from "../scripts/hu-play-library-probe";
import { actionToken, applyPublicEvent, derivePublicState, initialPublicState } from "../src/lib/hu-play/public-state";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { chunkKeyForNode, type BridgeLibraryChunk, type BridgeLibraryManifest } from "../src/lib/solver/bridge/library/model";

test("seeded library prefixes use the real reducer and reproduce public street-root spots", () => {
  const seeds = Array.from({ length: 64 }, (_, i) => i);
  const a = probeLibraryPrefixes(seeds), b = probeLibraryPrefixes(seeds);
  assert.deepEqual(a, b);
  assert.equal(a.hands.length, seeds.length);
  assert.ok(a.roots.length >= 10);
  for (const row of a.roots) {
    assert.deepEqual(derivePublicState(row.publicState, row.publicState.events), row.publicState);
    assert.equal(row.publicState.streetActions, 0);
    assert.equal(row.spotHash, hashBridgeSpot(row.spot));
    assert.equal(row.spot.startingPot, row.publicState.pot);
    assert.equal(row.spot.effectiveStack, row.publicState.stacks[0]);
    assert.equal(row.spot.solve.compression, "off");
    const json = JSON.stringify(row);
    assert.doesNotMatch(json, /"(?:aiHand|humanHand|deal|runout|reveal)"/);
  }
});

test("corpus reach independently equals the product of the actually played saved action columns", () => {
  const audit = probeLibraryPrefixes(Array.from({ length: 64 }, (_, i) => i));
  const manifest: BridgeLibraryManifest = JSON.parse(readFileSync("public/solver-data/bridge-v1/manifest.json", "utf8"));
  const cache = new Map<string, BridgeLibraryChunk>();
  for (const root of audit.roots) {
    const entry = manifest.spots.find(s => s.id === root.librarySpotId)!;
    const spot: BridgeSpotV1 = JSON.parse(readFileSync(`public${entry.spot.url}`, "utf8"));
    const weights = spot.ranges.map(r => r.combos.map(e => e.weight));
    let state = initialPublicState(root.publicState);
    for (const event of root.publicState.events) {
      if (event.kind === "action") {
        const key = chunkKeyForNode({ street: state.street, path: state.path.join(" "),
          board: [...state.board.flop, ...(state.board.turn ? [state.board.turn] : []), ...(state.board.river ? [state.board.river] : [])] });
        const url = entry.chunks[key].url;
        if (!cache.has(url)) cache.set(url, JSON.parse(readFileSync(`public${url}`, "utf8")));
        const node = cache.get(url)!.nodes.find(n => n.path === state.path.join(" "))!;
        const a = node.actions.indexOf(actionToken(event.action)); assert.ok(a >= 0);
        weights[event.player] = weights[event.player].map((w, h) => {
          if (w === 0) return 0;
          const i = node.live[event.player].indexOf(h); assert.ok(i >= 0);
          return w * node.strategy[a][i] / 1000;
        });
      } else {
        for (const p of [0, 1]) weights[p] = weights[p].map((w, h) => spot.ranges[p].combos[h].combo.includes(event.card) ? 0 : w);
      }
      state = applyPublicEvent(state, event);
    }
    for (const p of [0, 1]) {
      const maximum = Math.max(...weights[p]);
      const expected = weights[p].flatMap((w, h) => w === 0 ? [] : [{ combo: spot.ranges[p].combos[h].combo, weight: Math.fround(w / maximum) }]);
      assert.deepEqual(root.spot.ranges[p].combos, expected);
      const sorted = weights[p].filter(w => w > 0).sort((a, b) => b - a);
      const ratio = sorted.slice(0, 64).reduce((a, b) => a + b, 0) / sorted.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(root.capacity[p].retainedMass - ratio) < 1e-12);
    }
  }
});

test("missing saved boards are recorded, never replaced by another board or counted as solved", () => {
  const audit = probeLibraryPrefixes(Array.from({ length: 64 }, (_, i) => i));
  const absent = audit.roots.filter(row => !row.savedBoardAvailable);
  assert.ok(absent.length > 0);
  for (const root of absent) {
    assert.equal(root.exactNodeAvailable, false);
    assert.equal(root.capacity.every(p => p.possible), false);
    assert.ok(audit.hands.some(h => h.seed === root.seed && h.outcome === "unavailable"));
  }
});

test("flop selection covers only the 12 saved textures and does not depend on a private hand", () => {
  const audit = probeLibraryPrefixes(Array.from({ length: 256 }, (_, i) => i));
  assert.equal(new Set(audit.hands.map(h => h.librarySpotId)).size, 12);
  assert.ok(audit.hands.every(h => h.aiSeat === h.seed % 2));
  assert.equal(audit.inputFiles.every(f => f.sha256.length === 64 && f.bytes > 0), true);
});
