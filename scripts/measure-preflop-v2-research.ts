/** Step-11 native preflight observations only. Never solves, fits, prunes or redraws. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_BINARY } from "./bridge-runner";
import { readValidationManifest } from "./audit-preflop-v2-contract";
import { POSTFLOP_SOLVER_COMMIT } from "../src/lib/solver/bridge/contract";
import { corpusSpot, hashJson, prettyJson, sha256, VALIDATION_BUDGETS } from "../src/lib/solver/preflop-v2/corpus";
import { classifyPreflight, measurePreflight, summarizePreflights, type PreflightRow } from "../src/lib/solver/preflop-v2/preflight";

export const RESEARCH_CONTRACT = "tasks/artifacts/preflop-v2-research-contract.md";
export const MEASUREMENT_SOURCES = ["src/lib/solver/preflop-v2/preflight.ts", "src/lib/solver/preflop-v2/corpus.ts",
  "scripts/measure-preflop-v2-research.ts"] as const;
export const sourceHashes = (paths: readonly string[]) => Object.fromEntries(paths.map(p => [p, sha256(readFileSync(p))]));
export function nativeInputHashes() {
  const paths = execFileSync("git", ["ls-files", "native/solver-bridge"], { encoding: "utf8" }).trim().split("\n");
  assert.ok(paths.length > 10); return sourceHashes(paths);
}
export function preflightReport(rows: readonly PreflightRow[], metadata: {
  measuredAt: string; baseCommit: string; nativeBinarySha256: string;
  machine: { cpu: string; ramBytes: number; platform: string; osRelease: string; node: string };
}) {
  const manifest = readValidationManifest();
  const payload = { format: "poker-face-preflop-v2-preflight", version: 1, ...metadata, engineCommit: POSTFLOP_SOLVER_COMMIT,
    corpusHash: manifest.payloadHash, researchContractHash: sha256(readFileSync(RESEARCH_CONTRACT)),
    measurementSourceHashes: sourceHashes(MEASUREMENT_SOURCES), nativeInputHashes: nativeInputHashes(),
    interpretation: "Uncompressed native allocation estimates plus conservative export reservation, not measured solve memory or speed. No strategy storage allocated, no CFR iterations, no fitted model or held-out EV observations.",
    summary: summarizePreflights(manifest, rows), rows };
  return { ...payload, payloadHash: hashJson(payload) };
}
export type PreflightReport = ReturnType<typeof preflightReport>;

async function main() {
  const [mode, destination, ...extra] = process.argv.slice(2);
  assert.ok(mode === "--estimate" && destination && extra.length === 0, "Usage: --estimate <new output.json>");
  const out = resolve(destination), journal = `${out}.jsonl`;
  assert.ok(!existsSync(out) && !existsSync(journal), "refusing to overwrite frozen observations");
  assert.ok(existsSync(BRIDGE_BINARY), "build:bridge required");
  const manifest = readValidationManifest(), rows: PreflightRow[] = [];
  const metadata = { measuredAt: new Date().toISOString(), baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    nativeBinarySha256: sha256(readFileSync(BRIDGE_BINARY)),
    machine: { cpu: cpus()[0].model, ramBytes: totalmem(), platform: platform(), osRelease: release(), node: process.version } };
  // Journal original rows as they arrive. An interrupted batch is evidence, never a complete corpus.
  const before = sourceHashes([...MEASUREMENT_SOURCES, RESEARCH_CONTRACT]);
  writeFileSync(journal, `${JSON.stringify({ metadata, corpusHash: manifest.payloadHash, sourceHashes: before })}\n`, { flag: "wx" });
  for (const root of manifest.roots) {
    const spot = corpusSpot(root, manifest), row = await measurePreflight(spot); rows.push(row);
    const line = `${JSON.stringify(row)}\n`;
    assert.ok(statSync(journal).size + Buffer.byteLength(line) <= VALIDATION_BUDGETS.rawRecordBytes, "raw evidence budget exceeded");
    appendFileSync(journal, line);
    if (rows.length % 12 === 0 || row.status === "error") console.log(JSON.stringify({ completed: rows.length, required: 504, id: row.id,
      status: row.status, ...(row.status === "estimated" ? classifyPreflight(spot, row.rawEstimate!) : { error: row.error }) }));
  }
  assert.deepEqual(sourceHashes([...MEASUREMENT_SOURCES, RESEARCH_CONTRACT]), before, "measurement source changed during the batch");
  const report = preflightReport(rows, metadata), bytes = prettyJson(report);
  assert.ok(Buffer.byteLength(bytes) + statSync(journal).size <= VALIDATION_BUDGETS.rawRecordBytes, "raw evidence budget exceeded");
  writeFileSync(out, bytes, { flag: "wx" });
  console.log(JSON.stringify({ ...report.summary, refusals: report.summary.refusals.length, payloadHash: report.payloadHash }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
