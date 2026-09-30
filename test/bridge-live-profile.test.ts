import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildLiveSizingGrid } from "../scripts/bridge-live-grid";
import { browserTreeRssBytes, scopedBrowserRss, summarizeMeasuredJob } from "../scripts/bridge-live-measurement";
import { parseLiveSpot } from "../src/lib/solver/bridge/live/admission";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import type { BrowserJobMeasurement } from "../scripts/bridge-live-profile-page";

test("browser measurement grid preserves all 24 bounded W2 inputs without broadening admission", () => {
  const grid = buildLiveSizingGrid(100);
  assert.equal(grid.length, 24); assert.equal(new Set(grid.map(s => s.id)).size, 24);
  for (const s of grid) {
    assert.equal(parseLiveSpot(JSON.stringify(s)).id, s.id);
    assert.equal(s.solve.maxIterations, 100); assert.equal(s.solve.compression, "off");
    const width = Number(s.id.split("-")[2]);
    assert.ok([4, 16, 64].includes(width));
    assert.equal(s.ranges[0].combos.length, width); assert.deepEqual(s.ranges[0], s.ranges[1]);
    assert.equal(new Set(s.ranges[0].combos.map(h => h.combo)).size, width);
    assert.ok(s.ranges[0].combos.every(h => h.weight === 1));
  }
  assert.deepEqual(buildLiveSizingGrid(), buildLiveSizingGrid(10));
  assert.throws(() => buildLiveSizingGrid(0), /Invalid measurement/);
  assert.throws(() => buildLiveSizingGrid(10001), /Invalid measurement/);
});

test("browser RSS includes only the rooted process tree, even with unordered grandchildren", () => {
  const ps = " 13 12 30\n 99 1 9000\n 12 11 20\n 11 1 10\n 14 11 40\n";
  assert.equal(browserTreeRssBytes(ps, 11), (10 + 20 + 30 + 40) * 1024);
  assert.equal(browserTreeRssBytes(ps, 12), (20 + 30) * 1024);
  assert.throws(() => browserTreeRssBytes(ps, 42), /missing/);
  for (const invalid of ["11 1 NaN", "11 1 -1", "11 1 1\n11 1 2", "11 1 2 extra"]) {
    assert.throws(() => browserTreeRssBytes(invalid, 11));
  }
});

test("measured job uses fresh post-export memory observations, not stale solve status", () => {
  const events = [
    { type: "estimate", verdict: { ok: true, totalBytes: 200, budgetBytes: 256 }, observedLinearMemoryBytes: 10 },
    { type: "progress", stage: "solving", status: { linearMemoryBytes: 20 }, observedLinearMemoryBytes: 20 },
    { type: "progress", stage: "checking", status: { linearMemoryBytes: 20 }, observedLinearMemoryBytes: 80 },
    { type: "result", result: { iterations: 100, exploitability: { chips: .01 }, counts: { exportedNodes: 9 } }, observedLinearMemoryBytes: 80 },
  ];
  assert.deepEqual(summarizeMeasuredJob(events, 123), { admitted: true, terminalElapsedMs: 123,
    peakLinearMemoryBytes: 80, reservedTotalBytes: 200, budgetBytes: 256, iterations: 100,
    exploitabilityChips: .01, exportedNodes: 9 });
  assert.throws(() => summarizeMeasuredJob(events.slice(0, -1), 123), /result/);
  assert.throws(() => summarizeMeasuredJob(events, -1), /elapsed/);
});

test("macOS WebKit XPC companions are included, but old or other-bundle processes are not", () => {
  const ps = "11 1 10 /bundle/browser\n12 11 20 /other/helper\n13 1 50 /bundle/WebContent\n"
    + "99 1 900 /bundle/old-process\n14 1 800 /bundle-other/WebContent\n";
  assert.deepEqual(scopedBrowserRss(ps, 11, { directory: "/bundle", preexistingPids: [99] }),
    { rssBytes: 80 * 1024, companionProcesses: 1 });
});

test("refused measurement reports no solve, and errors or missing memory cannot look successful", () => {
  const refusal = [{ type: "estimate", verdict: { ok: false, totalBytes: 300, budgetBytes: 256 }, observedLinearMemoryBytes: 10 }];
  assert.deepEqual(summarizeMeasuredJob(refusal, 12), { admitted: false, terminalElapsedMs: 12,
    peakLinearMemoryBytes: 10, reservedTotalBytes: 300, budgetBytes: 256, iterations: null,
    exploitabilityChips: null, exportedNodes: null });
  assert.throws(() => summarizeMeasuredJob([...refusal, { type: "error", message: "trap" }], 12));
  assert.throws(() => summarizeMeasuredJob([{ ...refusal[0], observedLinearMemoryBytes: null }], 12), /memory/);
});

test("published W3 observations cover the hash-bound grid and distinguish memory measures", () => {
  const report: { format: string; version: number; sourceHash: string; inputGridHash: string;
    rows: (BrowserJobMeasurement & { browser: string; id: string; spotHash: string; baselineRssBytes: number;
      sampledPeakBrowserRssBytes: number; samples: number; companionProcesses: number })[] } =
    JSON.parse(readFileSync("src/lib/solver/bridge/artifacts/wasm-w3-m1-pro.json", "utf8"));
  const grid = buildLiveSizingGrid(100), spots = new Map(grid.map(s => [s.id, s]));
  assert.equal(report.format, "poker-face-browser-observations"); assert.equal(report.version, 1);
  assert.match(report.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(report.inputGridHash, createHash("sha256").update(canonicalSolverJson(grid)).digest("hex"));
  assert.equal(report.rows.length, 72); assert.equal(new Set(report.rows.map(r => `${r.browser}/${r.id}`)).size, 72);
  for (const browser of ["chromium", "firefox", "webkit"]) {
    const rows = report.rows.filter(r => r.browser === browser);
    assert.equal(rows.length, 24); assert.equal(rows.filter(r => r.admitted).length, 21);
    for (const row of rows) {
      const spot = spots.get(row.id); assert.ok(spot); assert.equal(row.spotHash, hashBridgeSpot(spot));
      assert.equal(row.admitted, !/^w2-turn-\d+-full-wide$/.test(row.id));
      assert.equal(row.workers, 1); assert.equal(row.terminated, 1); assert.equal(row.isolated, false);
      assert.ok(row.terminalElapsedMs > 0 && row.terminalElapsedMs <= spot.solve.timeoutMs);
      assert.ok(row.peakLinearMemoryBytes > 0); assert.ok(row.samples >= 2);
      assert.ok(row.sampledPeakBrowserRssBytes >= row.baselineRssBytes && row.baselineRssBytes > 0);
      if (browser === "webkit") assert.ok(row.companionProcesses > 0, "M1 record includes XPC processes");
      if (row.admitted) {
        assert.ok(row.reservedTotalBytes <= row.budgetBytes); assert.ok(row.iterations! <= 100);
        assert.match(row.digest!, /^[a-f0-9]{64}$/);
        assert.equal(row.digest, report.rows.find(r => r.browser === "chromium" && r.id === row.id)!.digest);
      } else { assert.equal(row.iterations, null); assert.equal(row.digest, null); }
    }
  }
});
