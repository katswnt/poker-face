// Read-only PF3 diagnosis: prints JSON, never rewrites a solver artifact or library range.
// node --import tsx scripts/diagnose-preflop.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PreflopResultV1, RealizationTableV1 } from "../src/lib/solver/preflop/contract";
import { bbCallTrace, defenceCoverage, fitResiduals, ratioAdjustmentCounterexample } from "../src/lib/solver/preflop/diagnostics";
import { hashRealizationTable } from "../src/lib/solver/preflop/hash";
import { loadLibraryRoots } from "../src/lib/solver/preflop/library-inputs";
import { pf3Spot } from "../src/lib/solver/preflop/published";
import { mapRealizationTable, unitRealizationTable } from "../src/lib/solver/preflop/realization";
import { DEFAULT_FIT_OPTIONS, fitRealization, measureLibrary, realizationSamples, type RealizationFit } from "../src/lib/solver/preflop/realization-fit";
import { rangeL1 } from "../src/lib/solver/preflop/report";
import { solvePreflop, validatePreflopResult } from "../src/lib/solver/preflop/solve";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
if (process.argv.length > 2) throw new Error("Usage: diagnose-preflop.ts (read-only; no arguments)");
const ART = path.join(ROOT, "src/lib/solver/preflop/artifacts");
const hash = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const read = (name: string) => readFileSync(path.join(ART, name));
const lockBytes = read("lock.json"), lock = JSON.parse(lockBytes.toString()) as { files: Record<string, string> };
for (const [name, expected] of Object.entries(lock.files)) {
  if (hash(read(name)) !== expected) throw new Error(`published input changed: ${name}; run audit:preflop`);
}
const baseline = JSON.parse(read("pf3-measured-r.json").toString()) as PreflopResultV1;
validatePreflopResult(baseline);
const savedFit = JSON.parse(read("pf3-realization-fit.json").toString()) as RealizationFit & { inputs: { libraryManifestSha256: string } };
const { roots, inputs, manifestSha256 } = loadLibraryRoots(ROOT);
const samples = realizationSamples(roots), measurement = measureLibrary(samples);
const fit = fitRealization(measurement);
if (manifestSha256 !== savedFit.inputs.libraryManifestSha256 || hashRealizationTable(fit.table) !== baseline.realizationHash) {
  throw new Error("library or fitted table differs from the published PF3 baseline; run audit:preflop");
}

const summarize = (label: string, result: PreflopResultV1, extra: Record<string, unknown> = {}) => ({ label,
  iterations: result.iterations, convergedWithinModel: result.converged, exploitabilityBbPerHand: result.grade.exploitability,
  btnValueBb: result.grade.value[0], bestResponseGainsBb: result.grade.gains,
  strategyHash: hash(canonicalSolverJson(result.strategy)),
  btnOpenPct: result.stats.btnOpenPct, ...defenceCoverage(result, fit),
  bbDefendL1CombosVsBaseline: rangeL1(baseline, result, "r2.5", "fold"),
  weakCalls: ["72o", "83o", "32o"].map(h => bbCallTrace(result, h)), ...extra });
const solveTable = (label: string, table: RealizationTableV1, extra: Record<string, unknown> = {}) =>
  summarize(label, solvePreflop(pf3Spot(table, `diagnostic only: ${label}`)).result, extra);
const pins = (f: RealizationFit) => f.rows.ip.filter(r => r.pinned).length + f.rows.oop.filter(r => r.pinned).length;

const variants = [summarize("saved PF3 baseline", baseline)];
variants.push(summarize("same model, 100x tighter stopping target", solvePreflop({ ...baseline.spot,
  solver: { ...baseline.spot.solver, targetExploitability: 0.000002 } }).result));
variants.push(summarize("same model, DCFR", solvePreflop({ ...baseline.spot,
  solver: { ...baseline.spot.solver, algorithm: "dcfr" } }).result));
variants.push(solveTable("all R = 1 (checkdown-payoff control, NOT poker)", unitRealizationTable()));
variants.push(solveTable("all fitted R scaled by 0.9 (scale-invariance control)",
  mapRealizationTable(fit.table, "diagnostic scale control", (_p, _t, _c, v) => 0.9 * v)));
for (const [label, options] of [
  ["no conservation shift", { ...DEFAULT_FIT_OPTIONS, conservePot: false }],
  ["no bucket shrinkage for measured classes", { ...DEFAULT_FIT_OPTIONS, kappa: 0 }],
  ["wider R clamps [0.05, 8], still bounded pot shares", { ...DEFAULT_FIT_OPTIONS, clamp: [0.05, 8] as const }],
] as const) {
  const f = fitRealization(measurement, options);
  variants.push(solveTable(label, f.table, { fitConvergedToAdjustedTargets: f.converged,
    fitMaxAdjustedError: f.maxShareError, conservationShift: f.conservationShift, pinnedCells: pins(f), clampedCells: f.clamps.length }));
}
// Arbitrary stress inputs, declared before looking at outcomes. These are NOT fitted estimates,
// recommended ranges, or attempts to land inside a published defence-frequency band.
for (const r of [0.5, 0.7]) variants.push(solveTable(`unmeasured BB SRP cells set to ${r} (unvalidated stress test)`,
  mapRealizationTable(fit.table, `diagnostic unseen BB R=${r}`, (p, t, c, v) =>
    p === "oop" && t === "srp" && fit.rows.oop[c].source !== "measured" ? r : v)));

// Delete-one-flop leverage, NOT cross-validation: no held-out prediction score, and the remaining
// eleven hand-picked textures are not random draws. Missing-combo/stratum renormalization is part
// of the existing estimator and therefore part of the observed sensitivity.
const deleteOneFlop = samples.map(sample => {
  const f = fitRealization(measureLibrary(samples.filter(s => s.spotId !== sample.spotId)));
  const r = solvePreflop(pf3Spot(f.table, `diagnostic omit ${sample.spotId}`)).result;
  return { omitted: sample.spotId, fitConvergedToAdjustedTargets: f.converged, fitMaxAdjustedError: f.maxShareError,
    conservationShift: f.conservationShift, pinnedCells: pins(f), clampedCells: f.clamps.length, convergedWithinModel: r.converged,
    exploitabilityBbPerHand: r.grade.exploitability, btnOpenPct: r.stats.btnOpenPct, bbDefendPct: r.stats.bbDefendPct,
    bbDefendL1Combos: rangeL1(baseline, r, "r2.5", "fold") };
});
const report = {
  format: "poker-face-preflop-model-diagnosis", version: 1,
  warning: "Diagnostic evidence only. Low exploitability measures the declared payoff model, not its accuracy as poker. No production range changes.",
  inputs: { preflopLockSha256: hash(lockBytes), files: lock.files, libraryManifestSha256: manifestSha256, roots: inputs },
  fit: { maxAdjustedTargetError: savedFit.maxShareError, conservationShift: savedFit.conservationShift,
    ip: fitResiduals(savedFit, "ip"), oop: fitResiduals(savedFit, "oop") },
  baselineCallTrace: ["72o", "83o", "32o", "T9o", "98o", "AA"].map(h => bbCallTrace(baseline, h)),
  ratioAdjustmentCounterexample: ratioAdjustmentCounterexample(), variants, deleteOneFlop,
};
console.log(JSON.stringify(report, null, 2));
