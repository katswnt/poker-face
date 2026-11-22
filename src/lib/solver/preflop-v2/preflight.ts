/** Node-only bounded research screen. This module never invokes solve or allocates a policy. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BridgeSpotV1 } from "../bridge/contract";
import { validateBridgeSpot } from "../bridge/contract";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../bridge/contract-node";
import { parseLiveEstimate } from "../bridge/live/admission";
import { corpusSpot, sha256, VALIDATION_BUDGETS, type ValidationManifest } from "./corpus";

const execute = promisify(execFile);
const DEFAULT_BINARY = new URL("../../../../native/solver-bridge/target/release/solver-bridge", import.meta.url).pathname;
const MAX_OUTPUT_BYTES = 1024 ** 2;
export interface PreflightRow {
  readonly id: string; readonly spotHash: string; readonly status: "estimated" | "error";
  readonly rawEstimate: string | null; readonly rawHash: string | null; readonly error?: string;
  readonly elapsedMs: number; readonly sampledPeakRssBytes: number | null; readonly rssSamples: number; readonly rssErrors: number;
  readonly threads: 1; readonly command: "estimate"; readonly strategyStorageAllocated: false; readonly iterations: 0;
}
export function classifyPreflight(spot: BridgeSpotV1, raw: string) {
  if (spot.solve.compression !== "off") throw new Error("research requires uncompressed float32; no compression substitution");
  const estimate = parseLiveEstimate(raw, spot, hashBridgeSpot(spot));
  const engineBytes = estimate.estimatedBytes, exportBytes = estimate.estimateExport.workingBytesEstimate;
  const totalReservedBytes = engineBytes + exportBytes;
  if (!Number.isSafeInteger(totalReservedBytes)) throw new Error("reservation overflow");
  const budgetBytes = Math.min(spot.solve.memoryCapBytes, VALIDATION_BUDGETS.estimatedAllocationAndExportBytes);
  return { admitted: totalReservedBytes <= budgetBytes, engineBytes, exportBytes, totalReservedBytes, budgetBytes,
    jsonBytesUpperBound: estimate.estimateExport.jsonBytesUpperBound };
}

const nativeRss = async (pid: number): Promise<number | null> => {
  const { stdout } = await execute("ps", ["-o", "rss=", "-p", String(pid)]);
  const value = Number(stdout.trim()) * 1024;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};
export async function measurePreflight(input: BridgeSpotV1, options: {
  binary?: string; timeoutMs?: number; readRssBytes?: (pid: number) => Promise<number | null>;
} = {}): Promise<PreflightRow> {
  const spot = validateBridgeSpot(input), timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > Math.min(60_000, spot.solve.timeoutMs)) throw new Error("invalid preflight timeout");
  if (spot.solve.compression !== "off") throw new Error("preflight requires float32");
  const directory = mkdtempSync(join(tmpdir(), "poker-pfv2-estimate-")), path = join(directory, "spot.json");
  writeFileSync(path, canonicalBridgeSpotJson(spot)); const spotHash = hashBridgeSpot(spot), started = performance.now();
  try {
    return await new Promise<PreflightRow>(resolve => {
      const child = spawn(options.binary ?? DEFAULT_BINARY, ["estimate", path], {
        stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, RAYON_NUM_THREADS: "1" },
      });
      let stdout = "", stderr = "", failure: string | undefined, closed = false, polling = false, peak: number | null = null, samples = 0, sampleErrors = 0;
      const fail = (message: string) => { failure ??= message; child.kill("SIGKILL"); };
      const timer = setTimeout(() => fail(`preflight timed out after ${timeoutMs} ms`), timeoutMs);
      const sampler = setInterval(() => {
        if (closed || polling || !child.pid) return; polling = true;
        (options.readRssBytes ?? nativeRss)(child.pid).then(rss => {
          if (closed || rss === null) return;
          if (!Number.isSafeInteger(rss) || rss <= 0) { sampleErrors++; return; }
          samples++; peak = Math.max(peak ?? 0, rss);
          if (rss > VALIDATION_BUDGETS.peakRssBytes) fail(`preflight sampled RSS ${rss} exceeded ${VALIDATION_BUDGETS.peakRssBytes}`);
        }).catch(() => { if (!closed) sampleErrors++; }).finally(() => { polling = false; });
      }, 50);
      child.stdout.on("data", data => { stdout += String(data); if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) fail("preflight output exceeded 1 MiB"); });
      child.stderr.on("data", data => { stderr = (stderr + String(data)).slice(-4096); });
      child.on("error", e => { failure ??= e.message; });
      child.on("close", (code, signal) => {
        closed = true; clearTimeout(timer); clearInterval(sampler);
        if (!failure && (code !== 0 || signal)) failure = `preflight exited ${code ?? signal}: ${stderr}`;
        if (!failure) { try { classifyPreflight(spot, stdout); } catch (e) { failure = String(e); } }
        if (!failure && performance.now() - started > timeoutMs) failure = `preflight exceeded ${timeoutMs} ms`;
        resolve({ id: spot.id, spotHash, status: failure ? "error" : "estimated", rawEstimate: failure ? null : stdout,
          rawHash: failure ? null : sha256(stdout), ...(failure ? { error: failure } : {}), elapsedMs: performance.now() - started,
          sampledPeakRssBytes: peak, rssSamples: samples, rssErrors: sampleErrors,
          threads: 1, command: "estimate", strategyStorageAllocated: false, iterations: 0 });
      });
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function summarizePreflights(manifest: ValidationManifest, rows: readonly PreflightRow[]) {
  assert.equal(rows.length, 504, "504 roots required for coverage"); assert.equal(manifest.roots.length, 504);
  let admitted = 0, refused = 0, errors = 0, maximumReservedBytes = 0, maximumEngineBytes = 0, maximumExportBytes = 0, totalWallMs = 0;
  const refusals: { id: string; reason: string }[] = [];
  for (const [i, row] of rows.entries()) {
    const root = manifest.roots[i]; assert.equal(row.id, root.id, "row identity/order mismatch"); assert.equal(row.spotHash, root.spotHash, "row spot hash mismatch");
    assert.equal(row.command, "estimate"); assert.equal(row.threads, 1); assert.equal(row.strategyStorageAllocated, false); assert.equal(row.iterations, 0);
    assert.ok(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0); totalWallMs += row.elapsedMs;
    assert.ok(Number.isSafeInteger(row.rssSamples) && row.rssSamples >= 0 && Number.isSafeInteger(row.rssErrors) && row.rssErrors >= 0, "invalid RSS samples");
    assert.equal(row.sampledPeakRssBytes === null, row.rssSamples === 0, "unknown RSS must have no samples");
    if (row.sampledPeakRssBytes !== null) assert.ok(Number.isSafeInteger(row.sampledPeakRssBytes) && row.sampledPeakRssBytes > 0, "invalid sampled RSS");
    if (row.status === "error") {
      assert.equal(row.rawEstimate, null); assert.equal(row.rawHash, null); assert.ok(row.error?.trim());
      errors++; refusals.push({ id: row.id, reason: row.error! }); continue;
    }
    assert.equal(row.status, "estimated"); assert.equal(row.error, undefined); assert.equal(typeof row.rawEstimate, "string");
    assert.ok(row.elapsedMs <= 60_000, "successful estimate exceeded preflight timeout");
    assert.equal(sha256(row.rawEstimate!), row.rawHash, "raw estimate hash mismatch");
    assert.ok(row.sampledPeakRssBytes === null || row.sampledPeakRssBytes <= VALIDATION_BUDGETS.peakRssBytes, "successful estimate exceeded sampled RSS cap");
    const verdict = classifyPreflight(corpusSpot(root, manifest), row.rawEstimate!);
    maximumReservedBytes = Math.max(maximumReservedBytes, verdict.totalReservedBytes);
    maximumEngineBytes = Math.max(maximumEngineBytes, verdict.engineBytes); maximumExportBytes = Math.max(maximumExportBytes, verdict.exportBytes);
    if (verdict.admitted) admitted++;
    else { refused++; refusals.push({ id: row.id, reason: `${verdict.totalReservedBytes} reserved bytes exceed ${verdict.budgetBytes}` }); }
  }
  return { roots: rows.length, estimated: admitted + refused, admitted, refused, errors, allocationAllowed: admitted === 504,
    maximumReservedBytes, maximumEngineBytes, maximumExportBytes, totalWallMs, refusals };
}
