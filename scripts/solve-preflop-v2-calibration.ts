/** Frozen A/calibration roots only. A necessary failure stops dependent experiments. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_BINARY } from "./bridge-runner";
import { readValidationManifest } from "./audit-preflop-v2-contract";
import { nativeInputHashes, preflightReport, sourceHashes, type PreflightReport } from "./measure-preflop-v2-research";
import { corpusSpot, hashJson, prettyJson, sha256, VALIDATION_BUDGETS } from "../src/lib/solver/preflop-v2/corpus";
import { calibrationRoots, measureContinuation, type ContinuationObservation } from "../src/lib/solver/preflop-v2/observations";
export const CALIBRATION_SOURCES = ["scripts/solve-preflop-v2-calibration.ts", "src/lib/solver/preflop-v2/observations.ts",
  "tasks/artifacts/preflop-v2-calibration-contract.md"] as const;

async function main() {
  const [mode, input, destination, ...extra] = process.argv.slice(2);
  assert.ok(mode === "--measure" && input && destination && !extra.length, "--measure <preflight.json> <new output.json>");
  const preflight: PreflightReport = JSON.parse(readFileSync(input, "utf8"));
  assert.deepEqual(preflight, preflightReport(preflight.rows, { measuredAt: preflight.measuredAt, baseCommit: preflight.baseCommit, nativeBinarySha256: preflight.nativeBinarySha256, machine: preflight.machine }));
  assert.ok(preflight.summary.allocationAllowed, "all 504 estimates must pass before allocation");
  assert.equal(sha256(readFileSync(BRIDGE_BINARY)), preflight.nativeBinarySha256);
  const out = resolve(destination), journal = `${out}.jsonl`;
  assert.ok(!existsSync(out) && !existsSync(journal), "refusing to overwrite original observations");
  const manifest = readValidationManifest(), roots = calibrationRoots(manifest), rows: ContinuationObservation[] = [];
  const metadata = { format: "poker-face-preflop-v2-calibration", version: 1, measuredAt: new Date().toISOString(),
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), corpusHash: manifest.payloadHash,
    preflightHash: preflight.payloadHash, nativeBinarySha256: sha256(readFileSync(BRIDGE_BINARY)), nativeInputHashes: nativeInputHashes(),
    sourceHashes: sourceHashes(CALIBRATION_SOURCES), machine: { cpu: cpus()[0].model, ramBytes: totalmem(), platform: platform(), osRelease: release(), node: process.version } };
  writeFileSync(journal, `${JSON.stringify(metadata)}\n`, { flag: "wx" });
  let elapsedMs = 0, stopReason: string | null = null;
  for (const root of roots) {
    const remainingMs = Math.floor(VALIDATION_BUDGETS.corpusSolveMs - elapsedMs);
    if (remainingMs <= 0) { stopReason = "four-hour corpus solve budget exhausted"; break; }
    const spot = corpusSpot(root, manifest);
    console.log(JSON.stringify({ starting: root.id, completed: rows.length, required: 144 }));
    const row = await measureContinuation(spot, { timeoutMs: Math.min(spot.solve.timeoutMs, remainingMs),
      maxResultBytes: VALIDATION_BUDGETS.rawRecordBytes - statSync(journal).size });
    rows.push(row); elapsedMs += row.elapsedMs;
    const line = `${JSON.stringify(row)}\n`; assert.ok(statSync(journal).size + Buffer.byteLength(line) <= VALIDATION_BUDGETS.rawRecordBytes);
    appendFileSync(journal, line);
    console.log(JSON.stringify({ ...row, rawResult: row.rawResult ? "saved in journal" : null, stderr: "saved in journal" }));
    if (row.status === "failed") { stopReason = row.error!; break; }
  }
  assert.deepEqual(sourceHashes(CALIBRATION_SOURCES), metadata.sourceHashes, "observation source changed during solve");
  const payload = { ...metadata, required: roots.length, attempted: rows.length, passed: rows.filter(r => r.status === "passed").length,
    elapsedMs, stopReason, complete: rows.length === 144 && rows.every(r => r.status === "passed"),
    fittedModels: 0, heldoutObservations: 0, productionRangePromotion: false, rows };
  const report = { ...payload, payloadHash: hashJson(payload) }, bytes = prettyJson(report);
  assert.ok(Buffer.byteLength(bytes) + statSync(journal).size <= VALIDATION_BUDGETS.rawRecordBytes);
  writeFileSync(out, bytes, { flag: "wx" }); console.log(JSON.stringify({ ...report, rows: undefined }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
