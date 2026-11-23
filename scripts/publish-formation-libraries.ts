/** Package verified observations with the corrected exact float32 reporting check. No solving. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { nativeInputHashes } from "./measure-preflop-v2-research";
import { replayAttemptStatus, validatePhaseReport } from "./build-formation-libraries";
import { hashJson, prettyJson, sha256 } from "../src/lib/solver/preflop-v2/corpus";
import type { PreflightRow } from "../src/lib/solver/preflop-v2/preflight";
import { POSTFLOP_SOLVER_COMMIT } from "../src/lib/solver/bridge/contract";
import { REACH_SCALE, STRATEGY_SCALE, EV_SCALE, EQUITY_SCALE, type BridgeLibrarySpot } from "../src/lib/solver/bridge/library/model";
import { FORMATION_BUDGETS as B, FORMATION_ROOT, FORMATION_URL, FORMATION_INPUTS, buildFormationManifest,
  verifyFormationManifest, formationSpot } from "../src/lib/solver/bridge/formations/fixtures";
import { fileTotals, formationReservation, formationSourceHashes,
  FORMATION_LABEL, type FormationLibraryManifest, type FormationReferee } from "../src/lib/solver/bridge/formations/library";

import { auditPublishedFormation as auditFormationLibrary } from "../src/lib/solver/bridge/formations/publication";

const PUBLICATION_SOURCES = ["scripts/publish-formation-libraries.ts", "src/lib/solver/bridge/formations/publication.ts", "tasks/artifacts/formation-libraries-v1/publication-v3/contract.md"];
const publicationHashes = () => Object.fromEntries(PUBLICATION_SOURCES.map(p => [p, sha256(readFileSync(p))]));
const ORIGINAL = "tasks/artifacts/formation-libraries-v1", EVIDENCE = `${ORIGINAL}/reproduction-v2`;
const STAGE = "build/formation-reproduction-v2/data";
const SOURCES = ["scripts/reproduce-formation-libraries.ts", "scripts/audit-formation-release.ts", `${EVIDENCE}/contract.md`];
type BaseReport = Parameters<typeof validatePhaseReport>[0];
type Finish = ReturnType<typeof replayAttemptStatus>;
type Fresh = Finish & { entry: BridgeLibrarySpot | null; referee: FormationReferee | null;
  diagnosticHashes: Record<string, string> | null; diagnosticResultHash: string | null };
interface Group { formation: string; status: "complete" | "blocked"; error: string | null; rows: Fresh[] }
type Report = Omit<BaseReport, "groups"> & { correctionRevision: 2; originalGenerationHash: string; groups: Group[] };
type Manifest = FormationLibraryManifest & { publication: { revision: 3; sourceHashes: Record<string, string> }; verification: { revision: 2; sourceHashes: Record<string, string>;
  originalReproductionRecordHash: string; observations: "fresh-reproduction" } };
const withHash = <T extends object>(p: T) => ({ ...p, payloadHash: hashJson(p) });
function readHashed<T extends { payloadHash: string }>(path: string): T {
  const text = readFileSync(path, "utf8"), value: T = JSON.parse(text), { payloadHash, ...p } = value;
  assert.equal(payloadHash, hashJson(p)); assert.equal(text, prettyJson(value)); return value;
}
function writeOnce(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) assert.equal(readFileSync(path, "utf8"), text, "immutable file differs");
  else writeFileSync(path, text, { flag: "wx" });
}
const sourceHashes = () => Object.fromEntries(SOURCES.map(p => [p, sha256(readFileSync(p))]));

/** Preserve the complete original byte target; a re-serialized cache is not that target. */
export function compareFreshFormationHashes(actual: { dataHashes: Record<string, string>; iterations: number },
  original: { dataHashes: Record<string, string> | null; iterations: number | null }) {
  assert.ok(original.dataHashes && Object.keys(original.dataHashes).length > 0);
  assert.equal(actual.iterations, original.iterations, "fresh iteration count differs");
  assert.deepEqual(actual.dataHashes, original.dataHashes, "fresh bytes differ from original generation bytes");
}

export function checkFormationObservation(row: Pick<Finish, "id" | "elapsedMs" | "iterations" | "pctPot" | "peakRssBytes"> & { status: string },
  entry: Pick<BridgeLibrarySpot, "id" | "solveMs" | "iterations" | "peakRssBytes"> & { exploitability: { pctPot: number } }) {
  assert.equal(row.status, "passed"); assert.equal(entry.id, row.id);
  assert.ok(row.elapsedMs !== null && Number.isFinite(row.elapsedMs)); assert.equal(entry.solveMs, Math.round(row.elapsedMs));
  assert.equal(entry.iterations, row.iterations); assert.equal(entry.exploitability.pctPot, row.pctPot); assert.equal(entry.peakRssBytes, row.peakRssBytes);
}

function originalEvidence() {
  const manifest = buildFormationManifest(); verifyFormationManifest(JSON.parse(readFileSync("src/lib/solver/bridge/formations/manifest.json", "utf8")));
  const expectedIdentity = { corpusHash: manifest.payloadHash, sourceHashes: formationSourceHashes(), nativeInputs: nativeInputHashes(), engineCommit: POSTFLOP_SOLVER_COMMIT };
  const environment = readHashed<{ identity: typeof expectedIdentity; identityHash: string; binaryHash: string; payloadHash: string }>(`${ORIGINAL}/environment.json`);
  assert.deepEqual(environment.identity, expectedIdentity); assert.equal(environment.identityHash, hashJson(expectedIdentity));
  const preflight = readHashed<{ identityHash: string; rows: PreflightRow[]; payloadHash: string }>(`${ORIGINAL}/preflight.json`);
  assert.equal(preflight.identityHash, environment.identityHash); assert.equal(preflight.rows.length, 36);
  preflight.rows.forEach((row, i) => {
    const root = manifest.roots[i]; assert.equal(row.id, root.id); assert.equal(row.spotHash, root.spotHash);
    assert.equal(row.command, "estimate"); assert.equal(row.threads, 1); assert.equal(row.strategyStorageAllocated, false); assert.equal(row.iterations, 0);
    assert.equal(row.status, "estimated"); assert.equal(row.error, undefined); assert.equal(typeof row.rawEstimate, "string"); assert.equal(sha256(row.rawEstimate!), row.rawHash);
    assert.ok(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 && row.elapsedMs <= 60_000);
    assert.ok(Number.isSafeInteger(row.rssSamples) && row.rssSamples >= 0 && Number.isSafeInteger(row.rssErrors) && row.rssErrors >= 0);
    assert.equal(row.sampledPeakRssBytes === null, row.rssSamples === 0);
    if (row.sampledPeakRssBytes !== null) assert.ok(Number.isSafeInteger(row.sampledPeakRssBytes) && row.sampledPeakRssBytes > 0 && row.sampledPeakRssBytes <= B.rssBytes);
    assert.ok(formationReservation(formationSpot(root.formation, root.boardId), row.rawEstimate!).admitted);
  });
  const generation = readHashed<BaseReport>(`${ORIGINAL}/generate.json`), reproduction = readHashed<BaseReport>(`${ORIGINAL}/reproduce.json`);
  assert.equal(generation.payloadHash, "f3ce16febc3894af832190f6366412632c3a3399c668ffa48f6e665be98454ad");
  assert.equal(reproduction.payloadHash, "5bf7bf86312ae9d48ce6fdf3ba238c6836347f66f900dc68bae9bc3432d5cafc");
  validatePhaseReport(generation, "generate", environment.identityHash, manifest, 0);
  validatePhaseReport(reproduction, "reproduce", environment.identityHash, manifest, generation.chargedNativeMs);
  for (const r of [generation, reproduction]) assert.equal(r.preflightHash, preflight.payloadHash);
  assert.equal(generation.previousHash, null); assert.equal(reproduction.previousHash, generation.payloadHash);
  return { manifest, environment, preflight, generation, reproduction };
}
function identity(original: ReturnType<typeof originalEvidence>) {
  return { corpusHash: original.manifest.payloadHash, originalEnvironmentHash: original.environment.payloadHash,
    originalGenerationHash: original.generation.payloadHash, originalReproductionHash: original.reproduction.payloadHash, sourceHashes: sourceHashes() };
}
type Environment = { identity: ReturnType<typeof identity>; identityHash: string; binaryHash: string;
  measuredAt: string; machine: { cpu: string; ramBytes: number; platform: string; node: string }; payloadHash: string };
function context() {
  const original = originalEvidence(), env = readHashed<Environment>(`${EVIDENCE}/environment.json`);
  assert.deepEqual(env.identity, identity(original)); assert.equal(env.identityHash, hashJson(env.identity));
  assert.equal(env.binaryHash, original.environment.binaryHash);
  return { original, env };
}
function validateReport(report: Report, c: ReturnType<typeof context>) {
  assert.equal(report.correctionRevision, 2); assert.equal(report.originalGenerationHash, c.original.generation.payloadHash);
  assert.equal(report.previousHash, c.original.reproduction.payloadHash); assert.equal(report.preflightHash, c.original.preflight.payloadHash);
  validatePhaseReport(report, "reproduce", c.env.identityHash, c.original.manifest, c.original.reproduction.chargedNativeMs);
  for (const group of report.groups) {
    const original = c.original.generation.groups.find(g => g.formation === group.formation)!;
    if (original.status !== "complete") { assert.equal(group.status, "blocked"); assert.equal(group.rows.length, 0); }
    for (const row of group.rows) {
      if (row.status === "failed") { assert.equal(row.entry, null); assert.equal(row.referee, null); continue; }
      assert.ok(row.entry); checkFormationObservation(row, row.entry);
      compareFreshFormationHashes({ dataHashes: row.dataHashes!, iterations: row.iterations! }, original.rows.find(r => r.id === row.id)!);
      assert.equal(row.diagnosticHashes, null); assert.equal(row.diagnosticResultHash, null);
    }
  }
}
function readReport(c: ReturnType<typeof context>) { const report = readHashed<Report>(`${EVIDENCE}/reproduce.json`); validateReport(report, c); return report; }
function manifestFor(group: Group, report: Report, c: ReturnType<typeof context>) {
  assert.equal(group.status, "complete"); assert.equal(group.rows.length, 12);
  const directory = existsSync(join(FORMATION_ROOT, group.formation)) ? join(FORMATION_ROOT, group.formation) : join(STAGE, group.formation);
  const files = new Map<string, string>(), prefix = `${FORMATION_URL}${group.formation}/`;
  for (const row of group.rows) for (const [url, hash] of Object.entries(row.dataHashes!)) {
    assert.ok(url.startsWith(prefix) && !url.includes("..") && !files.has(url));
    const text = readFileSync(join(directory, url.slice(prefix.length)), "utf8"); assert.equal(sha256(text), hash); files.set(url, text);
  }
  const referees = group.rows.flatMap(r => r.referee ? [r.referee] : []); assert.equal(referees.length, 1);
  const payload = { format: "poker-face-formation-library" as const, version: 1 as const, formation: group.formation,
    corpusHash: c.original.manifest.payloadHash, provenance: { label: FORMATION_LABEL, ranges: FORMATION_INPUTS.rangeProvenance, engineCommit: POSTFLOP_SOLVER_COMMIT, engineLicense: "AGPL-3.0" },
    sourceHashes: c.original.environment.identity.sourceHashes, generationRecordHash: c.original.generation.payloadHash, reproductionRecordHash: report.payloadHash,
    publication: { revision: 3 as const, sourceHashes: publicationHashes() },
    verification: { revision: 2 as const, sourceHashes: c.env.identity.sourceHashes, originalReproductionRecordHash: c.original.reproduction.payloadHash, observations: "fresh-reproduction" as const },
    quantization: { reach: REACH_SCALE, strategy: STRATEGY_SCALE, ev: EV_SCALE, equity: EQUITY_SCALE }, spots: group.rows.map(r => r.entry!), referee: referees[0], totals: fileTotals(files) };
  const manifest: Manifest = withHash(payload), text = prettyJson(manifest);
  assert.ok(Buffer.byteLength(text) <= B.fileBytes); assert.ok(manifest.totals.gzipBytes + gzipSync(text, { level: 9 }).length <= B.gzipPerFormationBytes);
  return { manifest, text, directory };
}
function publish(report: Report, c: ReturnType<typeof context>) {
  mkdirSync(FORMATION_ROOT, { recursive: true });
  for (const group of report.groups.filter(g => g.status === "complete")) {
    const built = manifestFor(group, report, c); writeOnce(join(built.directory, "manifest.json"), built.text);
    auditFormationLibrary(built.directory, group.formation);
    const destination = join(FORMATION_ROOT, group.formation);
    if (built.directory !== destination) renameSync(built.directory, destination);
    console.log(JSON.stringify({ published: group.formation, ...built.manifest.totals }));
  }
}
export function auditPublishedFormationExperiment() {
  const c = context(), report = readReport(c); let raw = 0, observationsBound = 0; const groups = [];
  for (const group of report.groups) {
    const directory = join(FORMATION_ROOT, group.formation);
    if (group.status !== "complete") { assert.ok(!existsSync(directory)); groups.push({ formation: group.formation, status: "blocked", reason: group.error }); continue; }
    const audit = auditFormationLibrary(directory, group.formation), built = manifestFor(group, report, c);
    assert.equal(readFileSync(join(directory, "manifest.json"), "utf8"), built.text); raw += audit.totals.rawBytes + Buffer.byteLength(built.text);
    for (const row of group.rows) {
      const entry = built.manifest.spots.find(e => e.id === row.id)!; checkFormationObservation(row, entry);
      const refs = [entry.spot, entry.root, ...Object.values(entry.chunks), ...(built.manifest.referee.spotId === row.id ? [built.manifest.referee.ref] : [])];
      assert.deepEqual(Object.keys(row.dataHashes!).sort(), refs.map(r => r.url).sort());
      refs.forEach(ref => assert.equal(row.dataHashes![ref.url], ref.sha256)); observationsBound++;
    }
    groups.push({ ...audit, status: "published" });
  }
  assert.ok(raw <= B.allRawBytes); assert.ok(!observationsBound || report.chargedNativeMs <= B.totalNativeMs);
  assert.deepEqual(existsSync(FORMATION_ROOT) ? readdirSync(FORMATION_ROOT).sort() : [], report.groups.filter(g => g.status === "complete").map(g => g.formation).sort());
  return { publicationRevision: 3, correctionRevision: 2, originalGenerationHash: c.original.generation.payloadHash, originalFailedReproductionHash: c.original.reproduction.payloadHash,
    correctedReproductionHash: report.payloadHash, groups, observationsBound, rawBytes: raw, chargedNativeMs: report.chargedNativeMs,
    productionRangesPromoted: false, playChanged: false };
}
function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 1 && ["--publish", "--check"].includes(args[0]));
  if (args[0] === "--publish") { const c = context(); publish(readReport(c), c); }
  console.log(JSON.stringify(auditPublishedFormationExperiment(), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e); process.exitCode = 1; }
}
