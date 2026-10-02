import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { sha256 } from "../src/lib/solver/bridge/live/loader";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";
import { smallTurnRequest } from "./helpers/hu-play-turn";

const needsWasm = { skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required" };
async function fixture() {
  assert.ok(existsSync("src/lib/hu-play/sources/turn-cache.ts"), "Hash-bound full-policy turn cache required");
  const api = await import("../src/lib/hu-play/sources/turn-cache");
  const { bindings } = await loadWasm(), spot = buildPlaySpot(smallTurnRequest()), result = runWasmSpot(bindings, spot);
  const pointer = JSON.parse(readFileSync(`${WASM_BUILD_ROOT}/manifest.json`, "utf8"));
  const identity = { engineCommit: result.engine.commit, bridgeVersion: result.engine.bridgeVersion,
    sourceHash: pointer.sourceHash, buildHash: pointer.buildHash };
  const chunk = await api.createTurnCacheChunk(spot, result, identity);
  const manifest = { format: "poker-face-turn-cache" as const, version: 1 as const, identity,
    librarySha256: "1".repeat(64), supplementSha256: "2".repeat(64), entries: [chunk.ref] };
  return { api, spot, result, identity, chunk, manifest };
}

test("P3 cache identities bind the entire public finite game, quality settings and exact build", needsWasm, async () => {
  const { api, spot, identity } = await fixture(), key = await api.turnCacheKey(spot, identity);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, await api.turnCacheKey(JSON.parse(JSON.stringify(spot)), { ...identity }));
  const otherSeat = smallTurnRequest();
  assert.equal(key, await api.turnCacheKey(buildPlaySpot({ ...otherSeat, aiSeat: 0,
    ranges: { ai: otherSeat.ranges.human, human: otherSeat.ranges.ai } }), identity));
  for (const changed of [
    { ...spot, startingPot: spot.startingPot + 1 },
    { ...spot, effectiveStack: spot.effectiveStack - 1 },
    { ...spot, board: { ...spot.board, turn: "2h" } },
    { ...spot, ranges: [{ ...spot.ranges[0], combos: spot.ranges[0].combos.map((h, i) => i === 0 ? { ...h, weight: Math.fround(h.weight / 2) } : h) }, spot.ranges[1]] },
    { ...spot, solve: { ...spot.solve, maxIterations: spot.solve.maxIterations - 1 } },
  ]) assert.notEqual(key, await api.turnCacheKey(changed as typeof spot, identity));
  for (const field of ["sourceHash", "buildHash"] as const) {
    assert.notEqual(key, await api.turnCacheKey(spot, { ...identity, [field]: "3".repeat(64) }));
  }
  await assert.rejects(() => api.turnCacheKey({ ...spot, aiHand: "AsKs" } as typeof spot, identity), /unexpected|unknown/i);
  await assert.rejects(() => api.turnCacheKey(spot, { ...identity, humanHand: "AsKs" } as typeof identity), /identity/i);
});

test("P3 cache returns complete unquantized policies, keeps detached warm hits, and records exact misses", needsWasm, async () => {
  const { api, spot, result, identity, chunk, manifest } = await fixture(); let fetches = 0;
  const fetcher: typeof fetch = async input => { fetches++; assert.equal(String(input), chunk.ref.url); return new Response(chunk.bytes); };
  const cache = new api.TurnPolicyCache(manifest, identity, fetcher);
  const cold = await cache.lookup(spot); assert.equal(cold.kind, "hit");
  if (cold.kind !== "hit") throw new Error("Expected hit");
  assert.deepEqual(cold.result, result); assert.equal(cold.chunkSha256, chunk.ref.sha256);
  const node = cold.result.tree.find(n => n.kind === "player")!;
  if (node.kind !== "player") throw new Error("player");
  (node.strategy[0] as number[])[0] = -1;
  const warm = await cache.lookup(spot); assert.equal(warm.kind, "hit");
  if (warm.kind !== "hit") throw new Error("hit");
  assert.deepEqual(warm.result, result); assert.equal(fetches, 1);
  const miss = await cache.lookup({ ...spot, startingPot: spot.startingPot + 1 });
  assert.equal(miss.kind, "miss"); if (miss.kind === "miss") assert.equal(miss.reason, "not-listed");
  assert.equal(fetches, 1);
  const wrong = await new api.TurnPolicyCache(manifest, { ...identity, buildHash: "3".repeat(64) }, fetcher).lookup(spot);
  assert.equal(wrong.kind, "miss"); if (wrong.kind === "miss") assert.equal(wrong.reason, "identity-mismatch");
  assert.equal(fetches, 1);
});

test("P3 cache corruption, stale result, missing data and missed quality never publish a hit", needsWasm, async () => {
  const { api, spot, result, identity, chunk, manifest } = await fixture();
  for (const body of [new Uint8Array([0]), chunk.bytes.slice(0, -1), new Uint8Array(chunk.ref.bytes + 1)]) {
    const miss = await new api.TurnPolicyCache(manifest, identity, async () => new Response(body)).lookup(spot);
    assert.equal(miss.kind, "miss"); if (miss.kind === "miss") assert.equal(miss.reason, "load-failed");
  }
  const missing = await new api.TurnPolicyCache(manifest, identity, async () => new Response(null, { status: 404 })).lookup(spot);
  assert.equal(missing.kind, "miss");
  for (const altered of [
    { ...result, spotHash: "0".repeat(64) },
    { ...result, engine: { ...result.engine, bridgeVersion: "wrong-bridge" } },
    { ...result, exploitability: { ...result.exploitability, reached: false } },
    { ...result, iterations: spot.solve.maxIterations + 1 },
  ]) {
    await assert.rejects(() => api.createTurnCacheChunk(spot, altered, identity));
    // A matching file hash does not excuse an invalid result envelope.
    const object = JSON.parse(new TextDecoder().decode(chunk.bytes)); object.result = altered;
    const bytes = new TextEncoder().encode(canonicalSolverJson(object) + "\n"), digest = await sha256(bytes);
    const ref = { ...chunk.ref, bytes: bytes.length, sha256: digest, url: `${api.TURN_CACHE_PREFIX}${digest}/policy.json` };
    const miss = await new api.TurnPolicyCache({ ...manifest, entries: [ref] }, identity, async () => new Response(bytes)).lookup(spot);
    assert.equal(miss.kind, "miss");
  }
  assert.throws(() => new api.TurnPolicyCache({ ...manifest, version: 2 }, identity), /version|format/i);
  assert.throws(() => new api.TurnPolicyCache({ ...manifest, entries: [chunk.ref, chunk.ref] }, identity), /duplicate/i);
  assert.throws(() => new api.TurnPolicyCache({ ...manifest, entries: [{ ...chunk.ref, url: "https://elsewhere.invalid/a" }] }, identity), /url|address/i);
});

test("P3 cache cancellation is not a miss and cannot warm a partially loaded entry", needsWasm, async () => {
  const { api, spot, identity, chunk, manifest } = await fixture(); const c = new AbortController(); let fetches = 0;
  const cache = new api.TurnPolicyCache(manifest, identity, async () => {
    fetches++; if (fetches === 1) c.abort(); return new Response(chunk.bytes);
  });
  await assert.rejects(() => cache.lookup(spot, c.signal), /abort/i);
  assert.equal((await cache.lookup(spot)).kind, "hit"); assert.equal(fetches, 2);
});
