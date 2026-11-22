/** Reproduce tiny math; verify saved native evidence. Never starts a full-deck solve. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGameTreeIndex } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { corpusSpot, hashJson, prettyJson, sha256, VALIDATION_BUDGETS } from "../src/lib/solver/preflop-v2/corpus";
import { TINY_INPUT, tinyGame, tinyFixedStrategy, tinyContinuationTable, tinyCollapsedGrade } from "../src/lib/solver/preflop-v2/tiny-game";
import { tinyOracleGrade, tinyCheatingWitness } from "../src/lib/solver/preflop-v2/tiny-oracle";
import { calibrationRoots, checkContinuationResult, type ContinuationObservation } from "../src/lib/solver/preflop-v2/observations";
import { readValidationManifest } from "./audit-preflop-v2-contract";
import { RESEARCH_CONTRACT, nativeInputHashes, preflightReport, sourceHashes, type PreflightReport } from "./measure-preflop-v2-research";
import { CALIBRATION_SOURCES } from "./solve-preflop-v2-calibration";

const ARTIFACTS = "tasks/artifacts/preflop-v2";
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-10, `${a} differs from ${b}`);
const TINY_SOURCES = ["src/lib/solver/preflop-v2/tiny-game.ts", "src/lib/solver/preflop-v2/tiny-oracle.ts",
  "src/lib/solver/preflop-v2/table.ts", "src/lib/solver/preflop-v2/measure.ts", "src/lib/solver/preflop-v2/accounting.ts",
  "src/lib/solver/toy/game.ts", "src/lib/solver/toy/cfr.ts", "src/lib/solver/toy/best-response.ts",
  "src/lib/solver/river/cards.ts", "src/lib/poker/score7.ts", "src/lib/poker/cards.ts", "src/lib/poker/types.ts", "src/lib/solver/preflop/texture.ts"];

export function buildTinyReference() {
  const fixed = (["bet", "checkdown", "allin"] as const).map(mode => {
    const game = tinyGame(mode), strategy = tinyFixedStrategy(game), grade = gradeStrategy(game, strategy), oracle = tinyOracleGrade(strategy, mode);
    for (const p of [0, 1] as const) { near(grade.value[p], oracle.value[p]); near(grade.bestResponses[p].value, oracle.bestResponse[p]); }
    const table = tinyContinuationTable(game, strategy), restricted = tinyCollapsedGrade(table, strategy);
    near(restricted.value[0], grade.value[0]); near(restricted.value[1], grade.value[1]);
    assert.ok(oracle.bestResponse[1] >= restricted.ipPreflopBestResponse - 1e-10);
    return { mode, oracle, restricted, table, strategy: serializeBehavioralStrategy(strategy) };
  });
  const game = tinyGame(), index = buildGameTreeIndex(game), result = solveCfr(game, { iterations: 16384 });
  const grade = gradeStrategy(game, result.averageStrategy, index), oracle = tinyOracleGrade(result.averageStrategy);
  for (const p of [0, 1] as const) { near(grade.value[p], oracle.value[p]); near(grade.bestResponses[p].value, oracle.bestResponse[p]); assert.ok(grade.gains[p] <= 0.01); }
  const restricted = tinyCollapsedGrade(tinyContinuationTable(game, result.averageStrategy), result.averageStrategy);
  near(restricted.value[0], grade.value[0]); near(restricted.value[1], grade.value[1]);
  const witness = tinyCheatingWitness(); assert.ok(witness.cheatingValue > witness.legalValue);
  const payload = { format: "poker-face-preflop-v2-tiny-reference", version: 1, researchContractHash: sha256(readFileSync(RESEARCH_CONTRACT)),
    sourceHashes: sourceHashes(TINY_SOURCES), input: TINY_INPUT, inputHash: hashJson(TINY_INPUT),
    interpretation: "Approximate CFR strategy for the specified nine-card joint game. Exact enumeration and independent legal best-response grading; not full-deck validation or exact GTO. Fixed continuation tables certify only restricted preflop deviations.",
    tree: { states: index.totalStates, terminals: index.terminalNodes, chanceNodes: index.chanceNodes, informationSets: index.informationSets.length },
    fixed, witness, solved: { iterations: 16384, algorithm: result.algorithm, value: grade.value,
      bestResponse: oracle.bestResponse, gains: grade.gains, exploitabilityChips: grade.exploitability, restricted,
      strategy: serializeBehavioralStrategy(result.averageStrategy) } };
  return { ...payload, payloadHash: hashJson(payload) };
}
export function auditSavedPreflight(report: PreflightReport) {
  const { measuredAt, baseCommit, nativeBinarySha256, machine } = report;
  assert.deepEqual(report, preflightReport(report.rows, { measuredAt, baseCommit, nativeBinarySha256, machine }));
  assert.equal(report.version, 1); assert.match(nativeBinarySha256, /^[a-f0-9]{64}$/); assert.match(baseCommit, /^[a-f0-9]{40}$/);
  return report.summary;
}
interface CalibrationReport {
  format: string; version: number; payloadHash: string; corpusHash: string; preflightHash: string;
  nativeBinarySha256: string; nativeInputHashes: Record<string, string>; sourceHashes: Record<string, string>;
  required: number; attempted: number; passed: number; elapsedMs: number; stopReason: string | null; complete: boolean;
  fittedModels: number; heldoutObservations: number; productionRangePromotion: boolean; rows: ContinuationObservation[];
}
export function auditSavedCalibration(report: CalibrationReport, preflight: PreflightReport) {
  const { payloadHash, ...payload } = report; assert.equal(payloadHash, hashJson(payload));
  assert.equal(report.format, "poker-face-preflop-v2-calibration"); assert.equal(report.version, 1);
  assert.equal(report.preflightHash, preflight.payloadHash); assert.equal(report.nativeBinarySha256, preflight.nativeBinarySha256);
  assert.deepEqual(report.nativeInputHashes, nativeInputHashes()); assert.deepEqual(report.sourceHashes, sourceHashes(CALIBRATION_SOURCES));
  const manifest = readValidationManifest(), roots = calibrationRoots(manifest);
  assert.equal(report.corpusHash, manifest.payloadHash); assert.equal(report.required, 144); assert.equal(report.attempted, report.rows.length);
  assert.ok(report.attempted > 0 && report.attempted <= 144); let elapsed = 0, passed = 0;
  for (const [i, row] of report.rows.entries()) {
    const root = roots[i], spot = corpusSpot(root, manifest);
    assert.equal(row.id, root.id); assert.equal(row.spotHash, root.spotHash); assert.equal(row.command, "solve"); assert.equal(row.threads, 8);
    assert.ok(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0); elapsed += row.elapsedMs;
    assert.ok(Number.isInteger(row.rssSamples) && row.rssSamples >= 0 && Number.isInteger(row.rssErrors) && row.rssErrors >= 0);
    assert.equal(row.sampledPeakRssBytes === null, row.rssSamples === 0);
    if (row.sampledPeakRssBytes !== null) assert.ok(Number.isSafeInteger(row.sampledPeakRssBytes) && row.sampledPeakRssBytes > 0);
    if (row.rawResult !== null) assert.equal(sha256(row.rawResult), row.resultHash); else assert.equal(row.resultHash, null);
    let checkpoint: ContinuationObservation["lastCheckpoint"] = null;
    for (const line of row.stderr.trim().split("\n")) try {
      const p = JSON.parse(line);
      if (p.type === "progress" && p.stage === "solving" && Number.isInteger(p.iteration) && p.iteration >= 0
        && Number.isFinite(p.exploitability) && Number.isFinite(p.elapsedMs)) checkpoint = { iteration: p.iteration, exploitability: p.exploitability, elapsedMs: p.elapsedMs };
    } catch { /* Raw non-JSON diagnostics remain evidence. */ }
    assert.deepEqual(row.lastCheckpoint, checkpoint);
    if (row.status === "passed") {
      assert.equal(row.error, undefined); assert.ok(row.rawResult !== null); checkContinuationResult(row.rawResult, spot);
      assert.ok(row.elapsedMs <= 600_000 && (row.sampledPeakRssBytes === null || row.sampledPeakRssBytes <= VALIDATION_BUDGETS.peakRssBytes)); passed++;
    } else { assert.equal(row.status, "failed"); assert.ok(row.error); assert.equal(i, report.rows.length - 1); assert.equal(report.stopReason, row.error); }
  }
  assert.equal(report.passed, passed); near(report.elapsedMs, elapsed);
  assert.equal(report.complete, passed === 144);
  if (report.complete) assert.equal(report.stopReason, null); else assert.ok(report.stopReason);
  assert.equal(report.fittedModels, 0); assert.equal(report.heldoutObservations, 0); assert.equal(report.productionRangePromotion, false);
  return { required: 144, attempted: report.attempted, passed, complete: report.complete, stopReason: report.stopReason,
    maximumSampledRssBytes: Math.max(...report.rows.map(r => r.sampledPeakRssBytes ?? 0)), elapsedMs: elapsed,
    fittedModels: 0, heldoutObservations: 0, productionRangePromotion: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); assert.ok(args.length <= 1 && (!args.length || ["--check", "--write-tiny"].includes(args[0])));
  const start = performance.now(), tiny = buildTinyReference(), elapsedMs = performance.now() - start, peakRssBytes = process.resourceUsage().maxRSS * 1024;
  assert.ok(elapsedMs <= 60_000 && peakRssBytes <= 512 * 1024 ** 2, `tiny budget failure: ${elapsedMs} ms, ${peakRssBytes} bytes`);
  if (args[0] === "--write-tiny") writeFileSync(`${ARTIFACTS}-tiny.json`, prettyJson(tiny), { flag: "wx" });
  else assert.equal(readFileSync(`${ARTIFACTS}-tiny.json`, "utf8"), prettyJson(tiny), "tiny artifact must reproduce byte for byte");
  console.log(JSON.stringify({ tiny: { payloadHash: tiny.payloadHash, ...tiny.tree, iterations: tiny.solved.iterations, gains: tiny.solved.gains,
    exploitabilityChips: tiny.solved.exploitabilityChips, elapsedMs, peakRssBytes } }));
  const preflight: PreflightReport = JSON.parse(readFileSync(`${ARTIFACTS}-preflight.json`, "utf8"));
  console.log(JSON.stringify({ preflight: auditSavedPreflight(preflight) }));
  if (args[0] !== "--write-tiny") console.log(JSON.stringify({ calibration: auditSavedCalibration(JSON.parse(readFileSync(`${ARTIFACTS}-calibration.json`, "utf8")), preflight) }));
}
