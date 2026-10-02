import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { mathProjection } from "../scripts/hu-play-wide-measurement";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";
import { createTurnCacheChunk, TurnPolicyCache, type TurnCacheManifest } from "../src/lib/hu-play/sources/turn-cache";
import { smallTurnRequest } from "./helpers/hu-play-turn";

test("P3 root source uses validated cache hits, live misses, and explicit cache provenance without changing strategies", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/cached-root.ts"), "Production root source must use the turn cache");
  const { CachedPlayRootSource } = await import("../src/lib/hu-play/sources/cached-root");
  const { bindings } = await loadWasm(), base = smallTurnRequest();
  const q = { ...base, aiSeat: 0 as const, ranges: { ai: base.ranges.human, human: base.ranges.ai } };
  const spot = buildPlaySpot(q), result = runWasmSpot(bindings, spot);
  const pointer = JSON.parse(readFileSync(`${WASM_BUILD_ROOT}/manifest.json`, "utf8"));
  const identity = { engineCommit: result.engine.commit, bridgeVersion: result.engine.bridgeVersion,
    sourceHash: pointer.sourceHash, buildHash: pointer.buildHash };
  const chunk = await createTurnCacheChunk(spot, result, identity);
  const manifest: TurnCacheManifest = { format: "poker-face-turn-cache", version: 1, identity,
    librarySha256: "1".repeat(64), supplementSha256: "2".repeat(64), entries: [chunk.ref] };
  for (const hit of [true, false]) {
    let solves = 0;
    const cache = new TurnPolicyCache(manifest, identity, async () => hit ? new Response(chunk.bytes) : new Response(null, { status: 404 }));
    const source = new CachedPlayRootSource(cache, async s => { solves++; return runWasmSpot(bindings, s); });
    await source.prepare(q);
    assert.equal(solves, hit ? 0 : 1);
    const actual = source.publicTree(q).result;
    if (hit) assert.deepEqual(actual, result);
    else assert.deepEqual(mathProjection(actual), mathProjection(result)); // new solve, new measured wall times
    const p = source.policy(q);
    assert.equal(p.provenance.source, "resolve"); assert.equal(p.provenance.cache?.status, hit ? "hit" : "miss");
    assert.equal(p.provenance.cache?.key, chunk.ref.key);
    const provenance = source.decide({ ...q, aiHand: q.ranges.ai.entries[0].combo, index: 0 }).provenance;
    assert.deepEqual(provenance, p.provenance);
    await source.prepare(q); assert.equal(solves, hit ? 0 : 1);
  }
});

test("P3 cached root cancellation cannot silently become a live solve", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/cached-root.ts"));
  const { CachedPlayRootSource } = await import("../src/lib/hu-play/sources/cached-root");
  const { bindings } = await loadWasm(), q = smallTurnRequest(), spot = buildPlaySpot(q), result = runWasmSpot(bindings, spot);
  const pointer = JSON.parse(readFileSync(`${WASM_BUILD_ROOT}/manifest.json`, "utf8"));
  const identity = { engineCommit: result.engine.commit, bridgeVersion: result.engine.bridgeVersion,
    sourceHash: pointer.sourceHash, buildHash: pointer.buildHash };
  const chunk = await createTurnCacheChunk(spot, result, identity), c = new AbortController(); let solves = 0;
  const cache = new TurnPolicyCache({ format: "poker-face-turn-cache", version: 1, identity,
    librarySha256: "1".repeat(64), supplementSha256: "2".repeat(64), entries: [chunk.ref] }, identity,
  async () => { c.abort(); return new Response(chunk.bytes); });
  const source = new CachedPlayRootSource(cache, async () => { solves++; return result; });
  await assert.rejects(() => source.prepare(q, c.signal), /abort/i); assert.equal(solves, 0);
  assert.throws(() => source.policy(q), /prepared/);
});
