/** Bounded native observations. Checkpoints are diagnostics, never completed policies. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkBridgeResult, validateBridgeSpot, type BridgeSpotV1 } from "../bridge/contract";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../bridge/contract-node";
import { sha256, VALIDATION_BUDGETS, type ValidationManifest } from "./corpus";
const execute = promisify(execFile);
const DEFAULT_BINARY = new URL("../../../../native/solver-bridge/target/release/solver-bridge", import.meta.url).pathname;
export function calibrationRoots(manifest: ValidationManifest) {
  const roots = manifest.roots.filter(r => r.profile === "A" && manifest.boards.find(b => b.key === r.boardKey)?.role !== "holdout");
  assert.equal(roots.length, 144, "complete calibration coverage required");
  return roots;
}
export interface ContinuationObservation {
  id: string; spotHash: string; status: "passed" | "failed"; error?: string;
  rawResult: string | null; resultHash: string | null; stderr: string;
  lastCheckpoint: { iteration: number; exploitability: number; elapsedMs: number } | null;
  elapsedMs: number; sampledPeakRssBytes: number | null; rssSamples: number; rssErrors: number;
  threads: 8; command: "solve";
}
export function checkContinuationResult(raw: string, spot: BridgeSpotV1) {
  const result = checkBridgeResult(JSON.parse(raw), spot, hashBridgeSpot(spot));
  assert.equal(result.engine.precision, "float32"); assert.equal(result.engine.threads, 8);
  assert.ok(result.iterations <= spot.solve.maxIterations);
  assert.ok(result.exploitability.reached && result.exploitability.pctPot <= spot.solve.targetExploitabilityPctPot, "continuation quality target not reached");
  assert.ok(result.timings.totalMs <= spot.solve.timeoutMs, "native time budget exceeded");
  assert.ok(result.memory.peakRssBytes <= VALIDATION_BUDGETS.peakRssBytes, "native RSS budget exceeded");
  return result;
}
const nativeRss = async (pid: number) => {
  const { stdout } = await execute("ps", ["-o", "rss=", "-p", String(pid)]);
  const bytes = Number(stdout.trim()) * 1024; return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
};
export async function measureContinuation(input: BridgeSpotV1, options: {
  binary?: string; timeoutMs?: number; readRssBytes?: (pid: number) => Promise<number | null>; maxResultBytes?: number;
} = {}): Promise<ContinuationObservation> {
  const spot = validateBridgeSpot(input), timeout = options.timeoutMs ?? spot.solve.timeoutMs;
  assert.ok(Number.isInteger(timeout) && timeout > 0 && timeout <= Math.min(600_000, spot.solve.timeoutMs), "invalid solve timeout");
  assert.equal(spot.solve.compression, "off");
  const maxBytes = options.maxResultBytes ?? VALIDATION_BUDGETS.rawRecordBytes;
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= VALIDATION_BUDGETS.rawRecordBytes);
  const dir = mkdtempSync(join(tmpdir(), "pfv2-solve-")), path = join(dir, "spot.json"), output = join(dir, "result.json");
  writeFileSync(path, canonicalBridgeSpotJson(spot)); const started = performance.now();
  try {
    return await new Promise<ContinuationObservation>(resolve => {
      const child = spawn(options.binary ?? DEFAULT_BINARY, ["solve", path, "--out", output, "--threads", "8"], { stdio: ["ignore", "ignore", "pipe"] });
      let failure: string | undefined, stderr = "", closed = false, polling = false, peak: number | null = null, samples = 0, errors = 0;
      const fail = (reason: string) => { failure ??= reason; child.kill("SIGKILL"); };
      const timer = setTimeout(() => fail(`continuation timed out after ${timeout} ms; no result published`), timeout);
      const sampler = setInterval(() => {
        if (closed || polling || !child.pid) return; polling = true;
        (options.readRssBytes ?? nativeRss)(child.pid).then(rss => {
          if (closed || rss === null) return;
          if (!Number.isSafeInteger(rss) || rss <= 0) { errors++; return; }
          samples++; peak = Math.max(peak ?? 0, rss);
          if (rss > VALIDATION_BUDGETS.peakRssBytes) fail(`sampled RSS ${rss} exceeded ${VALIDATION_BUDGETS.peakRssBytes}`);
        }).catch(() => { if (!closed) errors++; }).finally(() => { polling = false; });
      }, 50);
      child.stderr.on("data", bytes => {
        if (Buffer.byteLength(stderr) + bytes.length > 1024 ** 2) { fail("progress output exceeded 1 MiB"); return; }
        stderr += String(bytes);
      });
      child.on("error", error => { failure ??= error.message; });
      child.on("close", (code, signal) => {
        closed = true; clearTimeout(timer); clearInterval(sampler);
        let rawResult: string | null = null, resultHash: string | null = null;
        const elapsedMs = performance.now() - started;
        if (!failure && (code !== 0 || signal)) failure = `continuation exited ${code ?? signal}; see original stderr`;
        if (!failure && elapsedMs > timeout) failure = `continuation exceeded ${timeout} ms including export`;
        if (!failure) try {
          assert.ok(statSync(output).size <= maxBytes, "raw observation budget exceeded");
          const raw = readFileSync(output, "utf8");
          // A clean exit may still miss the quality target. Keep that complete raw result as evidence.
          checkBridgeResult(JSON.parse(raw), spot, hashBridgeSpot(spot));
          rawResult = raw; resultHash = sha256(raw); checkContinuationResult(raw, spot);
        } catch (e) { failure = String(e); }
        let lastCheckpoint: ContinuationObservation["lastCheckpoint"] = null;
        for (const line of stderr.trim().split("\n")) try {
          const p = JSON.parse(line);
          if (p.type === "progress" && p.stage === "solving" && Number.isInteger(p.iteration) && p.iteration >= 0
            && Number.isFinite(p.exploitability) && Number.isFinite(p.elapsedMs)) lastCheckpoint = { iteration: p.iteration, exploitability: p.exploitability, elapsedMs: p.elapsedMs };
        } catch { /* Preserve original diagnostic text, not invented measurements. */ }
        resolve({ id: spot.id, spotHash: hashBridgeSpot(spot), status: failure ? "failed" : "passed", ...(failure ? { error: failure } : {}),
          rawResult, resultHash, stderr, lastCheckpoint, elapsedMs, sampledPeakRssBytes: peak, rssSamples: samples, rssErrors: errors,
          threads: 8, command: "solve" });
      });
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
