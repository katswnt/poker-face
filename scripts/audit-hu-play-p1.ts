/** Recompute P1 gates from immutable observations; optionally compare a fresh reproduction.
 * Clock/RSS observations are historical measurements, not reproducibility assertions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadP1ProductionRoots } from "./hu-play-p1-corpus";
import { P1_FROZEN_ADMISSION_HASH, wideHash } from "./hu-play-wide-corpus";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";

interface Hashed { format: string; version: number; payloadHash: string }
interface Hands extends Hashed {
  seeds: { first: number; count: number };
  sourceSnapshot: { baseCommit: string; sourceFiles: { path: string; sha256: string }[] }; sourceSnapshotHash: string;
  hands: { seed: number; aiSeat: number; logHash: string; deterministicReplay: boolean; conserved: boolean;
    ledger: { finalStacks: number[]; netSinceBeforeBlinds: number[]; externalDeadBlind: number } }[];
  solves: { seed: number; street: string; spotHash: string; numericalHash: string; iterations: number; reached: boolean; enginePctPot: number }[];
  riverGrades: { seed: number; spotHash: string; grade: { localExploitabilityPctPot: number; elapsedMs: number } }[];
}
interface Corpus extends Hashed {
  sourceAdmissionHash: string; medianIndependentExploitabilityPctPot: number;
  rows: { corpusIndex: number; seed: number; street: string; sourceSpotHash: string; playingSpotHash: string;
    numericalHash: string; completeNumericalHash: string; firstStreetHash: string; fullRangeHands: number[];
    retainedReachMass: number[]; prunedMass: number[]; rung: string; aiSeat: number; aiHands: string[];
    aiPerHandEvDifferenceChips: number[]; iterations: number; enginePctPot: number; independentExploitabilityPctPot: number;
    grade: { exploitabilityPctPot?: number; localExploitabilityPctPot?: number; elapsedMs?: number }; passed: boolean }[];
}
interface Browser extends Hashed {
  nativeReportHash: string; passed: boolean;
  rows: { browser: string; corpusIndex: number; street: string; passed: boolean; error: string | null;
    elapsedMs: number; numericalHash: string; exactNativeParity: boolean; workers: number; terminated: number; isolated: boolean;
    reservedBytes: number; budgetBytes: number }[];
  summaries: { browser: string; street: string; n: number; p50Ms: number; p95Ms: number; maxMs: number; chromiumP95BudgetMs: number }[];
}
const paths = ["hands", "corpus", "browser"].map(n => `tasks/artifacts/hu-play-p1-production-${n}.json`);
const summaryPath = "tasks/artifacts/hu-play-p1-production-summary.json";
function bound(report: Hashed, format: string) {
  const { payloadHash, ...payload } = report;
  assert.equal(report.version, 1); assert.equal(report.format, format);
  assert.equal(wideHash(payload), payloadHash, `${format} payload hash`);
}

export function checkP1Reports(hands: Hands, corpus: Corpus, browser: Browser) {
  bound(hands, "poker-face-p1-production-hands"); bound(corpus, "poker-face-p1-production-corpus"); bound(browser, "poker-face-p1-production-browser");
  assert.equal(wideHash(hands.sourceSnapshot), hands.sourceSnapshotHash, "Source snapshot hash");
  for (const ref of hands.sourceSnapshot.sourceFiles) {
    assert.match(ref.path, /^(scripts|src)\/[a-zA-Z0-9/._-]+\.ts$/); assert.ok(!ref.path.includes(".."));
    assert.equal(createHash("sha256").update(readFileSync(ref.path)).digest("hex"), ref.sha256, `Audited source changed: ${ref.path}`);
  }
  assert.deepEqual(hands.seeds, { first: 0, count: 1000 }); assert.equal(hands.hands.length, 1000);
  hands.hands.forEach((h, seed) => {
    assert.equal(h.seed, seed); assert.equal(h.aiSeat, seed % 2); assert.match(h.logHash, /^[a-f0-9]{64}$/);
    assert.ok(h.deterministicReplay && h.conserved); assert.equal(h.ledger.externalDeadBlind, 50);
    assert.equal(h.ledger.finalStacks.length, 2); assert.ok(h.ledger.finalStacks.every(n => Number.isSafeInteger(n) && n >= 0));
    assert.equal(h.ledger.finalStacks[0] + h.ledger.finalStacks[1], 20050);
    assert.deepEqual(h.ledger.netSinceBeforeBlinds, h.ledger.finalStacks.map(s => s - 10000));
  });
  const firstRivers = [...new Set(hands.solves.filter(s => s.street === "river").map(s => s.spotHash))].slice(0, 32);
  assert.equal(hands.riverGrades.length, 32); assert.deepEqual(hands.riverGrades.map(g => g.spotHash), firstRivers);
  for (const s of hands.solves) {
    assert.ok(Number.isSafeInteger(s.seed) && s.seed >= 0 && s.seed < 1000);
    assert.ok(s.reached && Number.isSafeInteger(s.iterations) && s.iterations <= 1000 && s.iterations >= 0);
    assert.ok(s.enginePctPot >= 0 && s.enginePctPot <= .3); assert.match(s.numericalHash, /^[a-f0-9]{64}$/);
  }
  for (const r of hands.riverGrades) assert.ok(r.grade.localExploitabilityPctPot >= 0 && r.grade.localExploitabilityPctPot <= .3);
  const roots = loadP1ProductionRoots();
  assert.equal(corpus.sourceAdmissionHash, P1_FROZEN_ADMISSION_HASH); assert.equal(corpus.rows.length, 64);
  corpus.rows.forEach((r, i) => {
    const root = roots[i]; assert.equal(r.corpusIndex, root.corpusIndex); assert.equal(r.seed, root.seed); assert.equal(r.street, root.street);
    assert.equal(r.sourceSpotHash, root.sourceSpotHash); assert.equal(r.playingSpotHash, hashBridgeSpot(root.playingSpot));
    assert.deepEqual(r.fullRangeHands, root.spot.ranges.map(p => p.combos.length));
    assert.deepEqual(r.retainedReachMass, [1, 1]); assert.deepEqual(r.prunedMass, [0, 0]); assert.equal(r.rung, "full");
    assert.equal(r.aiSeat, root.request.aiSeat); assert.deepEqual(r.aiHands, root.spot.ranges[r.aiSeat].combos.map(h => h.combo));
    assert.equal(r.aiPerHandEvDifferenceChips.length, r.aiHands.length); assert.ok(r.aiPerHandEvDifferenceChips.every(v => v === 0));
    assert.ok(r.passed && r.enginePctPot >= 0 && r.enginePctPot <= .3 && r.iterations >= 0 && r.iterations <= 1000);
    const pct = r.grade.exploitabilityPctPot ?? r.grade.localExploitabilityPctPot;
    assert.equal(r.independentExploitabilityPctPot, pct); assert.ok(Number.isFinite(pct) && pct! >= 0);
    if (r.street === "river") assert.ok(pct! <= .3);
  });
  const pcts = corpus.rows.map(r => r.independentExploitabilityPctPot).sort((a, b) => a - b), median = (pcts[31] + pcts[32]) / 2;
  assert.equal(corpus.medianIndependentExploitabilityPctPot, median); assert.ok(median <= 1);
  assert.equal(browser.nativeReportHash, corpus.payloadHash); assert.equal(browser.passed, true);
  const browsers = [...new Set(browser.rows.map(r => r.browser))]; assert.ok(browsers.includes("chromium"));
  const summaries = browsers.flatMap(name => (["river", "turn"] as const).map(street => {
    const rows = browser.rows.filter(r => r.browser === name && r.street === street);
    assert.equal(rows.length, 32); assert.equal(new Set(rows.map(r => r.corpusIndex)).size, 32);
    for (const r of rows) {
      const expected = corpus.rows.find(c => c.corpusIndex === r.corpusIndex)!; assert.ok(expected);
      assert.equal(r.street, expected.street); assert.equal(r.numericalHash, expected.numericalHash);
      assert.ok(r.passed && r.exactNativeParity && r.error === null && r.workers === 1 && r.terminated === 1 && !r.isolated);
      assert.ok(r.reservedBytes > 0 && r.reservedBytes <= r.budgetBytes && r.budgetBytes <= 192 * 1024 ** 2);
      assert.ok(Number.isFinite(r.elapsedMs) && r.elapsedMs > 0 && r.elapsedMs < 120000);
    }
    const t = rows.map(r => r.elapsedMs).sort((a, b) => a - b), budget = street === "river" ? 2000 : 10000;
    const summary = { browser: name, street, n: 32, p50Ms: (t[15] + t[16]) / 2, p95Ms: t[30], maxMs: t[31], chromiumP95BudgetMs: budget };
    if (name === "chromium") assert.ok(summary.p95Ms <= budget);
    return summary;
  }));
  assert.deepEqual(browser.summaries, summaries);
  return { format: "poker-face-p1-production-summary", version: 1, evidenceHashes: [hands.payloadHash, corpus.payloadHash, browser.payloadHash],
    hands: hands.hands.length, solves: hands.solves.length, productionRiverGrades: hands.riverGrades.length,
    productionRiverMaxPctPot: Math.max(...hands.riverGrades.map(r => r.grade.localExploitabilityPctPot)),
    roots: roots.length, minimumRetainedReachMass: 1, maxPerHandEvDifferenceChips: 0,
    medianIndependentPctPot: median, maximumIndependentPctPot: pcts.at(-1), latency: summaries,
    limits: "Full-range local games only; scripted preflop, hand-written ranges, 12 saved flops. No phone certificate or global safety guarantee." };
}

/** Numerical/log identity only; never require wall clocks, RSS or run timestamps to match. */
function handsProjection(r: Hands) {
  return { hands: r.hands, solves: r.solves.map(s => ({ seed: s.seed, street: s.street, spotHash: s.spotHash,
    numericalHash: s.numericalHash, iterations: s.iterations, reached: s.reached, enginePctPot: s.enginePctPot })),
  riverGrades: r.riverGrades.map(({ grade, ...row }) => { const { elapsedMs, ...math } = grade; void elapsedMs; return { ...row, grade: math }; }) };
}
function corpusProjection(r: Corpus) {
  return r.rows.map(row => { const { elapsedMs, ...grade } = row.grade; void elapsedMs;
    return { corpusIndex: row.corpusIndex, playingSpotHash: row.playingSpotHash, numericalHash: row.numericalHash,
      completeNumericalHash: row.completeNumericalHash, firstStreetHash: row.firstStreetHash, grade }; });
}
function main() {
  const args = process.argv.slice(2), mode = args[0];
  assert.ok(mode === "--capture" && args.length === 4 || mode === "--check" && args.length === 1
    || ["--compare-hands", "--compare-corpus"].includes(mode) && args.length === 2, "Use --capture HANDS_DIR CORPUS_DIR BROWSER_DIR | --check | --compare-hands DIR | --compare-corpus DIR");
  const reports = (mode === "--capture" ? args.slice(1).map(d => join(d, "report.json")) : paths).map(p => JSON.parse(readFileSync(p, "utf8")));
  const [hands, corpus, browser] = reports as [Hands, Corpus, Browser];
  const summary = checkP1Reports(hands, corpus, browser);
  if (mode === "--capture") {
    reports.forEach((r, i) => writeFileSync(paths[i], JSON.stringify(r, null, 2) + "\n", { flag: "wx" }));
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  } else {
    assert.deepEqual(summary, JSON.parse(readFileSync(summaryPath, "utf8")));
    if (mode.startsWith("--compare-")) {
      const fresh = JSON.parse(readFileSync(join(args[1], "report.json"), "utf8"));
      if (mode === "--compare-hands") { bound(fresh, hands.format); assert.deepEqual(handsProjection(fresh), handsProjection(hands)); }
      else { bound(fresh, corpus.format); assert.deepEqual(corpusProjection(fresh), corpusProjection(corpus)); }
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
