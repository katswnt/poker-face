import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calibrationRoots, checkContinuationResult, measureContinuation } from "../src/lib/solver/preflop-v2/observations";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { readValidationManifest } from "../scripts/audit-preflop-v2-contract";
import { corpusSpot, VALIDATION_BUDGETS } from "../src/lib/solver/preflop-v2/corpus";

test("calibration order admits all 144 A training roots and never a holdout", () => {
  const manifest = readValidationManifest(), roots = calibrationRoots(manifest);
  assert.equal(roots.length, 144);
  assert.deepEqual(roots, manifest.roots.filter(r => r.profile === "A" && manifest.boards.find(b => b.key === r.boardKey)!.role !== "holdout"));
  assert.throws(() => calibrationRoots({ ...manifest, roots: manifest.roots.slice(1) }));
});

test("a clean native result must also meet the declared quality, precision and resource limits", { skip: !existsSync(BRIDGE_BINARY) && "build:bridge required" }, async () => {
  const spot = buildBridgeFixture("referee-river-v3-demo"), run = await runBridgeSpot(spot, { threads: 8 });
  const raw = JSON.stringify(run.result); assert.deepEqual(checkContinuationResult(raw, spot), run.result);
  for (const change of [
    (r: typeof run.result) => ({ ...r, exploitability: { ...r.exploitability, reached: false } }),
    (r: typeof run.result) => ({ ...r, engine: { ...r.engine, precision: "int16-compressed" } }),
    (r: typeof run.result) => ({ ...r, engine: { ...r.engine, threads: 9 } }),
    (r: typeof run.result) => ({ ...r, memory: { ...r.memory, peakRssBytes: VALIDATION_BUDGETS.peakRssBytes + 1 } }),
    (r: typeof run.result) => ({ ...r, timings: { ...r.timings, totalMs: spot.solve.timeoutMs + 1 } }),
  ]) assert.throws(() => checkContinuationResult(JSON.stringify(change(run.result)), spot));
});

test("failed continuation retains bounded progress and RSS but never publishes a partial observation", async () => {
  const m = readValidationManifest(), spot = corpusSpot(calibrationRoots(m)[0], m);
  const dir = mkdtempSync(join(tmpdir(), "pfv2-observation-test-")), binary = join(dir, "fake");
  try {
    writeFileSync(binary, `#!/bin/sh
[ "$1" = solve ] && [ "$5" = --threads ] && [ "$6" = 8 ] || exit 12
echo '{"type":"progress","stage":"solving","iteration":10,"exploitability":7,"elapsedMs":1}' >&2
echo '{}' > "$4"
exec sleep 60
`);
    chmodSync(binary, 0o755);
    const row = await measureContinuation(spot, { binary, timeoutMs: 3000, readRssBytes: async () => 123456 });
    assert.equal(row.status, "failed"); assert.match(row.error!, /timed out/);
    assert.equal(row.rawResult, null); assert.equal(row.resultHash, null); assert.equal(row.threads, 8);
    assert.equal(row.sampledPeakRssBytes, 123456); assert.ok(row.rssSamples > 0);
    assert.ok(row.stderr.includes('"iteration":10')); assert.equal(row.lastCheckpoint?.iteration, 10);
    const memory = await measureContinuation(spot, { binary, timeoutMs: 3000, readRssBytes: async () => VALIDATION_BUDGETS.peakRssBytes + 1 });
    assert.equal(memory.status, "failed"); assert.match(memory.error!, /RSS/); assert.equal(memory.rawResult, null);
    await assert.rejects(measureContinuation(spot, { timeoutMs: 600001 }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
