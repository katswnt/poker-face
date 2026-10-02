/** Reproducible P2 release gate. No native binary is needed to independently re-grade
 * preserved full policies and replay the real public adapters/reducer in CI.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";
import type { BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import type { DecisionProvenance } from "../src/lib/hu-play/types";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { requireRiverPlayingResult } from "../src/lib/solver/bridge/live/river-quality";
import { buildNestedRiverSpot } from "../src/lib/hu-play/river-tree";
import { loadP1ProductionRoots } from "./hu-play-p1-corpus";
import { makeRiverOffTreeCase } from "./hu-play-p2-corpus";
import { playRiverCase, type RiverOffTreeCase } from "./hu-play-p2-playing-case";
import { compareRiverPolicies } from "./hu-play-p2-safety";
import { checkP2BrowserRows } from "./hu-play-p2-browser-gates";
import type { P2BrowserMeasurement } from "./hu-play-p2-profile-page";
import { p1PipelineSources } from "./hu-play-p1-successor";
import { wideHash } from "./hu-play-wide-corpus";
import { mathProjection } from "./hu-play-wide-measurement";

interface Hashed { format: string; version: number; payloadHash: string }
interface Source { path: string; sha256: string }
interface Observed extends Hashed { sourceFiles: Source[]; sourceHash: string }
type Solve = { spot: BridgeSpotV1; result: BridgeResultV1 };
type FrozenCase = RiverOffTreeCase & { spot: BridgeSpotV1; spotHash: string; baselineHash: string; rootCorpusIndex: number };
interface NativeRow {
  seed: number; status: string; logHash: string; conserved: boolean; deterministicReplay: boolean;
  provenance: DecisionProvenance; publicSolveKeys: string[];
  solves: { spotHash: string; numericalHash: string; iterations: number; enginePctPot: number;
    grade: ReturnType<typeof requireRiverPlayingResult>["grade"] }[];
}
interface NativeReport extends Observed { inputsHash: string; rows: NativeRow[] }
type BrowserRow = P2BrowserMeasurement & { seed: number; browser: string; exactNativeParity: boolean };
interface BrowserReport extends Observed {
  inputsHash: string; nativeReportHash: string; measured: boolean; passed: boolean; gateError: null | string;
  buildHash: string; engineSourceHash: string; rows: BrowserRow[]; summaries: ReturnType<typeof checkP2BrowserRows>;
}
type SafetyRow = Omit<ReturnType<typeof compareRiverPolicies>, "profiles"> & {
  seed: number; aiSeat: 0 | 1; provenance: DecisionProvenance; profileHashes: { actual: string; translated: string; blueprint: string };
};
interface SafetyReport extends Observed {
  inputsHash: string; playingReportHash: string; rows: SafetyRow[];
  safetyContract: { path: string; text: string; sha256: string };
}
export interface P2Evidence {
  format: "poker-face-p2-evidence"; version: 1 | 2; currentSources: Source[];
  parentEvidenceHash?: string;
  inputs: Hashed & { cases: FrozenCase[] };
  baselines: (Solve & { corpusIndex: number })[];
  cases: { seed: number; solves: Solve[] }[];
  nativeReports: NativeReport[]; safety: SafetyReport; browser: BrowserReport; memory: BrowserReport;
}
export const P2_EVIDENCE_STEM = "tasks/artifacts/hu-play-p2-river";
export const P2_P3_SUCCESSOR_STEM = "tasks/artifacts/hu-play-p2-p3-successor";
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function bound(r: Hashed, format: string) {
  assert.equal(r.format, format); assert.equal(r.version, 1); const { payloadHash, ...payload } = r;
  assert.equal(wideHash(payload), payloadHash, `${format} hash`);
}
function current(r: Observed) {
  assert.equal(wideHash(r.sourceFiles), r.sourceHash);
  for (const ref of r.sourceFiles) {
    assert.match(ref.path, /^(src|scripts|tasks|native)\/[a-zA-Z0-9/._-]+$/); assert.ok(!ref.path.includes(".."));
    assert.equal(digest(readFileSync(ref.path)), ref.sha256, `Measured source changed: ${ref.path}`);
  }
}
function nativeIdentity(r: NativeReport) {
  return r.rows.map(row => ({ seed: row.seed, status: row.status, logHash: row.logHash, conserved: row.conserved,
    deterministicReplay: row.deterministicReplay, provenance: row.provenance, publicSolveKeys: row.publicSolveKeys,
    solves: row.solves.map(s => ({ spotHash: s.spotHash, numericalHash: s.numericalHash, iterations: s.iterations, enginePctPot: s.enginePctPot, grade: s.grade })) }));
}
export async function p2PipelineSources(): Promise<Source[]> {
  const built = await build({ entryPoints: ["scripts/audit-hu-play-p2.ts", "scripts/capture-hu-play-p2.ts", "scripts/profile-hu-play-p2-browser.ts"],
    bundle: true, outdir: "/unused-p2-evidence", platform: "node", format: "esm", packages: "external", write: false, metafile: true });
  const paths = new Set([...p1PipelineSources().map(r => r.path), ...Object.keys(built.metafile.inputs)]);
  return [...paths].sort().map(path => ({ path, sha256: digest(readFileSync(path)) }));
}
function readP2Archive(stem: string, version: 1 | 2): P2Evidence {
  const meta = JSON.parse(readFileSync(`${stem}.json`, "utf8"));
  assert.equal(meta.format, "poker-face-p2-evidence-bundle"); assert.equal(meta.version, version);
  const compressed = readFileSync(`${stem}.json.gz`); assert.equal(compressed.length, meta.bytes);
  assert.equal(digest(compressed), meta.sha256);
  const plain = gunzipSync(compressed, { maxOutputLength: 512 * 1024 ** 2 });
  assert.equal(digest(plain), meta.uncompressedSha256); const evidence = JSON.parse(plain.toString("utf8"));
  assert.equal(wideHash(evidence), meta.evidenceHash); assert.equal(evidence.version, version); return evidence;
}

export function currentP2EvidenceStem() {
  return existsSync(`${P2_P3_SUCCESSOR_STEM}.json`) ? P2_P3_SUCCESSOR_STEM : P2_EVIDENCE_STEM;
}
export function readHistoricalP2Evidence() { return readP2Archive(P2_EVIDENCE_STEM, 1); }
export function readP2Evidence(): P2Evidence {
  const stem = currentP2EvidenceStem(); return readP2Archive(stem, stem === P2_EVIDENCE_STEM ? 1 : 2);
}
export function checkP2SuccessorParent(e: P2Evidence) {
  if (e.version === 1) { assert.equal(e.parentEvidenceHash, undefined); return; }
  assert.equal(e.version, 2); const historical = readHistoricalP2Evidence();
  assert.equal(e.parentEvidenceHash, wideHash(historical), "P2 historical parent evidence hash");
  assert.deepEqual(e.inputs, historical.inputs, "P2 frozen inputs must remain unchanged");
  const baselineIdentity = (record: P2Evidence) => record.baselines.map(b => ({ corpusIndex: b.corpusIndex,
    spot: b.spot, numericalHash: wideHash(mathProjection(b.result)) }));
  const caseIdentity = (record: P2Evidence) => record.cases.map(c => ({ seed: c.seed, solves: c.solves.map(s => ({
    spot: s.spot, numericalHash: wideHash(mathProjection(s.result)) })) }));
  assert.deepEqual(baselineIdentity(e), baselineIdentity(historical), "P2 frozen baseline numerical hashes");
  assert.deepEqual(caseIdentity(e), caseIdentity(historical), "P2 frozen playing-policy numerical hashes");
  assert.ok(e.nativeReports.length); assert.deepEqual(nativeIdentity(e.nativeReports.at(-1)!),
    nativeIdentity(historical.nativeReports.at(-1)!), "P2 historical mathematical/log identities");
}

export async function checkP2Evidence(e: P2Evidence) {
  assert.equal(e.format, "poker-face-p2-evidence");
  assert.equal(e.cases.length, 200, "Every one of the 200 cases must remain");
  checkP2SuccessorParent(e);
  assert.deepEqual(e.currentSources, await p2PipelineSources(), "P2 source closure changed; new reproduction evidence required");
  bound(e.inputs, "poker-face-p2-river-inputs"); assert.equal(e.inputs.payloadHash, "4f2a1442b882460371645954ce69ae700324d7427a3271d013d505a156f6325c");
  assert.equal(e.inputs.cases.length, 200); assert.equal(e.baselines.length, 32); assert.ok(e.nativeReports.length >= 1);
  const native = e.nativeReports.at(-1)!;
  for (const report of e.nativeReports) {
    bound(report, "poker-face-p2-production-playing"); assert.equal(report.inputsHash, e.inputs.payloadHash);
    assert.deepEqual(nativeIdentity(report), nativeIdentity(native), "All retained native runs must have identical mathematical/log results");
  }
  current(native); assert.equal(native.rows.length, 200);
  bound(e.safety, "poker-face-p2-river-safety"); current(e.safety);
  assert.equal(e.safety.inputsHash, e.inputs.payloadHash); assert.equal(e.safety.playingReportHash, native.payloadHash); assert.equal(e.safety.rows.length, 200);
  const contract = readFileSync("tasks/heads-up-play-p2-river.md", "utf8").match(/### Prospective safety comparison contract\n[\s\S]*?(?=\n#{1,3} |$)/)?.[0].trim();
  assert.equal(contract, e.safety.safetyContract.text); assert.equal(digest(contract!), e.safety.safetyContract.sha256);
  const roots = loadP1ProductionRoots().filter(r => r.street === "river");
  const oldP1 = JSON.parse(readFileSync("tasks/artifacts/hu-play-p1-production-corpus.json", "utf8"));
  let maxIndependentPctPot = 0, translations = 0;
  const safetyMaxima: number[] = [];
  for (let seed = 0; seed < 200; seed++) {
    const c = e.inputs.cases[seed], evidenceCase = e.cases[seed], row = native.rows[seed];
    assert.equal(c.seed, seed); assert.equal(evidenceCase.seed, seed); assert.equal(row.seed, seed);
    assert.ok(row.status === "complete" && row.conserved && row.deterministicReplay);
    const root = roots[seed % 32], baseline = e.baselines.find(b => b.corpusIndex === root.corpusIndex); assert.ok(baseline);
    assert.equal(c.rootCorpusIndex, root.corpusIndex); assert.equal(hashBridgeSpot(baseline.spot), c.baselineHash);
    assert.equal(wideHash(mathProjection(baseline.result)), oldP1.rows.find((r: { corpusIndex: number }) => r.corpusIndex === root.corpusIndex).numericalHash);
    const { spot, spotHash, baselineHash, rootCorpusIndex, ...inputCase } = c; void baselineHash; void rootCorpusIndex;
    assert.deepEqual(makeRiverOffTreeCase(seed, root.request, baseline.result), inputCase);
    assert.deepEqual(buildNestedRiverSpot(c.request, c.actual), spot); assert.equal(hashBridgeSpot(spot), spotHash);
    assert.equal(evidenceCase.solves.length, row.solves.length); assert.ok([1, 2].includes(row.solves.length));
    const cache = new Map<string, BridgeResultV1>();
    evidenceCase.solves.forEach((s, i) => {
      const hash = hashBridgeSpot(s.spot), ref = row.solves[i]; assert.equal(hash, ref.spotHash);
      assert.equal(wideHash(mathProjection(s.result)), ref.numericalHash, "Saved strategy numerical hash");
      const { grade } = requireRiverPlayingResult(s.result, s.spot, hash); assert.deepEqual(grade, ref.grade);
      assert.ok(grade.exploitabilityPctPot <= .3); maxIndependentPctPot = Math.max(maxIndependentPctPot, grade.exploitabilityPctPot);
      assert.ok(!cache.has(hash)); cache.set(hash, s.result);
    });
    const keys: string[] = [];
    const completed = await playRiverCase(c, root.request, baseline.result, async s => {
      const key = hashBridgeSpot(s); keys.push(key); const result = cache.get(key); assert.ok(result, "Replay changed the public game"); return result;
    });
    assert.equal(completed.logHash, row.logHash); assert.deepEqual(keys, row.publicSolveKeys); assert.deepEqual(completed.provenance, row.provenance);
    if (completed.provenance.source === "translation") { translations++; assert.equal(completed.provenance.reason, "zero-support"); }
    const comparison = compareRiverPolicies(c, evidenceCase.solves[0], completed.previous, completed.response);
    const { profiles, ...values } = comparison;
    const safetyRow = { seed, aiSeat: c.request.aiSeat, provenance: completed.provenance,
      profileHashes: { actual: wideHash(profiles.actual), translated: wideHash(profiles.translated), blueprint: wideHash(profiles.blueprint) }, ...values };
    assert.deepEqual(safetyRow, e.safety.rows[seed], `Independent safety/value recomputation ${seed}`);
    safetyMaxima.push(Math.max(...comparison.margins.flatMap(m => m.versusTranslated === null ? [] : [m.versusTranslated])));
  }
  const verifyBrowser = (report: BrowserReport, names: string[], measured: boolean) => {
    bound(report, "poker-face-p2-production-browser"); current(report);
    assert.equal(report.inputsHash, e.inputs.payloadHash); assert.ok(e.nativeReports.some(r => r.payloadHash === report.nativeReportHash));
    assert.equal(report.measured, measured); assert.equal(report.passed, true); assert.equal(report.gateError, null);
    const summaries = checkP2BrowserRows(report.rows, names, measured); assert.deepEqual(summaries, report.summaries);
    for (const row of report.rows) {
      const ref = native.rows[row.seed]; assert.equal(row.logHash, ref.logHash); assert.deepEqual(row.provenance, ref.provenance);
      assert.deepEqual(row.solves.map(s => s.spotHash), ref.publicSolveKeys);
      assert.deepEqual(row.solves.map(s => s.numericalHash), ref.solves.map(s => s.numericalHash));
      assert.equal(row.workers, ref.solves.length);
      for (const { verdict } of row.estimates) assert.ok(verdict.ok && verdict.totalBytes <= verdict.budgetBytes && verdict.budgetBytes <= 192 * 1024 ** 2);
    }
    return summaries;
  };
  const browser = verifyBrowser(e.browser, ["chromium"], false), memory = verifyBrowser(e.memory, ["chromium", "firefox", "webkit"], true);
  assert.equal(e.browser.buildHash, e.memory.buildHash); assert.equal(e.browser.engineSourceHash, e.memory.engineSourceHash);
  return { format: "poker-face-p2-release-summary", version: e.version, completed: 200, translations, maxIndependentPctPot, browser, memory,
    safety: { casesWithPositiveMarginVsTranslation: safetyMaxima.filter(n => n > .0002).length,
      maxMarginVsTranslationChips: Math.max(...safetyMaxima), maxComposedExploitabilityPctPot: Math.max(...e.safety.rows.map(r => r.grades.actual.exploitabilityPctPot)) },
    limits: "Scripted preflop, hand-written ranges, 12 saved flops. Local approximate games, not exact GTO or global safety. Desktop browser observations, not phone certification." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); assert.deepEqual(args, ["--check"]);
  void checkP2Evidence(readP2Evidence()).then(summary => {
    assert.deepEqual(summary, JSON.parse(readFileSync(`${currentP2EvidenceStem()}-summary.json`, "utf8")));
    console.log(JSON.stringify(summary, null, 2));
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
