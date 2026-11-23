/** Frozen formation experiment. One native solve at a time; immutable attempts and cache. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { BRIDGE_BINARY, runBridgeSpot, type BridgeProgress } from "./bridge-runner";
import { nativeInputHashes } from "./measure-preflop-v2-research";
import { measurePreflight, type PreflightRow } from "../src/lib/solver/preflop-v2/preflight";
import { hashJson, prettyJson, sha256 } from "../src/lib/solver/preflop-v2/corpus";
import { POSTFLOP_SOLVER_COMMIT, type BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { REACH_SCALE, STRATEGY_SCALE, EV_SCALE, EQUITY_SCALE } from "../src/lib/solver/bridge/library/model";
import { FORMATION_INPUTS, FORMATION_BUDGETS as B, FORMATION_ROOT, FORMATION_URL, buildFormationManifest,
  verifyFormationManifest, formationSpot, formationPlan, formationBoard, type FormationCorpus } from "../src/lib/solver/bridge/formations/fixtures";
import { auditFormationLibrary, checkFormationResult, encodeFormationSpot, fileTotals, FORMATION_LABEL, formationReservation,
  formationSourceHashes, type FormationLibraryManifest } from "../src/lib/solver/bridge/formations/library";

const CORPUS = "src/lib/solver/bridge/formations/manifest.json", EVIDENCE = "tasks/artifacts/formation-libraries-v1";
const WORK = "build/formation-libraries-v1", CACHE = `${WORK}/cache`, JOURNAL = `${WORK}/attempts`;
type Phase = "generate" | "reproduce";
interface Start { phase: Phase; id: string; spotHash: string; planHash: string; identityHash: string; startedAt: string }
interface Finish extends Start {
  status: "passed" | "failed"; error?: string; elapsedMs: number | null; budgetMs: number;
  resultHash: string | null; dataHashes: Record<string, string> | null; peakRssBytes: number | null;
  iterations: number | null; pctPot: number | null; lastCheckpoint: BridgeProgress | null;
}
interface Group { formation: string; status: "complete" | "blocked"; error: string | null; rows: Finish[] }
function withHash<T extends object>(payload: T) { return { ...payload, payloadHash: hashJson(payload) }; }
function writeNew(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, prettyJson(value), { flag: "wx" }); }
function readHashed<T extends { payloadHash: string }>(path: string): T {
  const bytes = readFileSync(path, "utf8"), value: T = JSON.parse(bytes), { payloadHash, ...payload } = value;
  assert.equal(payloadHash, hashJson(payload)); assert.equal(bytes, prettyJson(value)); return value;
}
function corpus(): FormationCorpus { const value: unknown = JSON.parse(readFileSync(CORPUS, "utf8")); verifyFormationManifest(value); return value; }
function currentIdentity() { return { corpusHash: corpus().payloadHash, sourceHashes: formationSourceHashes(), nativeInputs: nativeInputHashes(), engineCommit: POSTFLOP_SOLVER_COMMIT }; }
type Identity = ReturnType<typeof currentIdentity>;
interface Environment { identity: Identity; identityHash: string; binaryHash: string; measuredAt: string; baseCommit: string;
  machine: { cpu: string; ramBytes: number; platform: string; osRelease: string; node: string }; payloadHash: string }
function environment(requireBinary = false): Environment {
  const saved = readHashed<Environment>(`${EVIDENCE}/environment.json`);
  assert.deepEqual(saved.identity, currentIdentity()); assert.equal(saved.identityHash, hashJson(saved.identity));
  if (requireBinary) assert.equal(saved.binaryHash, sha256(readFileSync(BRIDGE_BINARY))); return saved;
}
function ensureEnvironment() {
  if (!existsSync(`${EVIDENCE}/environment.json`)) writeNew(`${EVIDENCE}/environment.json`, withHash({ identity: currentIdentity(), identityHash: hashJson(currentIdentity()),
    binaryHash: sha256(readFileSync(BRIDGE_BINARY)), measuredAt: new Date().toISOString(),
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    machine: { cpu: cpus()[0].model, ramBytes: totalmem(), platform: platform(), osRelease: release(), node: process.version } }));
  return environment(true);
}

/** An interrupted attempt is charged its full reserved time and cannot silently restart. */
export function replayAttemptStatus(start: Start, finish: Finish | null, identityHash: string): Finish {
  assert.equal(start.identityHash, identityHash);
  assert.ok(Number.isFinite(Date.parse(start.startedAt)));
  if (!finish) return { ...start, status: "failed", error: "interrupted attempt; outcome unknown; not retried", elapsedMs: null,
    budgetMs: B.perSolveMs, resultHash: null, dataHashes: null, peakRssBytes: null, iterations: null, pctPot: null, lastCheckpoint: null };
  for (const k of ["phase", "id", "spotHash", "planHash", "identityHash", "startedAt"] as const) assert.equal(finish[k], start[k]);
  assert.ok(finish.elapsedMs !== null && Number.isFinite(finish.elapsedMs) && finish.elapsedMs >= 0);
  assert.equal(finish.budgetMs, finish.elapsedMs);
  if (finish.status === "passed") {
    assert.equal(finish.error, undefined); assert.ok(finish.elapsedMs <= B.perSolveMs);
    assert.ok(finish.peakRssBytes !== null && finish.peakRssBytes > 0 && finish.peakRssBytes <= B.rssBytes);
    assert.ok(finish.iterations !== null && Number.isInteger(finish.iterations) && finish.iterations > 0 && finish.iterations <= B.iterations);
    assert.ok(finish.pctPot !== null && finish.pctPot >= 0 && finish.pctPot <= B.gatePctPot);
    assert.match(finish.resultHash!, /^[0-9a-f]{64}$/); assert.ok(finish.dataHashes && Object.keys(finish.dataHashes).length > 0);
    Object.values(finish.dataHashes).forEach(h => assert.match(h, /^[0-9a-f]{64}$/));
  } else { assert.equal(finish.status, "failed"); assert.ok(finish.error);
    for (const key of ["resultHash", "dataHashes", "peakRssBytes", "iterations", "pctPot"] as const) assert.equal(finish[key], null);
  }
  return finish;
}
const attemptKey = (phase: Phase, hash: string) => `${JOURNAL}/${phase}-${hash}`;
function chargedNativeMs(identityHash: string) {
  if (!existsSync(JOURNAL)) return 0;
  return readdirSync(JOURNAL).filter(n => n.endsWith(".start.json")).reduce((sum, name) => {
    const start: Start = JSON.parse(readFileSync(join(JOURNAL, name), "utf8")), end = join(JOURNAL, name.replace(".start.json", ".finish.json"));
    return sum + replayAttemptStatus(start, existsSync(end) ? JSON.parse(readFileSync(end, "utf8")) : null, identityHash).budgetMs;
  }, 0);
}
function cacheBytes() { return existsSync(CACHE) ? readdirSync(CACHE).reduce((sum, n) => sum + statSync(join(CACHE, n)).size, 0) : 0; }
interface Cached { identityHash: string; spotHash: string; planHash: string; result: BridgeResultV1; resultHash: string; elapsedMs: number; peakRssBytes: number; payloadHash: string }
function cached(root: FormationCorpus["roots"][number], env: Environment) {
  const c = readHashed<Cached>(`${CACHE}/${root.spotHash}.json`);
  assert.equal(c.identityHash, env.identityHash); assert.equal(c.spotHash, root.spotHash); assert.equal(c.planHash, root.planHash);
  assert.equal(c.resultHash, hashJson(c.result)); checkFormationResult(formationSpot(root.formation, root.boardId), formationPlan(root.formation, root.boardId), c.result); return c;
}
function encode(root: FormationCorpus["roots"][number], result: BridgeResultV1, elapsedMs: number, rss: number) {
  return encodeFormationSpot(root.formation, formationBoard(root.formation, root.boardId), formationSpot(root.formation, root.boardId), formationPlan(root.formation, root.boardId), result, elapsedMs, rss);
}
const dataHashes = (files: ReadonlyMap<string, string>) => Object.fromEntries([...files].map(([name, text]) => [name, sha256(text)]));
async function attempt(phase: Phase, root: FormationCorpus["roots"][number], env: Environment, signal: AbortSignal): Promise<Finish> {
  const key = attemptKey(phase, root.spotHash);
  if (existsSync(`${key}.start.json`)) return replayAttemptStatus(JSON.parse(readFileSync(`${key}.start.json`, "utf8")),
    existsSync(`${key}.finish.json`) ? JSON.parse(readFileSync(`${key}.finish.json`, "utf8")) : null, env.identityHash);
  const remaining = Math.floor(B.totalNativeMs - chargedNativeMs(env.identityHash)); assert.ok(remaining > 0, "eight-hour native budget exhausted");
  const start: Start = { phase, id: root.id, spotHash: root.spotHash, planHash: root.planHash, identityHash: env.identityHash, startedAt: new Date().toISOString() };
  writeNew(`${key}.start.json`, start); const began = performance.now(); let lastCheckpoint: BridgeProgress | null = null;
  let done: Finish;
  try {
    console.log(JSON.stringify({ phase, starting: root.id }));
    const run = await runBridgeSpot(formationSpot(root.formation, root.boardId), { slices: formationPlan(root.formation, root.boardId), threads: 8,
      rssLimitBytes: B.rssBytes, timeoutMs: Math.min(B.perSolveMs, remaining), signal, onProgress: p => {
        if (p.stage === "solving") { lastCheckpoint = p; if (p.iteration! % 50 === 0) console.log(JSON.stringify({ id: root.id, ...p })); }
      } });
    const elapsedMs = performance.now() - began, rss = Math.max(run.sampledPeakRssBytes, run.result.memory.peakRssBytes);
    assert.ok(elapsedMs <= Math.min(B.perSolveMs, remaining), "wall budget exceeded including export");
    const built = encode(root, run.result, elapsedMs, rss), hashes = dataHashes(built.files), resultHash = hashJson(run.result);
    assert.ok(Buffer.byteLength(JSON.stringify(run.result)) <= B.rawResultBytes, "native result exceeds 64 MiB");
    if (phase === "generate") {
      const value = withHash({ identityHash: env.identityHash, spotHash: root.spotHash, planHash: root.planHash,
        result: run.result, resultHash, elapsedMs, peakRssBytes: rss });
      assert.ok(cacheBytes() + Buffer.byteLength(prettyJson(value)) <= B.cacheBytes, "native cache exceeds 1 GiB");
      writeNew(`${CACHE}/${root.spotHash}.json`, value);
    } else {
      const original = cached(root, env), old = encode(root, original.result, original.elapsedMs, original.peakRssBytes);
      assert.equal(run.result.iterations, original.result.iterations, "iteration count changed on fresh reproduction");
      assert.deepEqual(hashes, dataHashes(old.files), "fresh native data did not reproduce byte for byte");
    }
    done = { ...start, status: "passed", elapsedMs, budgetMs: elapsedMs, resultHash, dataHashes: hashes, peakRssBytes: rss,
      iterations: run.result.iterations, pctPot: run.result.exploitability.pctPot, lastCheckpoint };
  } catch (error) {
    const elapsedMs = performance.now() - began;
    done = { ...start, status: "failed", error: String(error), elapsedMs, budgetMs: elapsedMs, resultHash: null, dataHashes: null,
      peakRssBytes: null, iterations: null, pctPot: null, lastCheckpoint };
  }
  replayAttemptStatus(start, done, env.identityHash); writeNew(`${key}.finish.json`, done);
  console.log(JSON.stringify({ ...done, dataHashes: done.dataHashes ? "saved in evidence" : null })); return done;
}

interface Preflights { identityHash: string; rows: PreflightRow[]; payloadHash: string }
function readPreflights(env: Environment) {
  const r = readHashed<Preflights>(`${EVIDENCE}/preflight.json`); assert.equal(r.identityHash, env.identityHash);
  const m = corpus(); assert.equal(r.rows.length, 36);
  r.rows.forEach((row, i) => {
    assert.equal(row.id, m.roots[i].id); assert.equal(row.spotHash, m.roots[i].spotHash);
    assert.equal(row.command, "estimate"); assert.equal(row.strategyStorageAllocated, false); assert.equal(row.iterations, 0); assert.equal(row.threads, 1);
    assert.ok(row.elapsedMs >= 0 && Number.isFinite(row.elapsedMs)); assert.equal(row.sampledPeakRssBytes === null, row.rssSamples === 0);
    assert.ok(Number.isSafeInteger(row.rssSamples) && row.rssSamples >= 0 && Number.isSafeInteger(row.rssErrors) && row.rssErrors >= 0);
    if (row.sampledPeakRssBytes !== null) assert.ok(Number.isSafeInteger(row.sampledPeakRssBytes) && row.sampledPeakRssBytes > 0);
    if (row.status === "estimated") { assert.ok(row.elapsedMs <= 60_000); assert.equal(row.error, undefined);
      assert.ok(row.sampledPeakRssBytes === null || row.sampledPeakRssBytes <= B.rssBytes);
      assert.equal(typeof row.rawEstimate, "string"); assert.equal(sha256(row.rawEstimate!), row.rawHash); formationReservation(formationSpot(m.roots[i].formation, m.roots[i].boardId), row.rawEstimate!); }
    else { assert.equal(row.status, "error"); assert.ok(row.error); assert.equal(row.rawEstimate, null); assert.equal(row.rawHash, null); }
  }); return r;
}
async function estimate() {
  const env = ensureEnvironment(), rows: PreflightRow[] = [];
  assert.ok(!existsSync(`${EVIDENCE}/preflight.json`), "preflights already frozen");
  for (const root of corpus().roots) {
    const path = `${WORK}/estimates/${root.spotHash}.json`, spot = formationSpot(root.formation, root.boardId);
    const row: PreflightRow = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : await measurePreflight(spot);
    if (!existsSync(path)) writeNew(path, row); rows.push(row);
    console.log(JSON.stringify({ id: root.id, status: row.status, ...(row.rawEstimate ? formationReservation(spot, row.rawEstimate) : { error: row.error }) }));
  }
  environment(true); writeNew(`${EVIDENCE}/preflight.json`, withHash({ identityHash: env.identityHash, rows })); readPreflights(env);
}
interface PhaseReport { format: "poker-face-formation-experiment"; version: 1; phase: Phase; identityHash: string; preflightHash: string;
  previousHash: string | null; groups: Group[]; chargedNativeMs: number; payloadHash: string }
function readPhase(phase: Phase, env: Environment) {
  const r = readHashed<PhaseReport>(`${EVIDENCE}/${phase}.json`);
  validatePhaseReport(r, phase, env.identityHash, corpus(), phase === "reproduce" ? readPhase("generate", env).chargedNativeMs : 0); return r;
}
export function validatePhaseReport(r: PhaseReport, phase: Phase, identityHash: string, m: FormationCorpus, priorMs: number) {
  assert.equal(r.phase, phase); assert.equal(r.identityHash, identityHash);
  assert.equal(r.format, "poker-face-formation-experiment"); assert.equal(r.version, 1); assert.ok(r.chargedNativeMs >= 0 && Number.isFinite(r.chargedNativeMs));
  assert.deepEqual(r.groups.map(g => g.formation), FORMATION_INPUTS.formations.map(f => f.id));
  let charged = priorMs;
  for (const g of r.groups) {
    const required = m.roots.filter(x => x.formation === g.formation); assert.ok(g.rows.length <= 12);
    for (const [i, row] of g.rows.entries()) { assert.equal(row.id, required[i].id); assert.equal(row.spotHash, required[i].spotHash); assert.equal(row.planHash, required[i].planHash);
      assert.equal(row.phase, phase); assert.equal(row.identityHash, identityHash);
      if (row.elapsedMs !== null) replayAttemptStatus(row, row, identityHash);
      else { assert.deepEqual(row, replayAttemptStatus(row, null, identityHash)); }
      charged += row.budgetMs;
      if (row.status === "failed") assert.equal(i, g.rows.length - 1);
    }
    if (g.status === "complete") { assert.equal(g.error, null); assert.equal(g.rows.length, 12); assert.ok(g.rows.every(row => row.status === "passed")); }
    else { assert.equal(g.status, "blocked"); assert.ok(g.error); }
  } assert.equal(r.chargedNativeMs, charged, "cumulative native time must include every recorded attempt");
}
function pack(formation: string, env: Environment, genHash: string, reproHash: string) {
  const allFiles = new Map<string, string>(), spots: FormationLibraryManifest["spots"] = []; let referee: FormationLibraryManifest["referee"] | null = null;
  for (const root of corpus().roots.filter(r => r.formation === formation)) {
    const c = cached(root, env), built = encode(root, c.result, c.elapsedMs, c.peakRssBytes); spots.push(built.entry);
    for (const [p, text] of built.files) { assert.ok(!allFiles.has(p)); allFiles.set(p, text); }
    if (built.referee) { assert.equal(referee, null); referee = built.referee; }
  }
  assert.ok(referee); const payload = { format: "poker-face-formation-library" as const, version: 1 as const, formation,
    corpusHash: env.identity.corpusHash, provenance: { label: FORMATION_LABEL, ranges: FORMATION_INPUTS.rangeProvenance, engineCommit: POSTFLOP_SOLVER_COMMIT, engineLicense: "AGPL-3.0" },
    sourceHashes: env.identity.sourceHashes, generationRecordHash: genHash, reproductionRecordHash: reproHash,
    quantization: { reach: REACH_SCALE, strategy: STRATEGY_SCALE, ev: EV_SCALE, equity: EQUITY_SCALE }, spots, referee, totals: fileTotals(allFiles) };
  const manifest = withHash(payload), text = prettyJson(manifest);
  assert.ok(Buffer.byteLength(text) <= B.fileBytes); assert.ok(manifest.totals.gzipBytes + gzipSync(text, { level: 9 }).length <= B.gzipPerFormationBytes, "formation exceeds 40 MiB gzip");
  return { files: allFiles, manifest, text };
}
async function phaseRun(phase: Phase, signal: AbortSignal) {
  const env = environment(true), p = readPreflights(env), m = corpus(), previous = phase === "reproduce" ? readPhase("generate", env) : null;
  const path = `${EVIDENCE}/${phase}.json`;
  if (existsSync(path)) { readPhase(phase, env); if (phase === "reproduce") publish(env); return; }
  const groups: Group[] = [];
  for (const f of FORMATION_INPUTS.formations) {
    const roots = m.roots.filter(r => r.formation === f.id), rows: Finish[] = []; let error: string | null = null;
    const allowed = roots.every(root => { const row = p.rows[m.roots.indexOf(root)]; return row.status === "estimated" && formationReservation(formationSpot(root.formation, root.boardId), row.rawEstimate!).admitted; });
    if (!allowed) error = "required formation preflight did not pass; no strategy allocation";
    else if (previous && previous.groups.find(g => g.formation === f.id)!.status !== "complete") error = "generation gate blocked this formation; no reproduction";
    if (!error) for (const root of roots) {
      if (signal.aborted) throw new Error("cancelled; completed attempts remain immutable");
      if (chargedNativeMs(env.identityHash) >= B.totalNativeMs) { error = "eight-hour native budget exhausted"; break; }
      const row = await attempt(phase, root, env, signal); rows.push(row);
      if (row.status === "failed") { error = row.error!; break; }
    }
    groups.push({ formation: f.id, status: error ? "blocked" : "complete", error, rows });
  }
  environment(true);
  const makeReport = () => withHash({ format: "poker-face-formation-experiment" as const, version: 1 as const, phase,
    identityHash: env.identityHash, preflightHash: p.payloadHash, previousHash: previous?.payloadHash ?? null, groups, chargedNativeMs: chargedNativeMs(env.identityHash) });
  let report = makeReport();
  if (phase === "reproduce") {
    // Before publication, include the actual final manifest in each byte/gzip gate.
    let changed: boolean;
    do {
      changed = false; let raw = 0;
      for (const g of groups.filter(g => g.status === "complete")) try {
        const built = pack(g.formation, env, previous!.payloadHash, report.payloadHash);
        const nextRaw = raw + built.manifest.totals.rawBytes + Buffer.byteLength(built.text);
        assert.ok(nextRaw <= B.allRawBytes, "combined published raw bytes exceed 512 MiB"); raw = nextRaw;
      } catch (e) { g.status = "blocked"; g.error = `publication gate: ${e}`; changed = true; }
      if (changed) report = makeReport();
    } while (changed);
  }
  writeNew(path, report); readPhase(phase, env); if (phase === "reproduce") publish(env);
  console.log(JSON.stringify({ phase, chargedNativeMs: report.chargedNativeMs, groups: groups.map(g => ({ formation: g.formation, status: g.status, attempted: g.rows.length, error: g.error })) }));
}
function publish(env: Environment) {
  const gen = readPhase("generate", env), repro = readPhase("reproduce", env); mkdirSync(FORMATION_ROOT, { recursive: true });
  for (const group of repro.groups.filter(g => g.status === "complete")) {
    const out = join(FORMATION_ROOT, group.formation);
    if (existsSync(out)) { auditFormationLibrary(out, group.formation); continue; }
    const built = pack(group.formation, env, gen.payloadHash, repro.payloadHash), stage = mkdtempSync(join(FORMATION_ROOT, ".staging-"));
    try {
      for (const [url, text] of built.files) { const path = join(stage, url.slice(`${FORMATION_URL}${group.formation}/`.length)); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, { flag: "wx" }); }
      writeFileSync(join(stage, "manifest.json"), built.text, { flag: "wx" }); auditFormationLibrary(stage, group.formation); renameSync(stage, out);
    } finally { if (existsSync(stage)) rmSync(stage, { recursive: true, force: true }); }
    console.log(JSON.stringify({ published: group.formation, ...built.manifest.totals, payloadHash: built.manifest.payloadHash }));
  }
}
export function auditFormationExperiment() {
  const env = environment(), p = readPreflights(env), gen = readPhase("generate", env), repro = readPhase("reproduce", env);
  assert.equal(gen.preflightHash, p.payloadHash); assert.equal(repro.preflightHash, p.payloadHash); assert.equal(gen.previousHash, null); assert.equal(repro.previousHash, gen.payloadHash);
  let raw = 0; const summaries = [];
  for (const group of repro.groups) {
    const dir = join(FORMATION_ROOT, group.formation), generated = gen.groups.find(g => g.formation === group.formation)!;
    const roots = corpus().roots.filter(r => r.formation === group.formation);
    const allowed = roots.every(root => { const row = p.rows.find(r => r.id === root.id)!;
      return row.status === "estimated" && formationReservation(formationSpot(root.formation, root.boardId), row.rawEstimate!).admitted; });
    if (!allowed) { assert.equal(generated.status, "blocked"); assert.equal(generated.rows.length, 0); assert.equal(group.status, "blocked"); assert.equal(group.rows.length, 0); }
    if (generated.status !== "complete") { assert.equal(group.status, "blocked"); assert.equal(group.rows.length, 0); }
    if (group.status !== "complete") { assert.ok(!existsSync(dir), "blocked formation must not be published"); summaries.push({ formation: group.formation, status: "blocked", reason: group.error }); continue; }
    assert.equal(generated.status, "complete"); assert.equal(group.rows.length, 12);
    group.rows.forEach((r, i) => { assert.deepEqual(r.dataHashes, generated.rows[i].dataHashes); assert.equal(r.iterations, generated.rows[i].iterations); });
    const audit = auditFormationLibrary(dir, group.formation); raw += audit.totals.rawBytes + statSync(join(dir, "manifest.json")).size;
    const manifest: FormationLibraryManifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.generationRecordHash, gen.payloadHash); assert.equal(manifest.reproductionRecordHash, repro.payloadHash);
    for (const row of generated.rows) {
      const entry = manifest.spots.find(s => s.id === row.id)!;
      const refs = [entry.spot, entry.root, ...Object.values(entry.chunks), ...(row.id === manifest.referee.spotId ? [manifest.referee.ref] : [])];
      assert.deepEqual(Object.keys(row.dataHashes!).sort(), refs.map(r => r.url).sort(), "fresh reproduction must cover every published data file");
      for (const ref of refs) { assert.equal(row.dataHashes![ref.url], ref.sha256); assert.equal(sha256(readFileSync(`public${ref.url}`)), ref.sha256); }
    }
    // Local caches allow an additional exact re-encoding check; CI verifies published data and recorded fresh-solve hashes.
    if (existsSync(CACHE)) { const rebuilt = pack(group.formation, env, gen.payloadHash, repro.payloadHash); assert.equal(rebuilt.text, readFileSync(join(dir, "manifest.json"), "utf8")); }
    summaries.push({ status: "published", ...audit });
  }
  assert.ok(raw <= B.allRawBytes); assert.ok(!repro.groups.some(g => g.status === "complete") || repro.chargedNativeMs <= B.totalNativeMs);
  const directories = existsSync(FORMATION_ROOT) ? readdirSync(FORMATION_ROOT).sort() : [];
  assert.deepEqual(directories, repro.groups.filter(g => g.status === "complete").map(g => g.formation).sort());
  return { corpusHash: env.identity.corpusHash, groups: summaries, rawBytes: raw, chargedNativeMs: repro.chargedNativeMs,
    productionRangesPromoted: false, playChanged: false };
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2); assert.ok(!extra.length && ["--freeze", "--estimate", "--generate", "--reproduce", "--check"].includes(mode), "use --freeze, --estimate, --generate, --reproduce or --check");
  if (mode === "--freeze") { writeNew(CORPUS, buildFormationManifest()); console.log(corpus().payloadHash); return; }
  corpus();
  if (mode === "--check") { console.log(JSON.stringify(auditFormationExperiment(), null, 2)); return; }
  const controller = new AbortController(), cancel = () => controller.abort(); process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try { if (mode === "--estimate") await estimate(); else await phaseRun(mode === "--generate" ? "generate" : "reproduce", controller.signal); }
  finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
