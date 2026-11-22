import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { BRIDGE_BINARY } from "../scripts/bridge-runner";
import { classifyPreflight, measurePreflight, summarizePreflights, type PreflightRow } from "../src/lib/solver/preflop-v2/preflight";
import { corpusSpot, sha256, VALIDATION_BUDGETS, type ValidationManifest } from "../src/lib/solver/preflop-v2/corpus";

const manifest = JSON.parse(readFileSync("src/lib/solver/preflop-v2/manifest.json", "utf8")) as ValidationManifest;
const spot = corpusSpot(manifest.roots[0], manifest), cap = VALIDATION_BUDGETS.estimatedAllocationAndExportBytes;
const estimate = (s = spot, engine = cap - 32768) => JSON.stringify({ type: "estimate", spotId: s.id, spotHash: hashBridgeSpot(s),
  estimatedBytes: engine, estimatedCompressedBytes: 1, hands: s.ranges.map(r => r.combos.length), memoryCapBytes: s.solve.memoryCapBytes,
  estimateExport: { version: 1, basis: "public-tree-upper-bound", scope: s.solve.exportScope,
    nodes: 1, cells: 0, edges: 0, jsonBytesUpperBound: 4096, workingBytesEstimate: 32768 } });
const row = (s = spot): PreflightRow => { const raw = estimate(s); return { id: s.id, spotHash: hashBridgeSpot(s), status: "estimated",
  rawEstimate: raw, rawHash: sha256(raw), elapsedMs: 1, sampledPeakRssBytes: null, rssSamples: 0, rssErrors: 0,
  threads: 1, command: "estimate", strategyStorageAllocated: false, iterations: 0 }; };

test("preflop admission includes export reservation and never substitutes compressed storage", () => {
  assert.equal(classifyPreflight(spot, estimate()).admitted, true);
  const above = classifyPreflight(spot, estimate(spot, cap - 32767));
  assert.equal(above.admitted, false); assert.equal(above.totalReservedBytes, cap + 1);
  assert.equal(above.engineBytes, cap - 32767); assert.equal(above.exportBytes, 32768);
  assert.throws(() => classifyPreflight({ ...spot, solve: { ...spot.solve, compression: "on" } }, estimate()), /float32|compression/);
  const other = JSON.parse(estimate()); other.spotHash = "0".repeat(64);
  assert.throws(() => classifyPreflight(spot, JSON.stringify(other)), /different spot/);
  delete other.estimateExport; assert.throws(() => classifyPreflight(spot, JSON.stringify(other)));
});

test("all 504 observations are necessary; duplicate, stale, partial and unsafe evidence cannot authorize solving", () => {
  const rows = manifest.roots.map(r => row(corpusSpot(r, manifest)));
  assert.equal(summarizePreflights(manifest, rows).allocationAllowed, true);
  assert.throws(() => summarizePreflights(manifest, rows.slice(1)), /504|coverage/);
  assert.throws(() => summarizePreflights(manifest, [rows[1], ...rows.slice(1)]), /identity|order|duplicate/);
  assert.throws(() => summarizePreflights(manifest, [{ ...rows[0], rawHash: "bad" }, ...rows.slice(1)]), /hash/);
  assert.throws(() => summarizePreflights(manifest, [{ ...rows[0], sampledPeakRssBytes: 1 }, ...rows.slice(1)]), /RSS|sample/);
  assert.throws(() => summarizePreflights(manifest, [{ ...rows[0], elapsedMs: 60001 }, ...rows.slice(1)]), /timeout/);
  assert.throws(() => summarizePreflights(manifest, [{ ...rows[0], iterations: 1 } as never, ...rows.slice(1)]));
  const failed: PreflightRow = { ...rows[0], status: "error", rawEstimate: null, rawHash: null, error: "child timed out" };
  const result = summarizePreflights(manifest, [failed, ...rows.slice(1)]);
  assert.equal(result.allocationAllowed, false); assert.equal(result.errors, 1); assert.equal(result.estimated, 503);
  const raw = estimate(spot, cap); const refused = { ...rows[0], rawEstimate: raw, rawHash: sha256(raw) };
  const rejected = summarizePreflights(manifest, [refused, ...rows.slice(1)]);
  assert.equal(rejected.refused, 1); assert.equal(rejected.allocationAllowed, false);
});

test("bounded estimate process uses the real estimate command, preserves bytes and kills timeout/RSS violations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pfv2-fake-")), binary = join(directory, "estimate");
  const make = (body: string) => writeFileSync(binary, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  try {
    make(`const assert=require('node:assert/strict');assert.equal(process.argv[2],'estimate');assert.equal(process.env.RAYON_NUM_THREADS,'1');process.stdout.write(${JSON.stringify(estimate())});`);
    const done = await measurePreflight(spot, { binary, readRssBytes: async () => null });
    assert.equal(done.status, "estimated"); assert.equal(done.rawEstimate, estimate());
    assert.equal(done.sampledPeakRssBytes, null); assert.equal(done.rssSamples, 0); assert.equal(done.iterations, 0);
    make("setInterval(()=>{},1000);");
    const timeout = await measurePreflight(spot, { binary, timeoutMs: 30, readRssBytes: async () => null });
    assert.equal(timeout.status, "error"); assert.match(timeout.error!, /time/);
    const rss = await measurePreflight(spot, { binary, readRssBytes: async () => VALIDATION_BUDGETS.peakRssBytes + 1 });
    assert.equal(rss.status, "error"); assert.match(rss.error!, /RSS/); assert.ok(rss.rssSamples > 0);
    await assert.rejects(() => measurePreflight(spot, { binary, timeoutMs: 600001 }), /timeout/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("native preflight exposes valid estimates without strategy allocation or solving", { skip: !existsSync(BRIDGE_BINARY) && "build:bridge required" }, async () => {
  const reference = buildBridgeFixture("referee-river-v3-demo"), measured = await measurePreflight(reference);
  assert.equal(measured.status, "estimated", measured.error); assert.equal(measured.spotHash, hashBridgeSpot(reference));
  assert.equal(measured.strategyStorageAllocated, false); assert.equal(measured.iterations, 0);
  assert.ok(classifyPreflight(reference, measured.rawEstimate!).engineBytes > 0);
});
