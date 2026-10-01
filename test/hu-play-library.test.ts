import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { quantizeDistribution } from "../src/lib/solver/bridge/library/encode";
import { validateLibraryManifest } from "../src/lib/solver/bridge/library/load";
import type { BridgeSliceNode } from "../src/lib/solver/bridge/contract";
import type { BridgeLibraryChunk } from "../src/lib/solver/bridge/library/model";
import { validateBridgeSpot } from "../src/lib/solver/bridge/contract";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const published = "public/solver-data/hu-play-v1/manifest.json";

test("play supplement recovers every flop hand column without changing any published B4 column", () => {
  assert.ok(existsSync(published), "Complete, reproducible play flop supplement has not been generated");
  const oldBytes = readFileSync("public/solver-data/bridge-v1/manifest.json");
  const library = validateLibraryManifest(JSON.parse(oldBytes.toString()));
  const manifest = JSON.parse(readFileSync(published, "utf8"));
  assert.equal(manifest.format, "poker-face-play-flop-library");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.libraryManifestSha256, sha(oldBytes));
  assert.equal(manifest.spots.length, 12);
  const sourceBytes = readFileSync("tasks/artifacts/hu-play-flop-sources.json.gz");
  assert.equal(manifest.sourceSha256, sha(sourceBytes));
  const sources = JSON.parse(gunzipSync(sourceBytes).toString());
  let addedColumns = 0, comparedColumns = 0;
  for (const entry of library.spots) {
    const ref = manifest.spots.find((s: { id: string }) => s.id === entry.id);
    assert.ok(ref, entry.id);
    const bytes = readFileSync(`public${ref.url}`);
    assert.equal(bytes.length, ref.bytes);
    assert.equal(sha(bytes), ref.sha256);
    assert.ok(bytes.length <= 1024 ** 2, "bounded browser fetch");
    const data = JSON.parse(bytes.toString());
    assert.equal(data.format, "poker-face-play-flop-policy");
    assert.equal(data.version, 1);
    assert.equal(data.spotHash, entry.spotHash);
    assert.equal(data.libraryFlopSha256, entry.chunks.flop.sha256);
    const original: BridgeLibraryChunk = JSON.parse(readFileSync(`public${entry.chunks.flop.url}`, "utf8"));
    const source = sources.spots.find((s: { spotHash: string }) => s.spotHash === entry.spotHash);
    assert.ok(source && source.nodes.length === original.nodes.length);
    assert.equal(source.engine.precision, "float32");
    assert.ok(source.exploitability.pctPot <= .3);
    assert.deepEqual(data.hands, source.hands);
    assert.equal(data.nodes.length, original.nodes.length);
    for (const old of original.nodes) {
      const node = data.nodes.find((n: { path: string }) => n.path === old.path);
      const raw: BridgeSliceNode = source.nodes.find((n: BridgeSliceNode) => n.path.join(" ") === old.path);
      assert.ok(node && raw, old.path);
      assert.equal(node.player, old.player);
      assert.deepEqual(node.committed, old.committed);
      assert.deepEqual(node.actions, old.actions);
      assert.equal(node.strategy.length, old.actions.length);
      const count = data.hands[node.player].length;
      assert.ok(node.strategy.every((r: number[]) => r.length === count));
      for (let h = 0; h < count; h++) {
        const expected = quantizeDistribution(raw.strategy.map(r => { assert.notEqual(r[h], null); return r[h]!; }));
        assert.deepEqual(node.strategy.map((r: number[]) => r[h]), expected);
        assert.equal(expected.reduce((a, b) => a + b, 0), 1000);
        const before = old.live[old.player].indexOf(h);
        if (before < 0) addedColumns++;
        else { comparedColumns++; assert.deepEqual(expected, old.strategy.map(r => r[before])); }
        assert.deepEqual(node.actionEv.map((r: (number | null)[]) => r[h]), raw.actionEv.map(r => r[h] === null ? null : Math.round(r[h]! * 10) || 0));
      }
    }
  }
  assert.ok(addedColumns > 0, "The supplement must repair the original omission, not republish it");
  assert.ok(comparedColumns > 1000);
});

test("browser play-data validation rejects changed, missing or malformed full columns", async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/library-data.ts"), "Public play-data validation is required before using the supplement");
  const { validatePlayFlop } = await import("../src/lib/hu-play/sources/library-data");
  const library = validateLibraryManifest(JSON.parse(readFileSync("public/solver-data/bridge-v1/manifest.json", "utf8")));
  const manifest = JSON.parse(readFileSync(published, "utf8"));
  const entry = library.spots[0], ref = manifest.spots[0];
  const spot = validateBridgeSpot(JSON.parse(readFileSync(`public${entry.spot.url}`, "utf8")));
  const original: BridgeLibraryChunk = JSON.parse(readFileSync(`public${entry.chunks.flop.url}`, "utf8"));
  const data = JSON.parse(readFileSync(`public${ref.url}`, "utf8"));
  assert.deepEqual(validatePlayFlop(data, entry, spot, original), data);
  const bad = (mutate: (d: typeof data) => void) => {
    const d = structuredClone(data); mutate(d); assert.throws(() => validatePlayFlop(d, entry, spot, original));
  };
  bad(d => { d.spotHash = "0".repeat(64); });
  bad(d => { d.libraryFlopSha256 = "0".repeat(64); });
  bad(d => { d.hands[0].reverse(); });
  bad(d => { d.nodes.pop(); });
  bad(d => { d.nodes[1] = d.nodes[0]; });
  bad(d => { d.nodes[0].strategy[0].pop(); });
  bad(d => { d.nodes[0].strategy[0][0] = null; });
  bad(d => { d.nodes[0].strategy[0][0] += 1; });
  bad(d => { d.nodes[0].strategy[0][0] = NaN; });
  bad(d => { d.nodes[0].committed[0] += 1; });
  bad(d => { d.nodes[0].actionEv[0][0] = Infinity; });
});
