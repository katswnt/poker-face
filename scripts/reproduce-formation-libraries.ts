/** Corrected fresh-byte comparator. Original experiment sources and observations stay frozen. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { BRIDGE_BINARY, runBridgeSpot, type BridgeProgress } from "./bridge-runner";
import { nativeInputHashes } from "./measure-preflop-v2-research";
import { replayAttemptStatus, validatePhaseReport } from "./build-formation-libraries";
import { hashJson, prettyJson, sha256 } from "../src/lib/solver/preflop-v2/corpus";
import type { PreflightRow } from "../src/lib/solver/preflop-v2/preflight";
import { POSTFLOP_SOLVER_COMMIT } from "../src/lib/solver/bridge/contract";
import { REACH_SCALE, STRATEGY_SCALE, EV_SCALE, EQUITY_SCALE, type BridgeLibrarySpot } from "../src/lib/solver/bridge/library/model";
import { FORMATION_BUDGETS as B, FORMATION_ROOT, FORMATION_URL, FORMATION_INPUTS, buildFormationManifest,
  verifyFormationManifest, formationSpot, formationBoard, formationPlan } from "../src/lib/solver/bridge/formations/fixtures";
import { auditFormationLibrary, encodeFormationSpot, fileTotals, formationReservation, formationSourceHashes,
  FORMATION_LABEL, type FormationLibraryManifest, type FormationReferee } from "../src/lib/solver/bridge/formations/library";

const ORIGINAL = "tasks/artifacts/formation-libraries-v1", EVIDENCE = `${ORIGINAL}/reproduction-v2`;
const WORK = "build/formation-reproduction-v2", JOURNAL = `${WORK}/attempts`, STAGE = `${WORK}/data`;
const SOURCES = ["scripts/reproduce-formation-libraries.ts", "scripts/audit-formation-release.ts", `${EVIDENCE}/contract.md`];
type BaseReport = Parameters<typeof validatePhaseReport>[0];
type Start = Parameters<typeof replayAttemptStatus>[0];
type Finish = ReturnType<typeof replayAttemptStatus>;
type Root = ReturnType<typeof buildFormationManifest>["roots"][number];
type Fresh = Finish & { entry: BridgeLibrarySpot | null; referee: FormationReferee | null;
  diagnosticHashes: Record<string, string> | null; diagnosticResultHash: string | null };
interface Group { formation: string; status: "complete" | "blocked"; error: string | null; rows: Fresh[] }
type Report = Omit<BaseReport, "groups"> & { correctionRevision: 2; originalGenerationHash: string; groups: Group[] };
type Manifest = FormationLibraryManifest & { verification: { revision: 2; sourceHashes: Record<string, string>;
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
function writeNew(path: string, value: unknown) { assert.ok(!existsSync(path), "record already frozen"); writeOnce(path, prettyJson(value)); }
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
function context(requireBinary = false) {
  const original = originalEvidence(), env = readHashed<Environment>(`${EVIDENCE}/environment.json`);
  assert.deepEqual(env.identity, identity(original)); assert.equal(env.identityHash, hashJson(env.identity));
  assert.equal(env.binaryHash, original.environment.binaryHash);
  if (requireBinary) assert.equal(sha256(readFileSync(BRIDGE_BINARY)), env.binaryHash);
  return { original, env };
}
function prepare() {
  const o = originalEvidence(); assert.equal(sha256(readFileSync(BRIDGE_BINARY)), o.environment.binaryHash);
  if (!existsSync(`${EVIDENCE}/environment.json`)) writeNew(`${EVIDENCE}/environment.json`, withHash({ identity: identity(o), identityHash: hashJson(identity(o)),
    binaryHash: o.environment.binaryHash, measuredAt: new Date().toISOString(),
    machine: { cpu: cpus()[0].model, ramBytes: totalmem(), platform: platform(), node: process.version } }));
  return context(true);
}
const key = (root: Root) => `${JOURNAL}/${root.spotHash}`;
function replay(root: Root, env: Environment): Fresh | null {
  if (!existsSync(`${key(root)}.start.json`)) return null;
  const start: Start = JSON.parse(readFileSync(`${key(root)}.start.json`, "utf8"));
  assert.equal(start.id, root.id); assert.equal(start.spotHash, root.spotHash); assert.equal(start.planHash, root.planHash);
  const end = `${key(root)}.finish.json`;
  if (existsSync(end)) { const row: Fresh = JSON.parse(readFileSync(end, "utf8")); replayAttemptStatus(start, row, env.identityHash); return row; }
  return { ...replayAttemptStatus(start, null, env.identityHash), entry: null, referee: null, diagnosticHashes: null, diagnosticResultHash: null };
}
function charged(c: ReturnType<typeof context>) {
  let sum = c.original.reproduction.chargedNativeMs;
  for (const root of c.original.manifest.roots) sum += replay(root, c.env)?.budgetMs ?? 0;
  return sum;
}
const fileHashes = (files: ReadonlyMap<string, string>) => Object.fromEntries([...files].map(([url, text]) => [url, sha256(text)]));
function stagedBytes() {
  return existsSync(STAGE) ? readdirSync(STAGE, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).reduce((sum, e) => sum + statSync(join(e.parentPath, e.name)).size, 0) : 0;
}
async function attempt(root: Root, c: ReturnType<typeof context>, signal: AbortSignal): Promise<Fresh> {
  const previous = replay(root, c.env); if (previous) return previous;
  const remaining = Math.floor(B.totalNativeMs - charged(c)); assert.ok(remaining > 0, "original eight-hour budget exhausted");
  const start: Start = { phase: "reproduce", id: root.id, spotHash: root.spotHash, planHash: root.planHash, identityHash: c.env.identityHash, startedAt: new Date().toISOString() };
  writeNew(`${key(root)}.start.json`, start); const began = performance.now(); let lastCheckpoint: BridgeProgress | null = null;
  let diagnosticHashes: Record<string, string> | null = null, diagnosticResultHash: string | null = null, row: Fresh;
  try {
    console.log(JSON.stringify({ starting: root.id, correctionRevision: 2 }));
    const run = await runBridgeSpot(formationSpot(root.formation, root.boardId), { threads: 8, slices: formationPlan(root.formation, root.boardId),
      rssLimitBytes: B.rssBytes, timeoutMs: Math.min(B.perSolveMs, remaining), signal, onProgress: p => {
        if (p.stage === "solving") { lastCheckpoint = p; if (p.iteration! % 50 === 0) console.log(JSON.stringify({ id: root.id, ...p })); }
      } });
    const elapsedMs = performance.now() - began, rss = Math.max(run.sampledPeakRssBytes, run.result.memory.peakRssBytes);
    assert.ok(elapsedMs <= Math.min(B.perSolveMs, remaining), "native wall budget exceeded including export");
    assert.ok(Buffer.byteLength(JSON.stringify(run.result)) <= B.rawResultBytes);
    const built = encodeFormationSpot(root.formation, formationBoard(root.formation, root.boardId), formationSpot(root.formation, root.boardId),
      formationPlan(root.formation, root.boardId), run.result, elapsedMs, rss);
    diagnosticHashes = fileHashes(built.files); diagnosticResultHash = hashJson(run.result);
    const original = c.original.generation.groups.find(g => g.formation === root.formation)!.rows.find(r => r.id === root.id)!;
    compareFreshFormationHashes({ dataHashes: diagnosticHashes, iterations: run.result.iterations }, original);
    assert.ok(stagedBytes() + fileTotals(built.files).rawBytes <= B.allRawBytes, "staged publication data exceeds 512 MiB");
    const prefix = `${FORMATION_URL}${root.formation}/`;
    for (const [url, text] of built.files) { assert.ok(url.startsWith(prefix) && !url.includes("..")); writeOnce(join(STAGE, root.formation, url.slice(prefix.length)), text); }
    row = { ...start, status: "passed", elapsedMs, budgetMs: elapsedMs, resultHash: diagnosticResultHash, dataHashes: diagnosticHashes,
      peakRssBytes: rss, iterations: run.result.iterations, pctPot: run.result.exploitability.pctPot, lastCheckpoint,
      entry: built.entry, referee: built.referee, diagnosticHashes: null, diagnosticResultHash: null };
  } catch (error) {
    const elapsedMs = performance.now() - began;
    row = { ...start, status: "failed", error: String(error), elapsedMs, budgetMs: elapsedMs, resultHash: null, dataHashes: null,
      peakRssBytes: null, iterations: null, pctPot: null, lastCheckpoint, entry: null, referee: null, diagnosticHashes, diagnosticResultHash };
  }
  replayAttemptStatus(start, row, c.env.identityHash); writeNew(`${key(root)}.finish.json`, row);
  console.log(JSON.stringify({ id: row.id, status: row.status, iterations: row.iterations, pctPot: row.pctPot, elapsedMs: row.elapsedMs, error: row.error })); return row;
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
async function reproduce(signal: AbortSignal) {
  const c = prepare(); if (existsSync(`${EVIDENCE}/reproduce.json`)) { publish(readReport(c), c); return; }
  const groups: Group[] = [];
  for (const original of c.original.generation.groups) {
    const rows: Fresh[] = []; let error: string | null = original.status === "complete" ? null : "original generation gate failed; no corrected retry or publication";
    if (!error) for (const root of c.original.manifest.roots.filter(r => r.formation === original.formation)) {
      if (signal.aborted) throw new Error("cancelled; original and corrected attempts retained");
      if (charged(c) >= B.totalNativeMs) { error = "original eight-hour native budget exhausted"; break; }
      const row = await attempt(root, c, signal); rows.push(row); if (row.status === "failed") { error = row.error!; break; }
    }
    groups.push({ formation: original.formation, status: error ? "blocked" : "complete", error, rows });
  }
  context(true);
  const make = (): Report => withHash({ format: "poker-face-formation-experiment" as const, version: 1 as const, phase: "reproduce" as const,
    correctionRevision: 2 as const, originalGenerationHash: c.original.generation.payloadHash, identityHash: c.env.identityHash,
    preflightHash: c.original.preflight.payloadHash, previousHash: c.original.reproduction.payloadHash, groups,
    chargedNativeMs: groups.reduce((sum, g) => g.rows.reduce((n, r) => n + r.budgetMs, sum), c.original.reproduction.chargedNativeMs) });
  let report = make(), changed: boolean;
  do {
    changed = false; let bytes = 0;
    for (const group of groups.filter(g => g.status === "complete")) try {
      const built = manifestFor(group, report, c), next = bytes + built.manifest.totals.rawBytes + Buffer.byteLength(built.text);
      assert.ok(next <= B.allRawBytes && report.chargedNativeMs <= B.totalNativeMs); bytes = next;
    } catch (e) { group.status = "blocked"; group.error = `publication gate: ${e}`; changed = true; }
    if (changed) report = make();
  } while (changed);
  validateReport(report, c); writeNew(`${EVIDENCE}/reproduce.json`, report); publish(report, c);
  console.log(JSON.stringify({ chargedNativeMs: report.chargedNativeMs, groups: groups.map(g => ({ formation: g.formation, status: g.status, attempted: g.rows.length, error: g.error })) }));
}

export function auditCorrectedFormationExperiment() {
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
  return { correctionRevision: 2, originalGenerationHash: c.original.generation.payloadHash, originalFailedReproductionHash: c.original.reproduction.payloadHash,
    correctedReproductionHash: report.payloadHash, groups, observationsBound, rawBytes: raw, chargedNativeMs: report.chargedNativeMs,
    productionRangesPromoted: false, playChanged: false };
}
async function main() {
  assert.deepEqual(process.argv.slice(2), ["--reproduce"]);
  const controller = new AbortController(), cancel = () => controller.abort(); process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try { await reproduce(controller.signal); } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
