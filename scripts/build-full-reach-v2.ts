/** Frozen v2 continuation: six new roots, twelve fresh reproductions, all-or-nothing pack. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_BINARY, runBridgeSpot, type BridgeProgress } from "./bridge-runner";
import { FULL_REACH_EVIDENCE as EVIDENCE, FULL_REACH_SOURCES, fullReachScanContext } from "./measure-full-reach-v2";
import { hashes, readHashed } from "./capture-formation-export-diagnostic";
import { hashJson, prettyJson, sha256 } from "../src/lib/solver/preflop-v2/corpus";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { FORMATION_BUDGETS as B, formationSpot, formationPlan } from "../src/lib/solver/bridge/formations/fixtures";
import { formationReservation } from "../src/lib/solver/bridge/formations/library";
import { FULL_REACH_URL } from "../src/lib/solver/bridge/formations/full-reach-v2";
import { V2_DIRECTORY, V2_FORMATION, v2Roots, encodeFullReachSpot, auditFullReachLibrary, FULL_REACH_ENCODING, FULL_REACH_PROVENANCE,
  type V2Root, type FullReachEntry, type V2Referee, type FullReachManifest } from "../src/lib/solver/bridge/formations/full-reach-library-v2";
import { COMPRESSION_PROFILE, portableFileTotals, portableGzip } from "../src/lib/solver/bridge/formations/portable-compression";

const SOURCES = [...FULL_REACH_SOURCES, "src/lib/solver/bridge/formations/full-reach-library-v2.ts", "scripts/build-full-reach-v2.ts"];
const WORK = "build/formation-full-reach-v2", STAGE = `${WORK}/stage`, PREFIX = `${FULL_REACH_URL}${V2_FORMATION}/`;
interface ScanRow { id: string; source: string; sourceBytesHash: string; resultHash: string; status: string; provenance: string; elapsedMs: number; peakRssBytes: number }
interface Scan { payloadHash: string; identity: ReturnType<typeof fullReachScanContext>["identity"]; rows: ScanRow[]; passed: boolean; selectedInputBytes: number }
const withHash = <T extends object>(payload: T) => ({ ...payload, payloadHash: hashJson(payload) });
function writeNew(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, prettyJson(value), { flag: "wx" }); }
const fileHashes = (files: ReadonlyMap<string, string>) => Object.fromEntries([...files].map(([p, text]) => [p, sha256(text)]));
export function fullReachContext() {
  const prior = fullReachScanContext(), scan = readHashed<Scan>(`${EVIDENCE}/scan.json`);
  assert.deepEqual(scan.identity, prior.identity); assert.equal(scan.passed, true); assert.equal(scan.rows.length, 6);
  assert.deepEqual(scan.rows.map(r => r.id), v2Roots().slice(0, 6).map(r => r.id)); assert.ok(scan.rows.every(r => r.status === "passed"));
  const preflight = readHashed<{ payloadHash: string; rows: { id: string; rawEstimate: string; rawHash: string }[] }>("tasks/artifacts/formation-libraries-v1/preflight.json");
  for (const root of v2Roots()) {
    const row = preflight.rows.find(r => r.id === root.id)!; assert.equal(sha256(row.rawEstimate), row.rawHash);
    assert.ok(formationReservation(formationSpot(V2_FORMATION, root.boardId), row.rawEstimate).admitted);
  }
  return { scan, identity: { scanHash: scan.payloadHash, diagnosticHash: prior.observation.payloadHash,
    corpusHash: prior.identity.corpusHash, preflightHash: preflight.payloadHash, sourceHashes: hashes(SOURCES),
    binaryHash: prior.original.identity.binaryHash, priorChargedNativeMs: prior.observation.chargedNativeMs } };
}
interface Row {
  id: string; spotHash: string; planHash: string; provenance: string; resultHash: string; nativeFileHash: string;
  elapsedMs: number; peakRssBytes: number; iterations: number; pctPot: number; rawBytes: number;
  entry: FullReachEntry; referee: V2Referee | null; dataHashes: Record<string, string>;
}
interface Attempt {
  phase: "generate" | "reproduce"; id: string; startedAt: string; reservedMs: number;
  status: "passed" | "failed"; elapsedMs: number; budgetMs: number; rawFile: string | null; nativeFileHash: string | null;
  rawBytes: number | null; row: Row | null; error: string | null; lastCheckpoint: BridgeProgress | null;
}
interface Experiment {
  payloadHash: string; format: "poker-face-full-reach-experiment"; version: 2;
  identity: ReturnType<typeof fullReachContext>["identity"]; environmentHash: string;
  status: "complete" | "blocked"; error: string | null; generation: Row[]; reproduction: Row[]; attempts: Attempt[];
  chargedNativeMs: number; nativeInputBytes: number;
}
export function compareFullReachRows(generated: Row, fresh: Row) {
  for (const key of ["id", "spotHash", "planHash", "iterations", "pctPot"] as const) assert.equal(fresh[key], generated[key]);
  assert.deepEqual(fresh.dataHashes, generated.dataHashes, "fresh exported bytes differ");
  assert.deepEqual(fresh.referee, generated.referee, "fresh referee differs");
}
function rowFor(spec: V2Root, result: BridgeResultV1, provenance: string, elapsedMs: number, peakRssBytes: number, raw: Buffer) {
  const built = encodeFullReachSpot(spec, result, elapsedMs, peakRssBytes);
  const row: Row = { id: spec.id, spotHash: spec.spotHash, planHash: spec.planHash, provenance, elapsedMs, peakRssBytes,
    resultHash: hashJson(result), nativeFileHash: sha256(raw), rawBytes: raw.length, iterations: result.iterations, pctPot: result.exploitability.pctPot,
    entry: built.entry, referee: built.referee, dataHashes: fileHashes(built.files) };
  return { built, row };
}
function stageFiles(files: ReadonlyMap<string, string>) {
  for (const [url, text] of files) {
    assert.ok(url.startsWith(PREFIX) && !url.includes("..")); const path = join(STAGE, url.slice(PREFIX.length));
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, { flag: "wx" });
  }
}

async function run(signal: AbortSignal) {
  const c = fullReachContext(); assert.ok(!existsSync(`${EVIDENCE}/environment.json`) && !existsSync(V2_DIRECTORY), "no retry or overwrite");
  assert.equal(sha256(readFileSync(BRIDGE_BINARY)), c.identity.binaryHash);
  // Verify process monitoring works before creating an immutable native-attempt record.
  assert.ok(Number(execFileSync("ps", ["-o", "rss=", "-p", String(process.pid)], { encoding: "utf8" }).trim()) > 0);
  const environment = withHash({ identity: c.identity, measuredAt: new Date().toISOString(),
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    machine: { cpu: cpus()[0].model, ramBytes: totalmem(), platform: platform(), osRelease: release(), node: process.version } });
  writeNew(`${EVIDENCE}/environment.json`, environment);
  const generation: Row[] = [], reproduction: Row[] = [], attempts: Attempt[] = [];
  let chargedNativeMs = c.identity.priorChargedNativeMs, nativeInputBytes = c.scan.selectedInputBytes, error: string | null = null;
  async function solve(phase: Attempt["phase"], spec: V2Root) {
    signal.throwIfAborted(); assert.ok(chargedNativeMs + B.perSolveMs <= B.totalNativeMs, "aggregate native budget exhausted");
    const start = { phase, id: spec.id, startedAt: new Date().toISOString(), reservedMs: B.perSolveMs }, began = performance.now();
    const name = `${phase}-${spec.id}`; writeNew(`${EVIDENCE}/attempts/${name}.start.json`, start);
    let lastCheckpoint: BridgeProgress | null = null, rawFile: string | null = null, raw: Buffer | null = null;
    console.log(JSON.stringify({ starting: name, chargedNativeMs }));
    try {
      const native = await runBridgeSpot(formationSpot(V2_FORMATION, spec.boardId), { slices: formationPlan(V2_FORMATION, spec.boardId), threads: B.threads,
        timeoutMs: B.perSolveMs, rssLimitBytes: B.rssBytes, signal, onProgress: p => {
          lastCheckpoint = p; if (p.stage === "solving" && p.iteration! % 100 === 0) console.log(JSON.stringify({ id: spec.id, ...p }));
        } });
      raw = Buffer.from(JSON.stringify(native.result)); rawFile = `${WORK}/native/${name}.json`; mkdirSync(dirname(rawFile), { recursive: true });
      writeFileSync(rawFile, raw, { flag: "wx" }); nativeInputBytes += raw.length;
      assert.ok(raw.length <= B.rawResultBytes && nativeInputBytes <= B.cacheBytes, "native output/cache byte gate");
      const elapsedMs = performance.now() - began, rss = Math.max(native.sampledPeakRssBytes, native.result.memory.peakRssBytes);
      const { built, row } = rowFor(spec, native.result, `fresh-${phase}`, elapsedMs, rss, raw);
      if (phase === "generate") stageFiles(built.files); else compareFullReachRows(generation.find(r => r.id === spec.id)!, row);
      const budgetMs = performance.now() - began; assert.ok(budgetMs <= B.perSolveMs);
      const finish: Attempt = { ...start, status: "passed", elapsedMs: budgetMs, budgetMs, rawFile, nativeFileHash: sha256(raw), rawBytes: raw.length, row, error: null, lastCheckpoint };
      writeNew(`${EVIDENCE}/attempts/${name}.finish.json`, finish); attempts.push(finish); chargedNativeMs += budgetMs;
      console.log(JSON.stringify({ finished: name, iterations: row.iterations, pctPot: row.pctPot, elapsedMs, peakRssBytes: rss })); return row;
    } catch (e) {
      const elapsedMs = performance.now() - began;
      const finish: Attempt = { ...start, status: "failed", elapsedMs, budgetMs: elapsedMs, rawFile, nativeFileHash: raw ? sha256(raw) : null,
        rawBytes: raw?.length ?? null, row: null, error: String(e), lastCheckpoint };
      writeNew(`${EVIDENCE}/attempts/${name}.finish.json`, finish); attempts.push(finish); chargedNativeMs += elapsedMs; throw e;
    }
  }
  try {
    for (const [i, original] of c.scan.rows.entries()) {
      const raw = readFileSync(original.source); assert.equal(sha256(raw), original.sourceBytesHash);
      const parsed = JSON.parse(raw.toString()), result: BridgeResultV1 = i < 5 ? parsed.result : parsed;
      assert.equal(hashJson(result), original.resultHash);
      const { built, row } = rowFor(v2Roots()[i], result, `reused-${original.provenance}`, original.elapsedMs, original.peakRssBytes, raw);
      stageFiles(built.files); generation.push(row);
    }
    for (const spec of v2Roots().slice(6)) generation.push(await solve("generate", spec));
    for (const spec of v2Roots()) reproduction.push(await solve("reproduce", spec));
    assert.deepEqual(fullReachContext().identity, c.identity); assert.equal(sha256(readFileSync(BRIDGE_BINARY)), c.identity.binaryHash);
  } catch (e) { error = String(e); }
  const report: Experiment = withHash({ format: "poker-face-full-reach-experiment", version: 2, identity: c.identity,
    environmentHash: environment.payloadHash, status: error ? "blocked" : "complete", error, generation, reproduction, attempts, chargedNativeMs, nativeInputBytes });
  writeNew(`${EVIDENCE}/experiment.json`, report);
  if (error) throw new Error(error);
  publish(report); console.log(JSON.stringify(auditFullReachExperiment()));
}

function manifestFor(report: Experiment, directory: string) {
  assert.equal(report.status, "complete"); assert.equal(report.generation.length, 12); assert.equal(report.reproduction.length, 12);
  const files = new Map<string, string>();
  for (const row of report.generation) for (const [url, hash] of Object.entries(row.dataHashes)) {
    assert.ok(url.startsWith(PREFIX) && !url.includes("..") && !files.has(url));
    const text = readFileSync(join(directory, url.slice(PREFIX.length)), "utf8"); assert.equal(sha256(text), hash); files.set(url, text);
  }
  const referees = report.reproduction.flatMap(r => r.referee ? [r.referee] : []); assert.equal(referees.length, 1);
  const payload = { format: "poker-face-formation-library" as const, version: 2 as const, formation: V2_FORMATION, corpusHash: report.identity.corpusHash,
    provenance: FULL_REACH_PROVENANCE, sourceHashes: report.identity.sourceHashes, generationRecordHash: hashJson(report.generation), reproductionRecordHash: report.payloadHash,
    encoding: FULL_REACH_ENCODING, compression: COMPRESSION_PROFILE, spots: report.reproduction.map(r => r.entry), referee: referees[0], totals: portableFileTotals(files) };
  const manifest: FullReachManifest = withHash(payload), text = prettyJson(manifest);
  assert.ok(Buffer.byteLength(text) <= B.fileBytes && manifest.totals.gzipBytes + portableGzip(text).length <= B.gzipPerFormationBytes);
  return { manifest, text };
}
function publish(report: Experiment) {
  const { text } = manifestFor(report, STAGE); writeFileSync(join(STAGE, "manifest.json"), text, { flag: "wx" });
  auditFullReachLibrary(STAGE, report.identity.sourceHashes);
  mkdirSync(dirname(V2_DIRECTORY), { recursive: true }); assert.ok(!existsSync(V2_DIRECTORY)); renameSync(STAGE, V2_DIRECTORY);
}

export function auditFullReachExperiment() {
  const c = fullReachContext(), report = readHashed<Experiment>(`${EVIDENCE}/experiment.json`);
  assert.equal(report.format, "poker-face-full-reach-experiment"); assert.equal(report.version, 2); assert.deepEqual(report.identity, c.identity);
  const environment = readHashed<{ payloadHash: string; identity: typeof c.identity }>(`${EVIDENCE}/environment.json`);
  assert.equal(report.environmentHash, environment.payloadHash); assert.deepEqual(environment.identity, c.identity);
  let charged = c.identity.priorChargedNativeMs, bytes = c.scan.selectedInputBytes;
  const seen = new Set<string>();
  for (const a of report.attempts) {
    const key = `${a.phase}-${a.id}`; assert.ok(!seen.has(key)); seen.add(key);
    assert.deepEqual(JSON.parse(readFileSync(`${EVIDENCE}/attempts/${key}.start.json`, "utf8")), { phase: a.phase, id: a.id, startedAt: a.startedAt, reservedMs: B.perSolveMs });
    assert.deepEqual(JSON.parse(readFileSync(`${EVIDENCE}/attempts/${key}.finish.json`, "utf8")), a);
    assert.ok(Number.isFinite(a.elapsedMs) && a.elapsedMs >= 0 && a.budgetMs === a.elapsedMs); charged += a.budgetMs; bytes += a.rawBytes ?? 0;
    if (a.status === "passed") { assert.ok(a.row && a.error === null && a.elapsedMs <= B.perSolveMs); assert.equal(a.nativeFileHash, a.row.nativeFileHash); }
    else { assert.equal(a.status, "failed"); assert.ok(a.error && !a.row); }
  }
  nearNumber(charged, report.chargedNativeMs); assert.equal(bytes, report.nativeInputBytes);
  assert.ok(charged <= B.totalNativeMs && bytes <= B.cacheBytes);
  if (report.status === "blocked") { assert.ok(report.error && !existsSync(V2_DIRECTORY)); return { status: report.status, error: report.error, chargedNativeMs: charged }; }
  assert.equal(report.status, "complete"); assert.equal(report.error, null); assert.equal(report.attempts.length, 18); assert.ok(report.attempts.every(a => a.status === "passed"));
  const roots = v2Roots(); assert.deepEqual(report.generation.map(r => r.id), roots.map(r => r.id)); assert.deepEqual(report.reproduction.map(r => r.id), roots.map(r => r.id));
  report.generation.forEach((row, i) => {
    compareFullReachRows(row, report.reproduction[i]);
    if (i < 6) { assert.equal(row.resultHash, c.scan.rows[i].resultHash); assert.equal(row.nativeFileHash, c.scan.rows[i].sourceBytesHash); }
    else assert.deepEqual(row, report.attempts.find(a => a.phase === "generate" && a.id === row.id)!.row);
    assert.deepEqual(report.reproduction[i], report.attempts.find(a => a.phase === "reproduce" && a.id === row.id)!.row);
    const fresh = report.reproduction[i], refs = [fresh.entry.spot, fresh.entry.root, ...fresh.entry.chunks, ...(fresh.referee ? [fresh.referee.ref] : [])];
    assert.deepEqual(Object.keys(fresh.dataHashes).sort(), refs.map(r => r.url).sort()); refs.forEach(r => assert.equal(fresh.dataHashes[r.url], r.sha256));
    assert.equal(fresh.entry.iterations, fresh.iterations); assert.equal(fresh.entry.solveMs, Math.round(fresh.elapsedMs)); assert.equal(fresh.entry.peakRssBytes, fresh.peakRssBytes); assert.equal(fresh.entry.exploitability.pctPot, fresh.pctPot);
  });
  const built = manifestFor(report, V2_DIRECTORY); assert.equal(readFileSync(join(V2_DIRECTORY, "manifest.json"), "utf8"), built.text);
  return { status: "published", reportHash: report.payloadHash, chargedNativeMs: charged, nativeInputBytes: bytes,
    ...auditFullReachLibrary(V2_DIRECTORY, c.identity.sourceHashes), productionRangesPromoted: false, playChanged: false };
}
function nearNumber(a: number, b: number) { assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6); }
async function main() {
  const mode = process.argv.slice(2); assert.ok(mode.length === 1 && ["--run", "--check"].includes(mode[0]));
  if (mode[0] === "--check") { console.log(JSON.stringify(auditFullReachExperiment())); return; }
  const controller = new AbortController(), cancel = () => controller.abort(); process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try { await run(controller.signal); } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
