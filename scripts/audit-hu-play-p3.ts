/** Independent P3 release gate over preserved public policies. Historical P1/P2
 * evidence is not rewritten. Timings are observations; policy/log identity is exact.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";
import type { BridgeSpotV1, BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { requireTurnPlayingResult } from "../src/lib/solver/bridge/live/turn-quality";
import { requireRiverPlayingResult } from "../src/lib/solver/bridge/live/river-quality";
import { gradeRiverHands } from "../src/lib/solver/bridge/river-hand-values";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import type { DecisionProvenance } from "../src/lib/hu-play/types";
import { buildTurnCorpus, seededTurnRoots, type P3TurnRoot } from "./hu-play-p3-corpus";
import { playTurnCase } from "./hu-play-p3-playing-case";
import { checkP3BrowserRows } from "./hu-play-p3-browser-gates";
import type { P3BrowserMeasurement } from "./hu-play-p3-profile-page";
import { checkCompleteTurnReference, P3_COMPLETE_TURN_SAMPLE_SEEDS } from "./audit-hu-play-p3-turn-grades";
import { p2PipelineSources } from "./audit-hu-play-p2";
import { readP1Successor } from "./hu-play-p1-successor";
import { mathProjection } from "./hu-play-wide-measurement";
import { wideHash } from "./hu-play-wide-corpus";

interface Source { path: string; sha256: string }
interface Hashed { format: string; version: number; payloadHash: string }
interface Observed extends Hashed { sourceFiles: Source[] }
type Case = ReturnType<typeof buildTurnCorpus>[number];
interface NativeRow {
  seed: number; status: string; logHash: string; provenance: DecisionProvenance;
  deterministicReplay: boolean; conserved: boolean; publicSolveKeys: string[];
  solves: { spotHash: string; numericalHash: string; iterations: number; enginePctPot: number; street: string }[];
  riverGrades: { spotHash: string; grade: ReturnType<typeof gradeRiverHands> }[];
}
interface NativeReport extends Observed { inputsHash: string; engineSourceHash: string; rows: NativeRow[] }
interface BrowserReport extends Observed {
  sourceHash: string; inputsHash: string; nativeReportHash: string; buildHash: string; engineSourceHash: string;
  measured: boolean; passed: boolean; gateError: string | null;
  rows: (P3BrowserMeasurement & { seed: number; browser: string; exactNativeParity: boolean })[];
  summaries: ReturnType<typeof checkP3BrowserRows>;
}
export interface P3Evidence {
  format: "poker-face-p3-evidence"; version: 1; currentSources: Source[];
  inputs: { format: string; version: number; rootsSha256: string; engineSourceHash: string; wasmBuildHash: string;
    nativeBinarySha256: string; selectionSources: Source[]; baselineNumericalHashes: string[]; cases: Case[];
    derivedFrom: { inputsHash: string; selectionSources: Source[]; reason: string } };
  roots: { roots: P3TurnRoot[]; skipped: Awaited<ReturnType<typeof seededTurnRoots>>["skipped"]; [key: string]: unknown };
  baselines: BridgeResultV1[];
  cases: { seed: number; attempts: { spot: BridgeSpotV1; spotHash: string; profile: string; result: BridgeResultV1 | null;
    accepted: boolean; error: string | null; elapsedMs: number }[] }[];
  native: NativeReport; browser: BrowserReport; memory: BrowserReport;
  complete: { seed: number; spot: BridgeSpotV1; result: BridgeResultV1 }[];
  completeReport: Observed & { nativeReportHash: string; inputsHash: string; passed: boolean;
    sampleSeeds: number[]; rows: { seed: number; passed: boolean; grade: ReturnType<typeof checkCompleteTurnReference>; firstStreetHash: string }[] };
  hands: Observed & { nativeP1ReportHash: string; sourceHash: string;
    rows: { seed: number; aiSeat: number; logHash: string; keys: string[]; conserved: boolean; deterministicReplay: boolean;
      identicalToP1: boolean; ledger: { finalStacks: number[]; netSinceBeforeBlinds: number[]; externalDeadBlind: number } }[] };
}
export const P3_EVIDENCE_STEM = "tasks/artifacts/hu-play-p3-turn";
const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
export const p3Hash = (v: unknown) => digest(Buffer.from(canonicalSolverJson(v) + "\n"));
function bound(report: Hashed, format: string, hash = p3Hash) {
  const { payloadHash, ...payload } = report;
  assert.equal(report.format, format); assert.equal(report.version, 1); assert.equal(hash(payload), payloadHash, `${format} hash`);
}
function current(refs: Source[]) {
  assert.ok(refs.length);
  for (const ref of refs) {
    assert.match(ref.path, /^(src|scripts|native|tasks)\/[a-zA-Z0-9/._-]+$/); assert.ok(!ref.path.includes(".."));
    assert.equal(digest(readFileSync(ref.path)), ref.sha256, `P3 measured source changed: ${ref.path}`);
  }
}
export async function p3PipelineSources(): Promise<Source[]> {
  const bundle = await build({ entryPoints: ["scripts/audit-hu-play-p3.ts", "scripts/capture-hu-play-p3.ts",
    "scripts/audit-hu-play-p3-playing.ts", "scripts/audit-hu-play-p3-hands.ts", "scripts/audit-hu-play-p3-turn-grades.ts",
    "scripts/profile-hu-play-p3-browser.ts", "scripts/hu-play-p3-profile-page.ts", "scripts/refreeze-hu-play-p3.ts",
    "scripts/reproduce-hu-play-p3.ts",
    "src/lib/solver/bridge/live/worker.ts", "scripts/bridge-live-profile.worker.ts"],
    bundle: true, outdir: "/unused-p3-evidence", format: "esm", platform: "node", packages: "external", write: false, metafile: true });
  const paths = new Set([...(await p2PipelineSources()).map(s => s.path), ...Object.keys(bundle.metafile.inputs)]);
  return [...paths].sort().map(path => ({ path, sha256: digest(readFileSync(path)) }));
}
export function readP3Evidence(): P3Evidence {
  const meta = JSON.parse(readFileSync(`${P3_EVIDENCE_STEM}.json`, "utf8"));
  assert.equal(meta.format, "poker-face-p3-evidence-bundle"); assert.equal(meta.version, 1);
  const bytes = readFileSync(`${P3_EVIDENCE_STEM}.json.gz`); assert.equal(bytes.length, meta.bytes); assert.equal(digest(bytes), meta.sha256);
  const plain = gunzipSync(bytes, { maxOutputLength: 512 * 1024 ** 2 });
  assert.equal(plain.length, meta.uncompressedBytes); assert.equal(digest(plain), meta.uncompressedSha256);
  const e = JSON.parse(plain.toString("utf8")); assert.equal(p3Hash(e), meta.evidenceHash); return e;
}
export async function checkP3Evidence(e: P3Evidence) {
  assert.equal(e.format, "poker-face-p3-evidence"); assert.equal(e.version, 1);
  assert.equal(e.cases.length, 200, "All 200 P3 cases must remain");
  assert.deepEqual(e.currentSources, await p3PipelineSources(), "P3 source closure changed; new reproduction evidence required");
  assert.equal(e.inputs.format, "poker-face-p3-turn-inputs"); assert.equal(e.inputs.version, 2);
  const { derivedFrom, ...input } = e.inputs;
  const original = { ...input, version: 1, selectionSources: derivedFrom.selectionSources };
  assert.equal(p3Hash(original), "b0a7e5dd3ef4516316b8a1bf84759319521a47404965695a29526e1e02c3dae7", "Original frozen P3 games changed");
  assert.equal(derivedFrom.inputsHash, p3Hash(original)); current(e.inputs.selectionSources);
  assert.equal(p3Hash(e.roots), e.inputs.rootsSha256); assert.equal(e.roots.roots.length, 200); assert.equal(e.baselines.length, 200);
  assert.deepEqual(e.baselines.map(r => p3Hash(mathProjection(r))), e.inputs.baselineNumericalHashes);
  assert.deepEqual(buildTurnCorpus(e.roots.roots, e.baselines), e.inputs.cases);
  const fetcher: typeof fetch = async path => {
    assert.match(String(path), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(path).includes(".."));
    return new Response(readFileSync(`public${path}`));
  };
  const selected = await seededTurnRoots(await loadPlayCatalog(undefined, fetcher), 200, fetcher);
  assert.deepEqual(selected.roots, e.roots.roots); assert.deepEqual(selected.skipped, e.roots.skipped);
  bound(e.native, "poker-face-p3-production-playing"); current(e.native.sourceFiles);
  assert.equal(e.native.inputsHash, p3Hash(e.inputs)); assert.equal(e.native.engineSourceHash, e.inputs.engineSourceHash);
  assert.equal(e.native.rows.length, 200);
  let translations = 0, rivers = 0, maxRiverPctPot = 0;
  for (let seed = 0; seed < 200; seed++) {
    const c = e.inputs.cases[seed], recorded = e.cases[seed], row = e.native.rows[seed];
    assert.equal(c.seed, seed); assert.equal(recorded.seed, seed); assert.equal(row.seed, seed);
    assert.ok(row.status === "complete" && row.conserved && row.deterministicReplay);
    assert.deepEqual(recorded.attempts.map(a => hashBridgeSpot(a.spot)), row.publicSolveKeys);
    const accepted = recorded.attempts.filter(a => a.accepted); assert.equal(accepted.length, row.solves.length);
    const grades: NativeRow["riverGrades"] = [];
    accepted.forEach((a, i) => {
      assert.ok(a.result && a.error === null); const ref = row.solves[i], hash = hashBridgeSpot(a.spot);
      assert.equal(hash, a.spotHash); assert.equal(hash, ref.spotHash);
      assert.equal(p3Hash(mathProjection(a.result)), ref.numericalHash, "P3 policy numerical hash");
      assert.equal(a.result.iterations, ref.iterations); assert.equal(a.result.exploitability.pctPot, ref.enginePctPot);
      if (a.spot.tree.mode === "turn-subgame-v1") requireTurnPlayingResult(a.result, a.spot, hash);
      else if (a.spot.tree.mode === "river-subgame-v1") requireRiverPlayingResult(a.result, a.spot, hash);
      else requirePlayingResult(a.result, a.spot, hash);
      if (a.spot.board.river !== null) {
        const grade = gradeRiverHands(a.spot, a.result); assert.ok(grade.exploitabilityPctPot <= .3);
        grades.push({ spotHash: hash, grade }); rivers++; maxRiverPctPot = Math.max(maxRiverPctPot, grade.exploitabilityPctPot);
      }
    });
    assert.deepEqual(grades, row.riverGrades);
    let at = 0;
    const replay = await playTurnCase(c, e.roots.roots[c.rootIndex].request, e.baselines[c.rootIndex], async spot => {
      const a = recorded.attempts[at++]; assert.ok(a); assert.equal(hashBridgeSpot(spot), a.spotHash);
      if (!a.accepted) { assert.ok(a.error); throw new Error(a.error); } assert.ok(a.result); return a.result;
    });
    assert.equal(at, recorded.attempts.length); assert.equal(replay.logHash, row.logHash); assert.deepEqual(replay.provenance, row.provenance);
    if (row.provenance.source === "translation") translations++;
  }
  assert.ok(rivers >= 20);
  bound(e.completeReport, "poker-face-p3-complete-turn-grades"); current(e.completeReport.sourceFiles);
  assert.equal(e.completeReport.nativeReportHash, e.native.payloadHash); assert.equal(e.completeReport.inputsHash, p3Hash(e.inputs));
  assert.equal(e.completeReport.passed, true); assert.deepEqual(e.completeReport.sampleSeeds, [...P3_COMPLETE_TURN_SAMPLE_SEEDS]);
  assert.deepEqual(e.complete.map(c => c.seed), [...P3_COMPLETE_TURN_SAMPLE_SEEDS]); assert.equal(e.completeReport.rows.length, 4);
  const completeGrades = e.complete.map((c, i) => {
    const first = e.cases[c.seed].attempts[0]; assert.ok(first.accepted && first.result);
    assert.deepEqual(c.spot, { ...first.spot, solve: { ...first.spot.solve, exportScope: "full" } });
    const grade = checkCompleteTurnReference(c.spot, c.result, first.result), row = e.completeReport.rows[i];
    assert.equal(row.seed, c.seed); assert.equal(row.passed, true); assert.deepEqual(grade, row.grade); return grade.exploitabilityPctPot;
  });
  const browserGate = (r: BrowserReport, names: string[], measured: boolean) => {
    bound(r, "poker-face-p3-production-browser"); current(r.sourceFiles); assert.equal(r.sourceHash, p3Hash(r.sourceFiles));
    assert.equal(r.inputsHash, p3Hash(e.inputs)); assert.equal(r.nativeReportHash, e.native.payloadHash);
    assert.equal(r.engineSourceHash, e.inputs.engineSourceHash); assert.equal(r.buildHash, e.inputs.wasmBuildHash);
    assert.equal(r.measured, measured); assert.ok(r.passed && r.gateError === null);
    const summaries = checkP3BrowserRows(r.rows, names, measured); assert.deepEqual(summaries, r.summaries);
    for (const row of r.rows) {
      const ref = e.native.rows[row.seed]; assert.equal(row.logHash, ref.logHash); assert.deepEqual(row.provenance, ref.provenance);
      assert.deepEqual(row.publicSolveKeys, ref.publicSolveKeys);
      assert.deepEqual(row.solves.map(s => s.numericalHash), ref.solves.map(s => s.numericalHash));
      assert.deepEqual(row.attempts.map(a => a.accepted), e.cases[row.seed].attempts.map(a => a.accepted));
      for (const { verdict } of row.estimates) assert.ok(verdict.ok && verdict.totalBytes <= verdict.budgetBytes && verdict.budgetBytes <= 192 * 1024 ** 2);
    }
    return summaries;
  };
  const browser = browserGate(e.browser, ["chromium"], false), memory = browserGate(e.memory, ["chromium", "firefox", "webkit"], true);
  bound(e.hands, "poker-face-p3-production-hands", wideHash); current(e.hands.sourceFiles);
  assert.equal(e.hands.sourceHash, wideHash(e.hands.sourceFiles)); assert.equal(e.hands.rows.length, 1000);
  const p1 = readP1Successor().successor[0];
  assert.equal(e.hands.nativeP1ReportHash, p1.payloadHash, "P3 full hands must bind the fresh P1 native reproduction");
  e.hands.rows.forEach((r, seed) => {
    assert.equal(r.seed, seed); assert.equal(r.aiSeat, seed % 2); assert.ok(r.conserved && r.deterministicReplay && r.identicalToP1);
    assert.equal(r.logHash, p1.hands[seed].logHash); assert.deepEqual(r.ledger, p1.hands[seed].ledger);
    assert.deepEqual(r.keys, p1.solves.filter(s => s.seed === seed).map(s => s.spotHash));
    assert.equal(r.ledger.finalStacks[0] + r.ledger.finalStacks[1], 20050);
  });
  return { format: "poker-face-p3-release-summary", version: 1, completed: 200, direct: 200 - translations, translations,
    acceptedSolves: e.native.rows.reduce((n, r) => n + r.solves.length, 0), rivers, maxRiverPctPot,
    completeTurns: 4, completeTurnPctPot: completeGrades, hands: 1000, browser, memory, cacheRequired: false,
    latencyGate: { browser: "chromium", turnP95Ms: 10000, riverP95Ms: 2000 },
    limits: "Scripted preflop, hand-written ranges, 12 saved flops. Approximate local strategies, not exact GTO or globally safe. Atypical sizes can exploit composed play. Optional cache unpublished; physical phones unvalidated." };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--check"]);
  void checkP3Evidence(readP3Evidence()).then(summary => {
    assert.deepEqual(summary, JSON.parse(readFileSync(`${P3_EVIDENCE_STEM}-summary.json`, "utf8")));
    console.log(JSON.stringify(summary, null, 2));
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
