/** Read-only journal/provenance checks in addition to the frozen complete saved-pack audit. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditPublishedFullReachV3 } from "./publish-full-reach-v3";
import { FULL_REACH_EVIDENCE as DIR } from "./measure-full-reach-v2";
import { readHashed } from "./capture-formation-export-diagnostic";
import { v2Roots } from "../src/lib/solver/bridge/formations/full-reach-library-v2";
import { FORMATION_BUDGETS as B } from "../src/lib/solver/bridge/formations/fixtures";

interface Observation { id: string; iterations: number; pctPot: number; elapsedMs: number; peakRssBytes: number;
  resultHash: string; nativeFileHash: string; rawBytes: number; provenance: string }
interface Journal {
  payloadHash: string; status: string; generation: Observation[]; reproduction: Observation[];
  attempts: { phase: string; id: string; status: string; startedAt: string; rawFile: string | null; rawBytes: number | null; row: Observation | null }[];
}
export function auditFullReachJournal(report: Journal) {
  const roots = v2Roots(), expected = [...roots.slice(6).map(r => `generate-${r.id}`), ...roots.map(r => `reproduce-${r.id}`)];
  const actual = report.attempts.map(a => `${a.phase}-${a.id}`);
  assert.deepEqual(actual, expected.slice(0, actual.length), "attempt order or hidden retry");
  if (report.status === "complete") assert.deepEqual(actual, expected);
  else { assert.equal(report.status, "blocked"); assert.ok(report.attempts.filter(a => a.status === "failed").length <= 1); }
  assert.deepEqual(readdirSync(`${DIR}/attempts`).sort(), actual.flatMap(k => [`${k}.start.json`, `${k}.finish.json`]).sort(), "unaccounted attempt");
  let previousTime = 0;
  for (const a of report.attempts) {
    const time = Date.parse(a.startedAt); assert.ok(Number.isFinite(time) && time >= previousTime); previousTime = time;
    if (a.rawFile !== null) assert.equal(a.rawFile, `build/formation-full-reach-v2/native/${a.phase}-${a.id}.json`);
    if (a.rawBytes !== null) assert.ok(Number.isSafeInteger(a.rawBytes) && a.rawBytes > 0 && a.rawBytes <= B.rawResultBytes);
    if (a.row) { assert.equal(a.row.provenance, `fresh-${a.phase}`); assert.equal(a.row.rawBytes, a.rawBytes); }
  }
  for (const r of [...report.generation, ...report.reproduction]) {
    assert.ok(Number.isInteger(r.iterations) && r.iterations > 0 && r.iterations <= B.iterations);
    assert.ok(Number.isFinite(r.pctPot) && r.pctPot >= 0 && r.pctPot <= B.gatePctPot);
    assert.ok(Number.isFinite(r.elapsedMs) && r.elapsedMs > 0 && r.elapsedMs <= B.perSolveMs);
    assert.ok(Number.isSafeInteger(r.peakRssBytes) && r.peakRssBytes > 0 && r.peakRssBytes <= B.rssBytes);
    assert.match(r.resultHash, /^[a-f0-9]{64}$/); assert.match(r.nativeFileHash, /^[a-f0-9]{64}$/);
  }
  const original = readHashed<{ payloadHash: string; groups: { formation: string; rows: Observation[] }[] }>("tasks/artifacts/formation-libraries-v1/generate.json");
  const old = original.groups.find(g => g.formation === "co-btn-srp-v1")!.rows;
  report.generation.slice(0, 5).forEach((row, i) => {
    assert.equal(row.provenance, "reused-original-accepted-cache");
    for (const key of ["id", "resultHash", "iterations", "pctPot", "elapsedMs", "peakRssBytes"] as const) assert.equal(row[key], old[i][key]);
  });
  if (report.generation.length >= 6) {
    const diagnostic = JSON.parse(readFileSync("tasks/artifacts/formation-export-diagnostic-v1/observation.json", "utf8")), previous = diagnostic.runs[0];
    const row = report.generation[5]; assert.equal(row.provenance, "reused-diagnostic-run-zero"); assert.equal(row.nativeFileHash, previous.resultHash);
    for (const key of ["iterations", "pctPot", "elapsedMs", "peakRssBytes"] as const) assert.equal(row[key], previous[key]);
  }
  return { freshAttempts: report.attempts.length, reusedGenerationInputs: Math.min(6, report.generation.length), status: report.status };
}
export function auditFullReachV2() {
  const report = readHashed<Journal>(`${DIR}/experiment.json`);
  return { journal: auditFullReachJournal(report), ...auditPublishedFullReachV3() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2); console.log(JSON.stringify(auditFullReachV2()));
}
