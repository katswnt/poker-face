/** Additional ENABLED teaching gates. Run alongside P1–P5, never instead of them. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { checkBridgeResult, type BridgeResultV1, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { requireTurnPlayingResult } from "../src/lib/solver/bridge/live/turn-quality";
import { requireRiverPlayingResult } from "../src/lib/solver/bridge/live/river-quality";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { isomorphismProbeSpot } from "../src/lib/solver/bridge/referee-node";
import { checkE1TeachingPolicy, type E1Source } from "./hu-play-e1-successor";
import { p1HandsIdentity, readP1Successor, readPreE1P1Successor } from "./hu-play-p1-successor";
import type { Hands } from "./audit-hu-play-p1";
import { readP2Evidence } from "./audit-hu-play-p2";
import { p3Hash, readP3Evidence, readPreE1P3Evidence, type P3Evidence } from "./audit-hu-play-p3";
import { p4Hash, readP4Evidence } from "./audit-hu-play-p4";
import { p5Hash, p5PipelineSources, readP5Evidence } from "./audit-hu-play-p5";
import { checkP3BrowserRows } from "./hu-play-p3-browser-gates";
import { playTurnCase } from "./hu-play-p3-playing-case";
import { wideHash } from "./hu-play-wide-corpus";
import { mathProjection } from "./hu-play-wide-measurement";
import { auditDecisionValues, recomputeDecisionValues } from "./bridge-decision-value-oracle";
import { E1_BASE_COMMIT } from "./prepare-hu-play-e1-inputs";

export const E1_STEM = "tasks/artifacts/hu-play-e1-values";
type Solve = { spot: BridgeSpotV1; result: BridgeResultV1 };
export interface E1Evidence {
  format: "poker-face-e1-values-evidence"; version: 1;
  sourceFreeze: { format: string; version: number; baseCommit: string; sourceFiles: E1Source[];
    engineSourceHash: string; wasmBuildHash: string; nativeBinarySha256: string; contractSha256: string; frozenAt: string };
  contract: { text: string; sha256: string };
  parents: { p1: string; p2: string; p3: string; p4: string; p5: string };
  hands: { report: Hands & { decisionValues: boolean }; policies: Solve[] };
  inputs: P3Evidence["inputs"];
  cases: P3Evidence["cases"];
  native: P3Evidence["native"] & { decisionValues: boolean; nativeBinarySha256: string };
  browser: P3Evidence["browser"] & { decisionValues: boolean };
  memory: P3Evidence["memory"] & { decisionValues: boolean };
  references: { spot: BridgeSpotV1; native: BridgeResultV1; wasm: BridgeResultV1 }[];
  largeRivers: ReturnType<typeof productionRiverValues>[];
}
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export function e1ContractText() {
  const text = readFileSync("tasks/live-decision-ev-spec.md", "utf8");
  const prospective = text.split("## Execution and release checklist")[0];
  const migration = text.match(/### Prospective evidence migration\n[\s\S]*?(?=\n## |$)/)?.[0];
  assert.ok(migration); return prospective.trim() + "\n\n" + migration.trim() + "\n";
}
export function readE1Evidence(): E1Evidence {
  const meta = JSON.parse(readFileSync(`${E1_STEM}.json`, "utf8")), bytes = readFileSync(`${E1_STEM}.json.gz`);
  assert.equal(meta.format, "poker-face-e1-values-bundle"); assert.equal(meta.version, 1);
  assert.equal(bytes.length, meta.bytes); assert.equal(digest(bytes), meta.sha256);
  const plain = gunzipSync(bytes, { maxOutputLength: 512 * 1024 ** 2 });
  assert.equal(plain.length, meta.uncompressedBytes); assert.equal(digest(plain), meta.uncompressedSha256);
  const e = JSON.parse(plain.toString("utf8")); assert.equal(p3Hash(e), meta.evidenceHash); return e;
}
function bound(report: { format: string; version: number; payloadHash: string }, format: string, hash = p3Hash) {
  const { payloadHash, ...payload } = report;
  assert.equal(report.format, format); assert.equal(report.version, 1); assert.equal(hash(payload), payloadHash, `${format} hash`);
}
function current(refs: readonly E1Source[], closure: readonly E1Source[]) {
  assert.ok(refs.length, "Measured source list required");
  const map = new Map(closure.map(s => [s.path, s.sha256]));
  for (const ref of refs) assert.equal(map.get(ref.path), ref.sha256, `Measured source not in current closure: ${ref.path}`);
}
function playing(s: Solve) {
  const hash = hashBridgeSpot(s.spot);
  return (s.spot.tree.mode === "turn-subgame-v1" ? requireTurnPlayingResult
    : s.spot.tree.mode === "river-subgame-v1" ? requireRiverPlayingResult : requirePlayingResult)(s.result, s.spot, hash);
}
/** Separate production-scale observation, not the tiny-game 0.0002-chip tolerance. */
export function productionRiverValues(s: Solve) {
  const expected = recomputeDecisionValues(s.spot, s.result), actual = s.result.decisionValues;
  assert.ok(actual); assert.equal(actual.nodes.length, expected.nodes.length);
  let maxAbsoluteError = 0, checkedCells = 0, nullCells = 0;
  expected.nodes.forEach((n, i) => {
    assert.equal(actual.nodes[i].nodeId, n.nodeId);
    n.actionEv.forEach((row, a) => row.forEach((value, h) => {
      const v = actual.nodes[i].actionEv[a][h];
      if (value === null || v === null) { assert.equal(v, value, "Production compatible-reach mask"); nullCells++; }
      else { assert.ok(Number.isFinite(v)); maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(v - value)); checkedCells++; }
    }));
  });
  assert.ok(maxAbsoluteError < .05, "Production sample discrepancy reaches half the 0.1-chip display step");
  return { spotHash: s.result.spotHash, startingPot: s.spot.startingPot, effectiveStack: s.spot.effectiveStack,
    compatibleDeals: expected.compatibleDeals, checkedCells, nullCells, maxAbsoluteError };
}
export function selectProductionRivers(solves: Solve[]) {
  return solves.filter(s => s.spot.board.river && s.result.hands[0].length * s.result.hands[1].length * s.result.tree.length <= 3_000_000)
    .sort((a, b) => b.spot.startingPot - a.spot.startingPot || a.result.spotHash.localeCompare(b.result.spotHash)).slice(0, 5);
}
export async function checkE1Evidence(e: E1Evidence) {
  assert.equal(e.format, "poker-face-e1-values-evidence"); assert.equal(e.version, 1);
  assert.equal(e.cases.length, 200, "All 200 enabled P3 cases required");
  assert.equal(e.browser.decisionValues, true, "Enabled browser capability required");
  assert.equal(e.memory.decisionValues, true, "Enabled measured browser capability required");
  assert.deepEqual(e.sourceFreeze.sourceFiles, await p5PipelineSources(), "E1 measured source closure changed");
  const freeze = e.sourceFreeze;
  assert.equal(freeze.format, "poker-face-e1-source-freeze"); assert.equal(freeze.version, 1); assert.equal(freeze.baseCommit, E1_BASE_COMMIT);
  for (const hash of [freeze.engineSourceHash, freeze.wasmBuildHash, freeze.nativeBinarySha256]) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(e.contract.text, e1ContractText()); assert.equal(e.contract.sha256, digest(e.contract.text));
  assert.equal(e.contract.sha256, freeze.contractSha256, "Teaching contract changed after the pre-measurement freeze");
  assert.equal(e.parents.p1, wideHash(readP1Successor())); assert.equal(e.parents.p2, wideHash(readP2Evidence()));
  assert.equal(e.parents.p3, p3Hash(readP3Evidence())); assert.equal(e.parents.p4, p4Hash(readP4Evidence()));
  const ui = readP5Evidence(); assert.equal(ui.version, 2, "Enabled P5 successor required"); assert.equal(e.parents.p5, p5Hash(ui));

  const h = e.hands.report, oldHands = readPreE1P1Successor().successor[0];
  bound(h, "poker-face-p1-production-hands", wideHash); assert.equal(h.decisionValues, true);
  current(h.sourceSnapshot.sourceFiles, freeze.sourceFiles);
  assert.equal(h.sourceSnapshotHash, wideHash(h.sourceSnapshot)); assert.equal(h.hands.length, 1000);
  const policies = new Map(e.hands.policies.map(s => [hashBridgeSpot(s.spot), s]));
  assert.equal(policies.size, e.hands.policies.length);
  assert.deepEqual([...policies.keys()].sort(), [...new Set(h.solves.map(s => s.spotHash))].sort());
  const legacyHashes = new Map<string, string>();
  for (const [key, s] of policies) {
    playing(s); assert.ok(s.result.decisionValues);
    const { decisionValues, ...legacy } = s.result; void decisionValues;
    legacyHashes.set(key, wideHash(mathProjection(legacy)));
  }
  for (const solve of h.solves) assert.equal(solve.numericalHash, wideHash(mathProjection(policies.get(solve.spotHash)!.result)));
  assert.deepEqual(p1HandsIdentity({ ...h, solves: h.solves.map(s => ({ ...s, numericalHash: legacyHashes.get(s.spotHash)! })) }),
    p1HandsIdentity(oldHands), "Every enabled P1 log, ledger, action, request and old mathematical hash must remain identical");
  for (const row of h.riverGrades) {
    const { spot, result } = policies.get(row.spotHash)!;
    const grade = gradeRiverSubgame({ hands: result.hands, startingPot: spot.startingPot,
      subtree: { path: [], nodes: result.tree, ev: result.root.engineEv, reach: spot.ranges.map(r => r.combos.map(h => h.weight)) as [number[], number[]] } });
    const { elapsedMs: a, ...actual } = grade, { elapsedMs: b, ...recorded } = row.grade; void a; void b;
    assert.deepEqual(actual, recorded); assert.ok(grade.localExploitabilityPctPot <= .3);
  }

  const parent = readPreE1P3Evidence(), currentP3 = readP3Evidence();
  assert.deepEqual(e.inputs, currentP3.inputs, "Enabled/disabled frozen inputs must be identical");
  bound(e.native, "poker-face-p3-production-playing"); assert.equal(e.native.decisionValues, true);
  current(e.native.sourceFiles, freeze.sourceFiles); assert.equal(e.native.engineSourceHash, freeze.engineSourceHash);
  assert.equal(e.native.nativeBinarySha256, freeze.nativeBinarySha256); assert.equal(e.native.inputsHash, p3Hash(e.inputs));
  assert.equal(e.native.rows.length, 200);
  for (let seed = 0; seed < 200; seed++) {
    const c = e.cases[seed], old = parent.cases[seed], row = e.native.rows[seed], original = parent.native.rows[seed];
    assert.equal(c.seed, seed); assert.equal(row.seed, seed); assert.equal(c.attempts.length, old.attempts.length);
    assert.equal(row.status, "complete"); assert.ok(row.deterministicReplay && row.conserved);
    assert.equal(row.logHash, original.logHash); assert.deepEqual(row.provenance, original.provenance);
    assert.deepEqual(row.publicSolveKeys, original.publicSolveKeys); assert.deepEqual(row.riverGrades, original.riverGrades);
    let accepted = 0;
    c.attempts.forEach((a, i) => {
      const before = old.attempts[i]; assert.deepEqual(a.spot, before.spot); assert.equal(a.spotHash, before.spotHash);
      assert.equal(a.accepted, before.accepted); assert.equal(a.error, before.error); assert.equal(a.profile, before.profile);
      if (before.result) { assert.ok(a.result); checkE1TeachingPolicy(a.spot, a.result, before.result); }
      else assert.equal(a.result, null);
      if (a.accepted) {
        assert.ok(a.result); playing({ spot: a.spot, result: a.result });
        const ref = row.solves[accepted++]; assert.equal(ref.spotHash, a.spotHash);
        assert.equal(ref.numericalHash, p3Hash(mathProjection(a.result))); assert.equal(ref.iterations, a.result.iterations);
        assert.equal(ref.enginePctPot, a.result.exploitability.pctPot);
      }
    });
    assert.equal(accepted, row.solves.length);
    let at = 0;
    const played = await playTurnCase(e.inputs.cases[seed], parent.roots.roots[e.inputs.cases[seed].rootIndex].request,
      parent.baselines[e.inputs.cases[seed].rootIndex], async spot => {
        const attempt = c.attempts[at++]; assert.ok(attempt); assert.equal(hashBridgeSpot(spot), attempt.spotHash);
        if (!attempt.accepted) throw new Error(attempt.error!); return attempt.result!;
      });
    assert.equal(at, c.attempts.length); assert.equal(played.logHash, row.logHash); assert.deepEqual(played.provenance, row.provenance);
  }
  const browserGate = (report: E1Evidence["browser"], names: string[], measured: boolean) => {
    bound(report, "poker-face-p3-production-browser"); current(report.sourceFiles, freeze.sourceFiles);
    assert.equal(report.sourceHash, p3Hash(report.sourceFiles)); assert.equal(report.inputsHash, p3Hash(e.inputs));
    assert.equal(report.nativeReportHash, e.native.payloadHash); assert.equal(report.engineSourceHash, freeze.engineSourceHash);
    assert.equal(report.buildHash, freeze.wasmBuildHash); assert.equal(report.measured, measured);
    assert.ok(report.passed && report.gateError === null);
    const summary = checkP3BrowserRows(report.rows, names, measured); assert.deepEqual(report.summaries, summary);
    for (const row of report.rows) {
      const ref = e.native.rows[row.seed], accepted = e.cases[row.seed].attempts.filter(a => a.accepted);
      assert.equal(row.logHash, ref.logHash); assert.deepEqual(row.provenance, ref.provenance);
      assert.deepEqual(row.publicSolveKeys, ref.publicSolveKeys);
      assert.deepEqual(row.attempts.map(a => a.accepted), e.cases[row.seed].attempts.map(a => a.accepted));
      assert.deepEqual(row.solves.map(s => s.numericalHash), ref.solves.map(s => s.numericalHash));
      row.solves.forEach((s, i) => { assert.ok(s.teaching); assert.equal(s.teaching.decisionValueHash, p3Hash(accepted[i].result!.decisionValues)); });
      for (const { estimate, verdict } of row.estimates) assert.ok(estimate.estimateExport.decisionValueCells! > 0
        && verdict.ok && verdict.totalBytes <= verdict.budgetBytes && verdict.budgetBytes <= 192 * 1024 ** 2);
      if (measured) {
        assert.equal(row.exportObservations?.length, row.solves.length, "Actual export observations required");
        for (const observation of row.exportObservations!) {
          const estimate = row.estimates.find(s => s.estimate.spotHash === observation.spotHash)!.estimate;
          assert.ok(observation.jsonBytes > 0 && observation.jsonBytes <= estimate.estimateExport.jsonBytesUpperBound);
          assert.ok(Number.isFinite(observation.elapsedMs) && observation.elapsedMs >= 0);
        }
      }
    }
    return summary;
  };
  const browser = browserGate(e.browser, ["chromium"], false), memory = browserGate(e.memory, ["chromium", "firefox", "webkit"], true);
  const spots = [buildBridgeFixture("referee-river-v3-demo"), buildBridgeFixture("referee-turn-v2-dry-value"), isomorphismProbeSpot()];
  assert.equal(e.references.length, spots.length);
  const references = e.references.map((r, i) => {
    assert.deepEqual(r.spot, spots[i]); checkBridgeResult(r.native, r.spot, hashBridgeSpot(r.spot)); checkBridgeResult(r.wasm, r.spot, hashBridgeSpot(r.spot));
    assert.deepEqual(mathProjection(r.native), mathProjection(r.wasm), "Complete native/WASM teaching and old math parity");
    return { spotHash: r.native.spotHash, ...auditDecisionValues(r.spot, r.native) };
  });
  const largeRivers = selectProductionRivers(ui.solves).map(productionRiverValues);
  assert.equal(largeRivers.length, 5); assert.deepEqual(largeRivers, e.largeRivers);
  return { format: "poker-face-e1-values-summary", version: 1, hands: 1000, turnCases: 200, uiHands: ui.report.rows.length,
    nativeSolves: h.solves.length, distinctHandPolicies: policies.size, acceptedTurnCorpusSolves: e.native.rows.reduce((n, r) => n + r.solves.length, 0),
    browser, memory, references, largeRivers,
    limitations: "Approximate local policies, not later composed play or exact GTO. Tiny referee tolerance is not a per-hand guarantee; production samples separately measured. Physical phones unvalidated. Run alongside P1–P5 release audits." };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--check"]);
  checkE1Evidence(readE1Evidence()).then(summary => {
    assert.deepEqual(summary, JSON.parse(readFileSync(`${E1_STEM}-summary.json`, "utf8"))); console.log(JSON.stringify(summary, null, 2));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
