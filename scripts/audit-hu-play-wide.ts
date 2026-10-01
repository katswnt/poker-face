// Recompute observational claims; optionally reproduce all numeric solutions, never timings.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";
import { runBridgeSpot } from "./bridge-runner";
import { loadP1WideRoots, nativeMeasurementSpot, ratioMeasurementSpot, selectRatioCases,
  summarizeNativeRun, wideHash, P1_FROZEN_ADMISSION_HASH } from "./hu-play-wide-corpus";
import { estimateWideSpot } from "./measure-hu-play-wide-native";
import { extrapolateTimeBand, summarizeTimings } from "./hu-play-wide-analysis";
import { timingRatio } from "./hu-play-wide-measurement";
import { assessPlayProposal, PLAY_PROPOSAL } from "./hu-play-wide-proposal";
import type { WideBrowserMeasurement } from "./hu-play-wide-profile-page";

const PREFIX = "tasks/artifacts/hu-play-p1-wide-";
interface NativeRow extends ReturnType<typeof summarizeNativeRun> {
  corpusIndex: number; sourceSpotHash: string; street: "river" | "turn"; status: string;
  referee: ReturnType<typeof gradeRiverSubgame> | null;
}
interface BrowserRow extends WideBrowserMeasurement {
  browser: string; corpusIndex: number; street: "river" | "turn"; measurementSpotHash: string;
  passed: boolean; exactNativeParity: boolean; nativeSolveMs: number; nativeWallMs: number;
  baselineRssBytes: number; sampledPeakBrowserRssBytes: number; sampledIncrementRssBytes: number;
  maxSampleGapMs: number; solveSpeedRatio: ReturnType<typeof timingRatio>; endToEndSpeedRatio: number;
}
interface Report<R> {
  payloadHash: string; format: string; version: number; rows: R[]; mode?: string;
  sourceAdmissionHash?: string; sourceEstimateHash?: string; nativeReportHashes?: string[];
  buildHash?: string; sourceHash?: string;
}
type EstimateRow = Awaited<ReturnType<typeof estimateWideSpot>> & { corpusIndex: number; sourceSpotHash: string; street: "river" | "turn" };
function read<R>(name: string, format: string): Report<R> {
  const report = JSON.parse(readFileSync(`${PREFIX}${name}.json`, "utf8"));
  const { payloadHash, ...payload } = report;
  assert.equal(wideHash(payload), payloadHash, `${name}: payload hash`);
  assert.equal(report.version, 1); assert.equal(report.format, format);
  assert.ok(Array.isArray(report.rows)); return report;
}
function records() {
  return { estimates: read<EstimateRow>("native-estimates", "poker-face-p1-full-range-estimates"),
    nativeRivers: read<NativeRow>("native-rivers", "poker-face-p1-full-range-native-observations"),
    nativeTurns: read<NativeRow>("native-turns", "poker-face-p1-full-range-native-observations"),
    nativeRatios: read<NativeRow>("native-ratios", "poker-face-p1-full-range-native-observations"),
    browserRatios: read<BrowserRow>("browser-ratios", "poker-face-p1-full-range-browser-observations"),
    browserRivers: read<BrowserRow>("browser-rivers", "poker-face-p1-full-range-browser-observations"),
    browserTurns: read<BrowserRow>("browser-turns", "poker-face-p1-full-range-browser-observations") };
}
const indexes = (rows: { corpusIndex: number }[]) => rows.map(r => r.corpusIndex).sort((a, b) => a - b);
const browsers = ["chromium", "firefox", "webkit"] as const, streets = ["river", "turn"] as const;

export function auditWideRecords() {
  const reports = records(), roots = loadP1WideRoots();
  const native = [...reports.nativeRivers.rows, ...reports.nativeTurns.rows];
  const qualityRows = [...reports.browserRivers.rows, ...reports.browserTurns.rows];
  assert.deepEqual(indexes(reports.estimates.rows), indexes(roots));
  assert.deepEqual(indexes(native), indexes(roots));
  const ratioIndexes = selectRatioCases(reports.estimates.rows.map(r => ({ ...r, estimatedBytes: r.estimate.estimatedBytes }))).map(r => r.corpusIndex).sort((a, b) => a - b);
  assert.deepEqual(indexes(reports.nativeRatios.rows), ratioIndexes);
  assert.equal(reports.estimates.sourceAdmissionHash, P1_FROZEN_ADMISSION_HASH);
  for (const r of reports.estimates.rows) {
    const root = roots.find(x => x.corpusIndex === r.corpusIndex)!;
    assert.equal(r.sourceSpotHash, root.sourceSpotHash); assert.equal(r.estimate.spotHash, root.sourceSpotHash);
    assert.equal(r.iterations, 0); assert.equal(r.strategyStorageAllocated, false);
    assert.deepEqual(r.command, ["estimate"]);
    assert.deepEqual(r.estimate.hands, root.spot.ranges.map(x => x.combos.length));
  }
  for (const report of [reports.nativeRivers, reports.nativeTurns, reports.nativeRatios]) {
    assert.equal(report.sourceAdmissionHash, P1_FROZEN_ADMISSION_HASH);
    assert.equal(report.sourceEstimateHash, reports.estimates.payloadHash);
    const ratio = report === reports.nativeRatios;
    assert.equal(report.mode ?? "--solve", ratio ? "--ratio" : "--solve");
    for (const r of report.rows) {
      const root = roots.find(x => x.corpusIndex === r.corpusIndex)!;
      const spot = (ratio ? ratioMeasurementSpot : nativeMeasurementSpot)(root.spot);
      assert.equal(r.sourceSpotHash, root.sourceSpotHash); assert.equal(r.measurementSpotHash, hashBridgeSpot(spot));
      assert.equal(r.street, root.street); assert.equal(r.threads, 1); assert.equal(r.precision, "float32");
      assert.equal(r.targetPctPot, spot.solve.targetExploitabilityPctPot);
      assert.equal(r.exploitabilityPctPot, r.exploitabilityChips / spot.startingPot * 100);
      assert.equal(r.reached, r.exploitabilityChips <= spot.startingPot * r.targetPctPot / 100);
      if (ratio) assert.equal(r.status, "measured");
      else { assert.equal(r.status, "passed"); assert.equal(r.reached, true); }
      if (!ratio && root.street === "river") {
        assert.ok(r.referee); assert.ok(r.referee.localExploitabilityPctPot <= .3);
        assert.equal(r.referee.localExploitabilityPctPot, 100 * r.referee.ours.exploitability / spot.startingPot);
        assert.ok(Math.abs(r.referee.ours.exploitability - r.exploitabilityChips) <= .0002);
      } else assert.equal(r.referee, null);
    }
  }
  for (const report of [reports.browserRatios, reports.browserRivers, reports.browserTurns]) {
    const ratio = report === reports.browserRatios, expected = ratio ? reports.nativeRatios.rows : native;
    assert.equal(report.mode, ratio ? "ratio" : "quality");
    assert.equal(report.buildHash, reports.browserRatios.buildHash); assert.equal(report.sourceHash, reports.browserRatios.sourceHash);
    assert.deepEqual(report.nativeReportHashes, ratio ? [reports.nativeRatios.payloadHash] : [reports.nativeRivers.payloadHash, reports.nativeTurns.payloadHash]);
    for (const b of browsers) assert.deepEqual(indexes(report.rows.filter(r => r.browser === b)), ratio ? ratioIndexes
      : indexes(roots.filter(r => r.street === (report === reports.browserRivers ? "river" : "turn"))));
    assert.equal(report.rows.length, ratio ? 18 : 96);
    for (const r of report.rows) {
      const n = expected.find(x => x.corpusIndex === r.corpusIndex)!;
      assert.equal(r.status, "result"); assert.equal(r.passed, true); assert.equal(r.exactNativeParity, true);
      assert.equal(r.numericalHash, n.numericalHash); assert.equal(r.measurementSpotHash, n.measurementSpotHash);
      assert.equal(r.iterations, n.iterations); assert.equal(r.street, n.street);
      assert.equal(r.workers, 1); assert.equal(r.terminated, 1); assert.equal(r.isolated, false);
      assert.ok(r.peakLinearMemoryBytes! > 0 && r.peakLinearMemoryBytes! <= r.reservedTotalBytes!);
      assert.ok(r.sampledPeakBrowserRssBytes >= r.baselineRssBytes);
      assert.equal(r.sampledIncrementRssBytes, r.sampledPeakBrowserRssBytes - r.baselineRssBytes);
      assert.equal(r.nativeSolveMs, n.timings.solveMs); assert.equal(r.nativeWallMs, n.wallMs);
      assert.deepEqual(r.solveSpeedRatio, timingRatio(n.timings.solveMs, r.timings!.solveMs));
      assert.equal(r.endToEndSpeedRatio, r.terminalElapsedMs / n.wallMs);
      if (!ratio) { assert.equal(r.exploitability!.reached, true); assert.ok(r.exploitability!.pctPot <= .3); }
    }
  }
  const quality = streets.flatMap(street => browsers.map(browser => {
    const rows = qualityRows.filter(r => r.street === street && r.browser === browser);
    return { street, browser, terminalMs: summarizeTimings(rows.map(r => r.terminalElapsedMs)),
      peakLinearMemoryBytes: summarizeTimings(rows.map(r => r.peakLinearMemoryBytes!)),
      sampledBrowserPeakRssBytes: summarizeTimings(rows.map(r => r.sampledPeakBrowserRssBytes)),
      sampledBrowserIncrementRssBytes: summarizeTimings(rows.map(r => r.sampledIncrementRssBytes)),
      maximumSampleGapMs: Math.max(...rows.map(r => r.maxSampleGapMs)),
      minimumReservationToLinearRatio: Math.min(...rows.map(r => r.reservedTotalBytes! / r.peakLinearMemoryBytes!)),
      minimumReservationToSampledIncrementRatio: Math.min(...rows.map(r => r.reservedTotalBytes! / r.sampledIncrementRssBytes)) };
  }));
  const extrapolations = native.flatMap(n => browsers.map(browser => {
    const ratios = reports.browserRatios.rows.filter(r => r.street === n.street && r.browser === browser);
    const band = extrapolateTimeBand(n.timings.solveMs, ratios.map(r => r.solveSpeedRatio.ratio!),
      ratios.map(r => Math.max(0, r.terminalElapsedMs - r.timings!.solveMs)));
    const actual = qualityRows.find(r => r.corpusIndex === n.corpusIndex && r.browser === browser)!;
    return { corpusIndex: n.corpusIndex, street: n.street, browser, ...band, measuredTerminalMs: actual.terminalElapsedMs,
      withinEnvelope: actual.terminalElapsedMs >= band.lowerMs && actual.terminalElapsedMs <= band.upperMs,
      sizingRatioCase: ratioIndexes.includes(n.corpusIndex) };
  }));
  const proposal = (["desktop-chromium", "mobile", "unknown"] as const).map(profile => {
    const rows = qualityRows.map(r => {
      const root = roots.find(x => x.corpusIndex === r.corpusIndex)!;
      const estimate = reports.estimates.rows.find(x => x.corpusIndex === r.corpusIndex)!.estimate;
      const preflight = r.stages.find(s => s.stage === "allocating")?.linearMemoryBytes;
      assert.ok(preflight && preflight > 0);
      // Original input has P0's 1,000-iteration/60-second settings, not research budgets.
      // Every actual quality run converged before that iteration cap; no precision/game edit.
      const verdict = assessPlayProposal(root.spot, estimate, preflight, { profile });
      assert.ok(native.find(n => n.corpusIndex === root.corpusIndex)!.iterations <= PLAY_PROPOSAL.maxIterations);
      return { browser: r.browser, corpusIndex: r.corpusIndex, ok: verdict.ok,
        budgetBytes: verdict.budgetBytes, reservationBytes: verdict.totalBytes,
        headroomBytes: verdict.budgetBytes - verdict.totalBytes,
        coversObservedLinearMemory: verdict.totalBytes >= r.peakLinearMemoryBytes!,
        coversSampledBrowserIncrement: verdict.totalBytes >= r.sampledIncrementRssBytes };
    });
    return { profile, cases: rows.length, admitted: rows.filter(r => r.ok).length,
      allObservedLinearCovered: rows.every(r => r.coversObservedLinearMemory),
      allSampledBrowserIncrementsCovered: rows.every(r => r.coversSampledBrowserIncrement),
      largestReservationBytes: Math.max(...rows.map(r => r.reservationBytes)),
      smallestHeadroomBytes: Math.min(...rows.map(r => r.headroomBytes)), rows };
  });
  const result = { format: "poker-face-p1-wide-study-summary", version: 1,
    sourceReports: Object.fromEntries(Object.entries(reports).map(([name, r]) => [name, r.payloadHash])),
    nativeQualityCases: native.length, browserQualityCases: qualityRows.length, browserRatioCases: reports.browserRatios.rows.length,
    fullRangeRetention: 1, productionP1GatePassed: false, physicalDevicesMeasured: false,
    meaning: "Full frozen ranges only; local engine target with independent river grades. Desktop observations, not production P1 or phone certification. Timing envelopes use representative solve ratios plus observed overhead; not confidence intervals or fitted p95. Nearest-rank quantiles, one run per case.",
    quality, extrapolations, proposal: { limits: PLAY_PROPOSAL, observations: proposal,
      meaning: "Candidate evaluated against the frozen original 1,000-iteration inputs with measured preflight high-water from all three desktop browsers. Not implemented in production; mobile outcomes are desktop-envelope calculations, not phone measurements. Real-source P1 gates still required." } };
  return { ...result, payloadHash: wideHash(result) };
}

async function reproduceNative() {
  const r = records(), roots = loadP1WideRoots();
  for (const root of roots) {
    const expected = r.estimates.rows.find(x => x.corpusIndex === root.corpusIndex)!;
    const estimate = await estimateWideSpot(root.spot);
    assert.deepEqual(estimate.estimate, expected.estimate, `root ${root.corpusIndex}: estimate reproduction`);
  }
  for (const report of [r.nativeRivers, r.nativeTurns, r.nativeRatios]) for (const expected of report.rows) {
    const root = roots.find(x => x.corpusIndex === expected.corpusIndex)!;
    const spot = (report === r.nativeRatios ? ratioMeasurementSpot : nativeMeasurementSpot)(root.spot);
    const run = await runBridgeSpot(spot, { threads: 1 }), actual = summarizeNativeRun(spot, run);
    assert.equal(actual.numericalHash, expected.numericalHash, `root ${root.corpusIndex}: numerical reproduction`);
    if (expected.referee) {
      const grade = gradeRiverSubgame({ hands: run.result.hands, startingPot: spot.startingPot,
        subtree: { path: [], nodes: run.result.tree, reach: [spot.ranges[0].combos.map(c => c.weight), spot.ranges[1].combos.map(c => c.weight)],
          ev: run.result.root.engineEv } });
      const { elapsedMs, ...math } = grade, { elapsedMs: oldElapsed, ...oldMath } = expected.referee; void elapsedMs; void oldElapsed;
      assert.deepEqual(math, oldMath, `root ${root.corpusIndex}: independent river reproduction`);
    }
    console.log(JSON.stringify({ nativeReproduction: root.corpusIndex, ratio: report === r.nativeRatios, passed: true }));
  }
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length > 0 && args.every(a => ["--check", "--write-summary", "--native"].includes(a)) && new Set(args).size === args.length);
  assert.ok(!(args.includes("--check") && args.includes("--write-summary")));
  const summary = auditWideRecords(), path = `${PREFIX}summary.json`, bytes = JSON.stringify(summary, null, 2) + "\n";
  if (args.includes("--write-summary")) writeFileSync(path, bytes, { flag: "wx" });
  if (args.includes("--check")) assert.equal(readFileSync(path, "utf8"), bytes, "Study summary must reproduce byte for byte");
  if (args.includes("--native")) await reproduceNative();
  console.log(JSON.stringify({ audit: "p1-wide-study", passed: true, payloadHash: summary.payloadHash,
    nativeReproduced: args.includes("--native"), browserTimingReproduced: false }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
