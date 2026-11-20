/** Separately named source successors; every original gate runs before any write.
 * Use --freeze INPUTS_ROOT p1|p2|p3|p4|p5 DIRECTORIES... . Historical bytes stay intact.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { wideHash } from "./hu-play-wide-corpus";
import { checkP1Reports } from "./audit-hu-play-p1";
import { checkP1SuccessorEvidence, p1PipelineSources, P1_E1_SUCCESSOR_STEM, P1_RELEASE_COMMIT,
  readPreE1P1Successor, type P1Reports, type P1SuccessorEvidence } from "./hu-play-p1-successor";
import { checkP2Evidence, p2PipelineSources, readPreE1P2Evidence, P2_E1_SUCCESSOR_STEM, type P2Evidence } from "./audit-hu-play-p2";
import { checkP3Evidence, p3PipelineSources, p3Hash, readPreE1P3Evidence, P3_E1_SUCCESSOR_STEM, type P3Evidence } from "./audit-hu-play-p3";
import { checkP4Evidence, p4PipelineSources, p4Hash, readPreE1P4Evidence, P4_E1_SUCCESSOR_STEM, type P4Evidence } from "./audit-hu-play-p4";
import { checkP5Evidence, p5PipelineSources, p5Hash, readPreE1P5Evidence, P5_E1_SUCCESSOR_STEM, type P5Evidence } from "./audit-hu-play-p5";
import { archiveE1ParentSources, E1_BASE_COMMIT } from "./prepare-hu-play-e1-inputs";
import { wasmBuild } from "./bridge-wasm-runner";
import { BRIDGE_BINARY } from "./bridge-runner";
import { runBridgeSpot } from "./bridge-runner";
import { loadWasm, runWasmSpot } from "./bridge-wasm-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { isomorphismProbeSpot } from "../src/lib/solver/bridge/referee-node";
import { checkE1Evidence, e1ContractText, E1_STEM, productionRiverValues, selectProductionRivers, type E1Evidence } from "./audit-hu-play-e1";
import { readP1Successor } from "./hu-play-p1-successor";
import { readP2Evidence } from "./audit-hu-play-p2";
import { readP3Evidence } from "./audit-hu-play-p3";
import { readP4Evidence } from "./audit-hu-play-p4";
import { readP5Evidence } from "./audit-hu-play-p5";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const digest = (v: Uint8Array | string) => createHash("sha256").update(v).digest("hex");
function inputEnvelope(directory: string) {
  const meta = read(join(directory, "inputs.json")), compressed = readFileSync(join(directory, "inputs.json.gz"));
  assert.equal(compressed.length, meta.bytes); assert.equal(digest(compressed), meta.sha256);
  const plain = gunzipSync(compressed, { maxOutputLength: 128 * 1024 ** 2 });
  assert.equal(plain.length, meta.plainBytes); assert.equal(digest(plain), meta.inputsHash);
  return JSON.parse(plain.toString("utf8"));
}
function pack(stem: string, format: string, version: number, evidence: unknown, hash: (v: unknown) => string,
  summary?: unknown) {
  const plain = Buffer.from(canonicalSolverJson(evidence) + "\n"), compressed = gzipSync(plain, { level: 9 });
  assert.ok(plain.length < 512 * 1024 ** 2 && compressed.length < 100 * 1024 ** 2);
  const meta = { format, version, bytes: compressed.length, sha256: digest(compressed), uncompressedBytes: plain.length,
    uncompressedSha256: digest(plain), evidenceHash: hash(evidence) };
  writeFileSync(`${stem}.json.gz`, compressed, { flag: "wx" });
  writeFileSync(`${stem}.json`, canonicalSolverJson(meta) + "\n", { flag: "wx" });
  if (summary) writeFileSync(`${stem}-summary.json`, canonicalSolverJson(summary) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ stem, ...meta, summary }));
}
async function main() {
  const [flag, freezeDir, milestone, ...dirs] = process.argv.slice(2);
  assert.ok(flag === "--freeze" && freezeDir && ["p1", "p2", "p3", "p4", "p5", "values"].includes(milestone));
  const frozen = read(join(freezeDir, "source-freeze.json"));
  const verifyFreeze = async () => {
    assert.equal(frozen.format, "poker-face-e1-source-freeze"); assert.equal(frozen.version, 1);
    assert.equal(frozen.baseCommit, E1_BASE_COMMIT);
    assert.equal(frozen.contractSha256, digest(e1ContractText()), "Contract changed since freeze");
    assert.deepEqual(await p5PipelineSources(), frozen.sourceFiles, "Source changed since the pre-measurement E1 freeze");
    const { manifest } = wasmBuild(); assert.equal(manifest.sourceHash, frozen.engineSourceHash);
    assert.equal(manifest.buildHash, frozen.wasmBuildHash);
    assert.equal(digest(readFileSync(BRIDGE_BINARY)), frozen.nativeBinarySha256, "Native binary changed since freeze");
  };
  await verifyFreeze();
  if (milestone === "p1") {
    assert.equal(dirs.length, 3, "p1 HANDS_DIR CORPUS_DIR BROWSER_DIR");
    const parent = readPreE1P1Successor();
    const original = ["hands", "corpus", "browser"].map(n => read(`tasks/artifacts/hu-play-p1-production-${n}.json`)) as P1Reports;
    const e: P1SuccessorEvidence = { format: "poker-face-p1-successor", version: 3, originalCommit: P1_RELEASE_COMMIT,
      parentEvidenceHash: wideHash(parent), e1Parent: { evidenceHash: wideHash(parent), sources: archiveE1ParentSources(parent.currentSources) },
      originalReportHashes: parent.originalReportHashes, originalSources: parent.originalSources,
      currentSources: p1PipelineSources(), successor: dirs.map(dir => read(join(dir, "report.json"))) as P1Reports };
    checkP1SuccessorEvidence(e, original, checkP1Reports); await verifyFreeze();
    pack(P1_E1_SUCCESSOR_STEM, "poker-face-p1-successor-bundle", 3, e, wideHash);
  } else if (milestone === "p2") {
    assert.equal(dirs.length, 5, "p2 INPUTS_DIR NATIVE_DIR SAFETY_DIR BROWSER_DIR MEMORY_DIR");
    const [input, native, safety, browser, memory] = dirs, parent = readPreE1P2Evidence();
    const report = read(join(native, "report.json"));
    const e: P2Evidence = { format: "poker-face-p2-evidence", version: 3, currentSources: await p2PipelineSources(),
      parentEvidenceHash: wideHash(parent), e1Parent: { evidenceHash: wideHash(parent), sources: archiveE1ParentSources(parent.currentSources) },
      inputs: read(join(input, "inputs.json")), baselines: parent.baselines.map(b => ({ corpusIndex: b.corpusIndex,
        ...read(join(input, `baseline-${b.corpusIndex}.json`)) })),
      cases: report.rows.map((r: { seed: number; solves: unknown[] }) => ({ seed: r.seed,
        solves: r.solves.map((_, i) => read(join(native, `case-${r.seed}-solve-${i}.json`))) })),
      nativeReports: [...parent.nativeReports, report], safety: read(join(safety, "report.json")),
      browser: read(join(browser, "report.json")), memory: read(join(memory, "report.json")) };
    const summary = await checkP2Evidence(e); await verifyFreeze();
    pack(P2_E1_SUCCESSOR_STEM, "poker-face-p2-evidence-bundle", 3, e, wideHash, summary);
  } else if (milestone === "p3" || milestone === "p4") {
    assert.equal(dirs.length, 6, `${milestone} INPUTS_DIR NATIVE_DIR BROWSER_DIR MEMORY_DIR GRADES_DIR HANDS_DIR`);
    const [input, native, browser, memory, grades, hands] = dirs;
    const report = read(join(native, "report.json")), completeReport = read(join(grades, "report.json"));
    const common = { inputs: inputEnvelope(input),
      cases: report.rows.map((r: { seed: number; publicSolveKeys: string[] }) => ({ seed: r.seed,
        attempts: r.publicSolveKeys.map((_, i) => read(join(native, `case-${r.seed}-attempt-${i}.json`))) })),
      native: report, browser: read(join(browser, "report.json")), memory: read(join(memory, "report.json")),
      complete: (completeReport.sampleSeeds as number[]).map(seed => ({ seed, spot: read(join(grades, `seed-${seed}.spot.json`)),
        result: read(join(grades, `seed-${seed}.result.json`)) })), completeReport, hands: read(join(hands, "report.json")) };
    if (milestone === "p3") {
      const parent = readPreE1P3Evidence();
      const e: P3Evidence = { ...common, format: "poker-face-p3-evidence", version: 2, currentSources: await p3PipelineSources(),
        e1Parent: { evidenceHash: p3Hash(parent), sources: archiveE1ParentSources(parent.currentSources) },
        roots: read(join(input, "roots.json")), baselines: Array.from({ length: 200 }, (_, i) => read(join(input, `baseline-${i}.json`))) };
      const summary = await checkP3Evidence(e); await verifyFreeze();
      pack(P3_E1_SUCCESSOR_STEM, "poker-face-p3-evidence-bundle", 2, e, p3Hash, summary);
    } else {
      const parent = readPreE1P4Evidence();
      const e: P4Evidence = { ...common, format: "poker-face-p4-evidence", version: 2, currentSources: await p4PipelineSources(),
        e1Parent: { evidenceHash: p4Hash(parent), sources: archiveE1ParentSources(parent.currentSources) } };
      const summary = await checkP4Evidence(e); await verifyFreeze();
      pack(P4_E1_SUCCESSOR_STEM, "poker-face-p4-evidence-bundle", 2, e, p4Hash, summary);
    }
  } else if (milestone === "p5") {
    assert.equal(dirs.length, 1, "p5 ENABLED_UI_DIRECTORY"); const [directory] = dirs, parent = readPreE1P5Evidence();
    const report = read(join(directory, "report.json"));
    assert.deepEqual(read(join(directory, "inputs.json")), report.frozen);
    for (const row of report.rows) assert.deepEqual(read(join(directory, `hand-${row.seed}.json`)), row);
    const e: P5Evidence = { format: "poker-face-p5-ui-evidence", version: 2, report,
      currentSources: await p5PipelineSources(), e1Parent: { evidenceHash: p5Hash(parent), sources: archiveE1ParentSources(parent.report.frozen.sourceFiles) },
      solves: readdirSync(join(directory, "solves")).sort().map(name => {
        assert.match(name, /^[a-f0-9]{64}\.json$/); return read(join(directory, "solves", name));
      }) };
    const summary = await checkP5Evidence(e); await verifyFreeze();
    pack(P5_E1_SUCCESSOR_STEM, "poker-face-p5-ui-evidence-bundle", 2, e, p5Hash, summary);
  } else {
    assert.equal(dirs.length, 4, "values ENABLED_HANDS_DIR ENABLED_P3_NATIVE_DIR ENABLED_BROWSER_DIR ENABLED_MEMORY_DIR");
    const [handsDir, nativeDir, browserDir, memoryDir] = dirs;
    const hands = read(join(handsDir, "report.json")), native = read(join(nativeDir, "report.json"));
    assert.equal(hands.decisionValues, true); assert.equal(native.decisionValues, true);
    const keys = [...new Set<string>(hands.solves.map((s: { spotHash: string }) => s.spotHash))].sort();
    for (const key of keys) assert.match(key, /^[a-f0-9]{64}$/);
    const { bindings } = await loadWasm(), references: E1Evidence["references"] = [];
    for (const spot of [buildBridgeFixture("referee-river-v3-demo"), buildBridgeFixture("referee-turn-v2-dry-value"), isomorphismProbeSpot()]) {
      references.push({ spot, native: (await runBridgeSpot(spot, { threads: 1, decisionValues: true })).result,
        wasm: runWasmSpot(bindings, spot, 7, { decisionValues: true }) });
    }
    const contractText = e1ContractText(), ui = readP5Evidence();
    const e: E1Evidence = { format: "poker-face-e1-values-evidence", version: 1, sourceFreeze: frozen,
      contract: { text: contractText, sha256: digest(contractText) },
      parents: { p1: wideHash(readP1Successor()), p2: wideHash(readP2Evidence()), p3: p3Hash(readP3Evidence()), p4: p4Hash(readP4Evidence()), p5: p5Hash(ui) },
      hands: { report: hands, policies: keys.map(key => ({ spot: read(join(handsDir, "results", `${key}.spot.json`)), result: read(join(handsDir, "results", `${key}.json`)) })) },
      inputs: inputEnvelope(join(freezeDir, "p3")),
      cases: native.rows.map((r: { seed: number; publicSolveKeys: string[] }) => ({ seed: r.seed,
        attempts: r.publicSolveKeys.map((_, i) => read(join(nativeDir, `case-${r.seed}-attempt-${i}.json`))) })),
      native, browser: read(join(browserDir, "report.json")), memory: read(join(memoryDir, "report.json")),
      references, largeRivers: selectProductionRivers(ui.solves).map(productionRiverValues) };
    const summary = await checkE1Evidence(e); await verifyFreeze();
    pack(E1_STEM, "poker-face-e1-values-bundle", 1, e, p3Hash, summary);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
