/** Current orchestration; historical native sources and observations remain immutable. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashJson, prettyJson, sha256 } from "../src/lib/solver/preflop-v2/corpus";

const REPORT = "tasks/artifacts/formation-libraries-v1/reproduction-v2/reproduce.json";
const WORK = "build/formation-reproduction-v2", STAGE = `${WORK}/data`, ARCHIVE = `${WORK}/historical-publication`;
export const planFormationReplay = (hasReport: boolean): ("native" | "publish")[] => hasReport ? ["publish"] : ["native", "publish"];
interface Outcome { code: number | null; signal: string | null }
export async function runReproductionBoundary(io: { hasReport(): boolean; runNative(): Promise<Outcome>; publish(): Promise<void> }) {
  const plan = planFormationReplay(io.hasReport());
  if (plan[0] === "native") {
    const outcome = await io.runNative();
    assert.equal(outcome.signal, null, "cancelled native command; no packaging");
    assert.ok(outcome.code !== null && io.hasReport(), "native command produced no complete report; no packaging or retry");
  }
  await io.publish(); // This independently rechecks all original and corrected records and gates.
}

type Expected = { formation: string; generationHash: string; reproductionHash: string;
  rows: { id: string; dataHashes: Record<string, string> | null }[] };
export function validateStagedLegacyManifest(text: string, expected: Expected) {
  const m = JSON.parse(text), { payloadHash, ...payload } = m;
  assert.equal(text, prettyJson(m)); assert.equal(payloadHash, hashJson(payload));
  assert.equal(m.format, "poker-face-formation-library"); assert.equal(m.version, 1);
  assert.equal(m.formation, expected.formation); assert.equal(m.publication, undefined, "current manifest must never be removed");
  assert.equal(m.generationRecordHash, expected.generationHash); assert.equal(m.reproductionRecordHash, expected.reproductionHash);
  assert.equal(m.verification?.revision, 2); assert.equal(m.verification?.observations, "fresh-reproduction");
  assert.deepEqual(m.spots.map((s: { id: string }) => s.id), expected.rows.map(r => r.id));
  const refs: Record<string, string> = {};
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if ("url" in o) {
      assert.equal(typeof o.url, "string"); const url = o.url as string;
      assert.ok(url.startsWith(`/solver-data/bridge-formations-v1/${expected.formation}/`) && !url.includes(".."));
      assert.equal(typeof o.sha256, "string"); assert.match(o.sha256 as string, /^[0-9a-f]{64}$/);
      assert.ok(!(url in refs), "duplicate data reference"); refs[url] = o.sha256 as string;
    }
    Object.values(o).forEach(walk);
  };
  walk(m);
  const wanted: Record<string, string> = {};
  for (const row of expected.rows) {
    assert.ok(row.dataHashes);
    for (const [url, digest] of Object.entries(row.dataHashes)) { assert.ok(!(url in wanted)); wanted[url] = digest; }
  }
  assert.deepEqual(refs, wanted, "legacy manifest differs from the original fresh data");
}
function archiveUnpublishedLegacyManifests() {
  const text = readFileSync(REPORT, "utf8"), report = JSON.parse(text), { payloadHash, ...payload } = report;
  assert.equal(text, prettyJson(report)); assert.equal(payloadHash, hashJson(payload));
  assert.equal(report.correctionRevision, 2); assert.equal(report.phase, "reproduce");
  for (const group of report.groups) {
    assert.ok(/^[a-z0-9-]+$/.test(group.formation));
    const path = join(STAGE, group.formation, "manifest.json");
    if (!existsSync(path)) continue;
    const manifest = readFileSync(path, "utf8");
    if (JSON.parse(manifest).publication !== undefined) continue; // The strict current publisher validates it.
    assert.equal(group.status, "complete");
    validateStagedLegacyManifest(manifest, { formation: group.formation, generationHash: report.originalGenerationHash,
      reproductionHash: report.payloadHash, rows: group.rows });
    mkdirSync(ARCHIVE, { recursive: true });
    const destination = join(ARCHIVE, `${group.formation}-${sha256(manifest)}.json`);
    assert.ok(!existsSync(destination), "historical manifest already archived; inspect rather than overwrite");
    renameSync(path, destination); // Only our unpublished staged manifest; all data and reports stay in place.
  }
}
function child(script: string, args: string[], log?: string): Promise<Outcome> {
  const fd = log ? openSync(log, "wx") : null;
  return new Promise((resolveResult, reject) => {
    const proc = spawn(process.execPath, ["--import", "tsx", script, ...args], { stdio: fd === null ? "inherit" : ["ignore", fd, fd] });
    let cancelled = false, closed = false;
    const cancel = () => { cancelled = true; proc.kill("SIGTERM"); };
    process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
    const cleanup = () => { if (closed) return; closed = true; process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); if (fd !== null) closeSync(fd); };
    proc.once("error", error => { cleanup(); reject(error); });
    proc.once("exit", (code, signal) => { cleanup(); resolveResult({ code, signal: cancelled ? "SIGTERM" : signal }); });
  });
}
async function main() {
  assert.equal(process.argv.length, 2, "Usage: npm run reproduce:bridge:formations");
  console.log(existsSync(REPORT) ? "Existing evidence: replaying publication/audit; no fresh native solve." : "Fresh experiment: one native reproduction pass, then strict current publication.");
  await runReproductionBoundary({ hasReport: () => existsSync(REPORT), runNative: async () => {
    mkdirSync(WORK, { recursive: true }); const log = `${WORK}/native-command-${Date.now()}.log`;
    console.log(`Native progress and exit evidence: ${log}`);
    const outcome = await child("scripts/reproduce-formation-libraries.ts", ["--reproduce"], log);
    writeFileSync(`${log}.exit.json`, prettyJson(outcome), { flag: "wx" }); return outcome;
  }, publish: async () => {
    archiveUnpublishedLegacyManifests(); const outcome = await child("scripts/publish-formation-libraries.ts", ["--publish"]);
    assert.equal(outcome.signal, null); assert.equal(outcome.code, 0, "current publication audit failed");
  } });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
