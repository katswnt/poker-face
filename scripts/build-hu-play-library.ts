/** P1 supplement only. Never rewrites or deletes the frozen bridge-v1 library. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { checkBridgeResult, validateBridgeSpot, type BridgeResultV1, type BridgeSliceNode } from "../src/lib/solver/bridge/contract";
import { encodeSliceNode, quantizeDistribution } from "../src/lib/solver/bridge/library/encode";
import { validateLibraryManifest } from "../src/lib/solver/bridge/library/load";
import type { BridgeLibraryChunk } from "../src/lib/solver/bridge/library/model";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (value: unknown) => Buffer.from(canonicalSolverJson(value) + "\n");
const sourcePath = "tasks/artifacts/hu-play-flop-sources.json.gz";
const prefix = "/solver-data/hu-play-v1/";
interface Source {
  id: string; spotHash: string; planHash: string; originalCacheSha256: string;
  engine: BridgeResultV1["engine"]; iterations: number; exploitability: BridgeResultV1["exploitability"];
  hands: BridgeResultV1["hands"]; nodes: readonly BridgeSliceNode[];
}

/** Even generation is non-destructive: differing existing bytes require an explicit new version. */
function publish(path: string, bytes: Buffer, check: boolean) {
  if (check || existsSync(path)) assert.deepEqual(readFileSync(path), bytes, `Artifact differs: ${path}`);
  else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { flag: "wx" }); }
}

export function buildPlayLibrary(mode: "capture" | "write" | "check") {
  const libraryBytes = readFileSync("public/solver-data/bridge-v1/manifest.json");
  const library = validateLibraryManifest(JSON.parse(libraryBytes.toString()));
  const read = (ref: { url: string; bytes: number; sha256: string }) => {
    const bytes = readFileSync(`public${ref.url}`);
    assert.equal(bytes.length, ref.bytes); assert.equal(sha(bytes), ref.sha256);
    return JSON.parse(bytes.toString());
  };
  if (mode === "capture") {
    const sources: Source[] = library.spots.map(entry => {
      const spot = validateBridgeSpot(read(entry.spot));
      const path = `.cache/bridge-library/${entry.id}-${entry.spotHash.slice(0, 16)}-${entry.slicePlanHash.slice(0, 16)}.json`;
      const original = readFileSync(path);
      const r = checkBridgeResult(JSON.parse(original.toString()).result, spot, entry.spotHash);
      assert.equal(r.slices?.planHash, entry.slicePlanHash);
      assert.equal(r.engine.precision, "float32"); assert.equal(r.exploitability.reached, true);
      assert.ok(r.exploitability.pctPot <= .3);
      return { id: entry.id, spotHash: entry.spotHash, planHash: entry.slicePlanHash,
        originalCacheSha256: sha(original), engine: r.engine, iterations: r.iterations,
        exploitability: r.exploitability, hands: r.hands, nodes: r.slices!.nodes.filter(n => n.street === "flop") };
    });
    publish(sourcePath, gzipSync(bytesOf({ format: "poker-face-play-flop-sources", version: 1, spots: sources }), { level: 9 }), false);
  }
  const sourceBytes = readFileSync(sourcePath);
  const source = JSON.parse(gunzipSync(sourceBytes).toString()) as { format: string; version: number; spots: Source[] };
  assert.equal(source.format, "poker-face-play-flop-sources"); assert.equal(source.version, 1);
  assert.equal(source.spots.length, 12); assert.equal(library.spots.length, 12);
  const refs = library.spots.map(entry => {
    const raw = source.spots.find(s => s.id === entry.id); assert.ok(raw, entry.id);
    assert.equal(raw.spotHash, entry.spotHash); assert.equal(raw.planHash, entry.slicePlanHash);
    assert.equal(raw.engine.precision, "float32"); assert.equal(raw.engine.commit, library.provenance.engine.commit);
    assert.ok(raw.exploitability.reached && raw.exploitability.pctPot <= .3);
    const spot = validateBridgeSpot(read(entry.spot));
    assert.deepEqual(raw.hands, spot.ranges.map(r => r.combos.map(h => h.combo)));
    const original: BridgeLibraryChunk = read(entry.chunks.flop);
    assert.equal(raw.nodes.length, original.nodes.length);
    const nodes = original.nodes.map(old => {
      const n = raw.nodes.find(n => n.path.join(" ") === old.path); assert.ok(n);
      // Exact old columns, metadata, quantized reaches, values and equities must reproduce.
      // JSON represents rounded -0 as 0; compare exact serialized values, not JS signed zero.
      assert.equal(canonicalSolverJson(encodeSliceNode(n)), canonicalSolverJson(old), `${entry.id}/${old.path} B4 changed`);
      const columns = raw.hands[n.player].map((_, h) => {
        const column = n.strategy.map(r => r[h]);
        assert.ok(column.every(p => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1));
        assert.ok(Math.abs((column as number[]).reduce((a, b) => a + b, 0) - 1) < 1e-5);
        return quantizeDistribution(column as number[]);
      });
      return { path: old.path, player: n.player, committed: n.committed, actions: old.actions,
        strategy: n.actions.map((_, a) => columns.map(c => c[a])),
        actionEv: n.actionEv.map(row => row.map(v => v === null ? null : Math.round(v * 10))) };
    });
    const data = { format: "poker-face-play-flop-policy", version: 1, spotId: entry.id,
      spotHash: entry.spotHash, libraryFlopSha256: entry.chunks.flop.sha256, hands: raw.hands,
      strategyScale: 1000, actionEvScale: 10, nodes };
    const bytes = bytesOf(data), hash = sha(bytes), url = `${prefix}${entry.id}/${hash}/flop.json`;
    assert.ok(bytes.length <= 1024 ** 2);
    publish(`public${url}`, bytes, mode === "check");
    return { id: entry.id, spotHash: entry.spotHash, url, bytes: bytes.length, sha256: hash };
  });
  const manifest = { format: "poker-face-play-flop-library", version: 1,
    libraryManifestSha256: sha(libraryBytes), sourceSha256: sha(sourceBytes),
    label: "Complete per-mille flop strategies from the same 12 saved solves; scripted preflop and hand-written ranges, not exact GTO.",
    spots: refs };
  publish(`public${prefix}manifest.json`, bytesOf(manifest), mode === "check");
  return { sourceBytes: sourceBytes.length, files: refs.length + 1, policyBytes: refs.reduce((s, r) => s + r.bytes, 0),
    manifestSha256: sha(bytesOf(manifest)) };
}

if (process.argv[1]?.endsWith("build-hu-play-library.ts")) {
  const mode = process.argv[2];
  assert.ok(["--capture", "--write", "--check"].includes(mode), "Use --capture (original caches), --write (saved sources), or --check");
  console.log(JSON.stringify(buildPlayLibrary(mode.slice(2) as "capture" | "write" | "check"), null, 2));
}
