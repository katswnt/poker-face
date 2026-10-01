import assert from "node:assert/strict";
import test from "node:test";
import estimates from "../tasks/artifacts/hu-play-p1-wide-native-estimates.json";
import rivers from "../tasks/artifacts/hu-play-p1-wide-native-rivers.json";
import turns from "../tasks/artifacts/hu-play-p1-wide-native-turns.json";
import ratios from "../tasks/artifacts/hu-play-p1-wide-native-ratios.json";
import browsers from "../tasks/artifacts/hu-play-p1-wide-browser-ratios.json";
import { loadP1WideRoots, nativeMeasurementSpot, ratioMeasurementSpot, wideHash, P1_FROZEN_ADMISSION_HASH, selectRatioCases } from "../scripts/hu-play-wide-corpus";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { summarizeTimings, extrapolateTimeBand } from "../scripts/hu-play-wide-analysis";
import { timingRatio } from "../scripts/hu-play-wide-measurement";
import { auditWideRecords } from "../scripts/audit-hu-play-wide";

test("timing analysis uses nearest-rank observations; extrapolations are bands with separately measured overhead", () => {
  assert.deepEqual(summarizeTimings([1, 10, 2, 3, 4]), { count: 5, min: 1, p50: 3, p95: 10, max: 10 });
  assert.deepEqual(extrapolateTimeBand(100, [2, 4, 3], [10, 20, 30]), { lowerMs: 210, upperMs: 430 });
  assert.throws(() => summarizeTimings([]), /empty/i);
  assert.throws(() => summarizeTimings([NaN]), /finite/i);
  assert.throws(() => extrapolateTimeBand(10, [], [1]), /empty/i);
});

test("wide observations bind the frozen full games and independently recomputable numeric claims", () => {
  for (const report of [estimates, rivers, turns, ratios, browsers]) {
    const { payloadHash, ...payload } = report;
    assert.equal(wideHash(payload), payloadHash);
  }
  const roots = loadP1WideRoots();
  assert.equal(estimates.rows.length, 64);
  assert.equal(rivers.rows.length, 32); assert.equal(turns.rows.length, 32);
  assert.deepEqual(ratios.rows.map(r => r.corpusIndex).sort((a, b) => a - b),
    selectRatioCases(estimates.rows.map(r => {
      assert.ok(r.street === "river" || r.street === "turn");
      return { corpusIndex: r.corpusIndex, street: r.street, estimatedBytes: r.estimate.estimatedBytes };
    })).map(r => r.corpusIndex).sort((a, b) => a - b));
  for (const report of [rivers, turns, ratios]) {
    assert.equal(report.sourceAdmissionHash, P1_FROZEN_ADMISSION_HASH);
    assert.equal(report.sourceEstimateHash, estimates.payloadHash);
    for (const r of report.rows) {
      const original = roots.find(x => x.corpusIndex === r.corpusIndex)!;
      const spot = (report === ratios ? ratioMeasurementSpot : nativeMeasurementSpot)(original.spot);
      assert.equal(r.sourceSpotHash, original.sourceSpotHash);
      assert.equal(r.measurementSpotHash, hashBridgeSpot(spot));
      assert.equal(r.exploitabilityPctPot, r.exploitabilityChips / spot.startingPot * 100);
      assert.equal(r.reached, r.exploitabilityChips <= spot.startingPot * r.targetPctPot / 100);
      assert.equal(r.threads, 1); assert.equal(r.precision, "float32");
      if (report !== ratios) { assert.equal(r.status, "passed"); assert.equal(r.reached, true); assert.equal(r.targetPctPot, .3); }
      else { assert.equal(r.status, "measured"); assert.equal(r.iterations, spot.solve.maxIterations); }
    }
  }
  for (const r of rivers.rows) {
    assert.ok(r.referee.localExploitabilityPctPot <= .3);
    const root = roots.find(x => x.corpusIndex === r.corpusIndex)!;
    assert.equal(r.referee.localExploitabilityPctPot, 100 * r.referee.ours.exploitability / root.spot.startingPot);
  }
  assert.equal(browsers.rows.length, 18);
  assert.deepEqual(browsers.nativeReportHashes, [ratios.payloadHash]);
  for (const r of browsers.rows) {
    const n = ratios.rows.find(x => x.corpusIndex === r.corpusIndex)!;
    assert.equal(r.passed, true); assert.equal(r.numericalHash, n.numericalHash);
    assert.equal(r.iterations, n.iterations); assert.equal(r.measurementSpotHash, n.measurementSpotHash);
    assert.equal(r.sampledIncrementRssBytes, r.sampledPeakBrowserRssBytes - r.baselineRssBytes);
    assert.ok(r.peakLinearMemoryBytes <= r.reservedTotalBytes);
    assert.deepEqual(r.solveSpeedRatio, timingRatio(n.timings.solveMs, r.timings.solveMs));
    assert.equal(r.endToEndSpeedRatio, r.terminalElapsedMs / n.wallMs);
  }
});

test("the published wider-range summary requires all 64 native and 192 browser quality observations", () => {
  const report = auditWideRecords();
  assert.equal(report.nativeQualityCases, 64);
  assert.equal(report.browserQualityCases, 192);
  assert.equal(report.browserRatioCases, 18);
  assert.equal(report.fullRangeRetention, 1);
  assert.equal(report.productionP1GatePassed, false);
  assert.equal(report.physicalDevicesMeasured, false);
  assert.equal(report.quality.length, 6);
  assert.equal(report.extrapolations.length, 192);
  assert.equal(report.proposal.limits.productionEnabled, false);
  for (const p of report.proposal.observations) {
    assert.equal(p.cases, 192); assert.equal(p.admitted, 192);
    assert.equal(p.allObservedLinearCovered, true);
    assert.equal(p.allSampledBrowserIncrementsCovered, true);
  }
});
