/** P2 cheapest-first experiment. Freeze all 200 public requests BEFORE any off-tree solve.
 * This is engine feasibility, not the production-source, fallback or safety-margin gate.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { BRIDGE_BINARY, runBridgeSpot } from "./bridge-runner";
import { loadP1ProductionRoots } from "./hu-play-p1-corpus";
import { makeRiverOffTreeCase } from "./hu-play-p2-corpus";
import { wideHash } from "./hu-play-wide-corpus";
import { mathProjection } from "./hu-play-wide-measurement";
import { buildNestedRiverSpot } from "../src/lib/hu-play/river-tree";
import { requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { gradeRiverHands } from "../src/lib/solver/bridge/river-hand-values";
import { admitBrowserSolve, parseLiveEstimate } from "../src/lib/solver/bridge/live/admission";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";

const execute = promisify(execFile);
const write = (p: string, value: unknown) => writeFileSync(p, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function main() {
  const args = process.argv.slice(2); assert.ok(args.length === 2 && args[0] === "--out", "Use --out NEW_DIRECTORY");
  const directory = resolve(args[1]); assert.ok(!existsSync(directory)); mkdirSync(directory);
  const roots = loadP1ProductionRoots().filter(r => r.street === "river"); assert.equal(roots.length, 32);
  const locked = JSON.parse(readFileSync("tasks/artifacts/hu-play-p1-production-corpus.json", "utf8"));
  const baselines: BridgeResultV1[] = [];
  for (const root of roots) {
    const { result } = await runBridgeSpot(root.playingSpot, { threads: 1 });
    requirePlayingResult(result, root.playingSpot, hashBridgeSpot(root.playingSpot));
    assert.equal(wideHash(mathProjection(result)), locked.rows.find((r: { corpusIndex: number }) => r.corpusIndex === root.corpusIndex).numericalHash,
      "P2 bridge changed a frozen P1 river result");
    baselines.push(result); write(join(directory, `baseline-${root.corpusIndex}.json`), { spot: root.playingSpot, result });
  }
  const cases = Array.from({ length: 200 }, (_, seed) => {
    const i = seed % 32, c = makeRiverOffTreeCase(seed, roots[i].request, baselines[i]);
    const spot = buildNestedRiverSpot(c.request, c.actual);
    return { ...c, rootCorpusIndex: roots[i].corpusIndex, baselineHash: baselines[i].spotHash, spot, spotHash: hashBridgeSpot(spot) };
  });
  assert.equal(new Set(cases.map(c => c.spotHash)).size, 200, "The corpus must have 200 distinct off-tree games");
  const sourcePaths = ["scripts/hu-play-p2-corpus.ts", "src/lib/hu-play/river-tree.ts"];
  const sourceFiles = sourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  const corpus = { format: "poker-face-p2-river-inputs", version: 1, sourceFiles, cases };
  write(join(directory, "inputs.json"), { ...corpus, payloadHash: wideHash(corpus) });
  // This file is complete and closed before the first off-tree estimate/solve.
  const observations = [];
  for (const c of cases) {
    console.error(JSON.stringify({ type: "case", seed: c.seed, category: c.category, prefix: c.baselinePath }));
    const path = join(directory, `case-${c.seed}.spot.json`); writeFileSync(path, canonicalBridgeSpotJson(c.spot), { flag: "wx" });
    const started = performance.now();
    try {
      const { stdout } = await execute(BRIDGE_BINARY, ["estimate", path], { timeout: 60000, maxBuffer: 1024 ** 2,
        env: { ...process.env, RAYON_NUM_THREADS: "1" } });
      const estimate = parseLiveEstimate(stdout, c.spot, c.spotHash);
      // Numerical reservation only. Zero is NOT a WASM preflight measurement or browser approval.
      const reservation = admitBrowserSolve(estimate, { profile: "unknown" }, 0, "play-v1");
      const run = await runBridgeSpot(c.spot, { threads: 1 });
      write(join(directory, `case-${c.seed}.result.json`), run.result);
      const grade = gradeRiverHands(c.spot, run.result);
      let targetError: string | null = null;
      try { requirePlayingResult(run.result, c.spot, c.spotHash); } catch (e) { targetError = String(e); }
      observations.push({ seed: c.seed, spotHash: c.spotHash, estimate, reservation, status: targetError ? "target-missed" : "solved",
        targetError, iterations: run.result.iterations, enginePctPot: run.result.exploitability.pctPot,
        numericalHash: wideHash(mathProjection(run.result)), grade, solveElapsedMs: run.elapsedMs,
        estimateSolveGradeElapsedMs: performance.now() - started, sampledPeakRssBytes: run.sampledPeakRssBytes });
    } catch (e) { observations.push({ seed: c.seed, spotHash: c.spotHash, status: "failed", error: String(e), elapsedMs: performance.now() - started }); }
  }
  const report = { format: "poker-face-p2-native-feasibility", version: 1, measuredAt: new Date().toISOString(),
    machine: { cpu: cpus()[0].model, osRelease: release(), node: process.version }, inputsHash: wideHash(corpus),
    nativeBinarySha256: createHash("sha256").update(readFileSync(BRIDGE_BINARY)).digest("hex"),
    interpretation: "Frozen engine experiment, not production Worker/fallback/safety verification. Native preflight has no WASM high-water measurement. No physical-phone certificate.", observations };
  write(join(directory, "report.json"), { ...report, payloadHash: wideHash(report) });
  console.log(JSON.stringify({ directory, cases: cases.length, solved: observations.filter(o => o.status === "solved").length,
    failed: observations.filter(o => o.status !== "solved").map(o => ({ seed: o.seed, status: o.status })) }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
