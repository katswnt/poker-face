// Preflop solver v1 (tasks/preflop-solver-v1-spec.md): generate or audit the PF1–PF3 artifacts.
//
//   npm run solve:preflop   (--write)  regenerate every artifact in src/lib/solver/preflop/artifacts/
//   npm run audit:preflop   (--check)  fast reproduce + independent re-grade (CI main job)
//
// --check: (1) verifies the 12 B4 root.json inputs against the library manifest; (2) re-runs the
// realization fit and requires the saved R table hash; (3) re-solves PF2 and PF3 and requires
// byte-identical result files; (4) re-grades each saved strategy from its JSON with grader.ts and
// requires ≤ 1 mbb/hand; (5) structural checks (frequencies, AA/KK never fold, MDF bound);
// (6) re-runs PF1 at three depths against pushfold.ts; (7) checks lock.json hashes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import {
  POT_TYPES,
  type PotType, type PreflopResultV1, type RealizationPosition, type RealizationTableV1,
} from "../src/lib/solver/preflop/contract";
import { evaluatePreflopProfile } from "../src/lib/solver/preflop/grader";
import { hashJson, hashRealizationTable, sha256 } from "../src/lib/solver/preflop/hash";
import { loadLibraryRoots } from "../src/lib/solver/preflop/library-inputs";
import { comparePushFold, PUSHFOLD_DEPTHS } from "../src/lib/solver/preflop/pushfold-oracle";
import { CLASS_BUCKETS, defaultRealizationTable, HAND_BUCKETS, mapRealizationTable, REALIZATION_DEFAULTS, flatRealizationTable, type HandBucket } from "../src/lib/solver/preflop/realization";
import { DEFAULT_FIT_OPTIONS, fitRealization, measureLibrary, PF3_REALIZATION_SOURCE, realizationSamples } from "../src/lib/solver/preflop/realization-fit";
import { monotonicityViolations, premiumFolds, rangeL1, validationTable } from "../src/lib/solver/preflop/report";
import { profileFromResult, solvePreflop, validatePreflopResult } from "../src/lib/solver/preflop/solve";
import { stratumWeights } from "../src/lib/solver/preflop/texture";
import { pf2Spot, pf3Spot } from "../src/lib/solver/preflop/published";
import defaultsJson from "../src/lib/solver/preflop/realization-defaults.json";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ART = path.join(ROOT, "src/lib/solver/preflop/artifacts");
const MODE = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
if (!MODE) { console.error("usage: solve-preflop.ts --write | --check"); process.exit(2); }

const HONEST_NOTE = "simplified preflop model; not GTO preflop; realization factors from 12 flops with hand-written ranges";
const MAX_EXPLOITABILITY = 0.001;
const serialize = (value: unknown) => canonicalSolverJson(value) + "\n";
const file = (name: string) => path.join(ART, name);
const sha256File = (name: string) => sha256(readFileSync(file(name), "utf8"));

function pf3Fit() {
  const { roots, inputs, manifestSha256 } = loadLibraryRoots(ROOT);
  const samples = realizationSamples(roots);
  const fit = fitRealization(measureLibrary(samples), DEFAULT_FIT_OPTIONS, PF3_REALIZATION_SOURCE);
  return { fit, inputs, manifestSha256, samples };
}

const OPEN = "", BB_NODE = "r2.5";

function sensitivityRow(label: string, baseline: PreflopResultV1, result: PreflopResultV1) {
  const s = result.stats;
  return {
    label,
    exploitability: result.grade.exploitability, iterations: result.iterations, converged: result.converged,
    btnOpenPct: s.btnOpenPct, bbDefendPct: s.bbDefendPct, bb3betPct: s.bb3betPct, btn4betOfOpenPct: s.btn4betOfOpenPct,
    openL1Combos: rangeL1(baseline, result, OPEN, "r2.5"),
    bbDefendL1Combos: rangeL1(baseline, result, BB_NODE, "fold"),
    bb3betL1Combos: rangeL1(baseline, result, BB_NODE, "r11"),
  };
}

function bucketShift(table: RealizationTableV1, position: RealizationPosition, bucket: HandBucket, pot: PotType, change: (v: number) => number, label: string) {
  return mapRealizationTable(table, label, (p, t, c, v) => (p === position && t === pot && CLASS_BUCKETS[c] === bucket ? change(v) : v));
}

function pf2Sensitivity(baseline: PreflopResultV1) {
  const rows = [];
  const flat = (ip: Partial<Record<PotType, number>>, oop: Partial<Record<PotType, number>>, label: string) =>
    flatRealizationTable({ ip: { ...REALIZATION_DEFAULTS.ip, ...ip }, oop: { ...REALIZATION_DEFAULTS.oop, ...oop } }, label);
  for (const r of [0.7, 0.8, 0.85, 0.9, 1.0]) rows.push(sensitivityRow(`R_OOP(SRP) = ${r}`, baseline, solvePreflop(pf2Spot(flat({}, { srp: r }, `sweep R_OOP(SRP)=${r}`))).result));
  for (const r of [0.95, 1.05, 1.15]) rows.push(sensitivityRow(`R_IP(SRP) = ${r}`, baseline, solvePreflop(pf2Spot(flat({ srp: r }, {}, `sweep R_IP(SRP)=${r}`))).result));
  for (const position of ["ip", "oop"] as const) for (const bucket of HAND_BUCKETS) for (const d of [-0.1, 0.1]) {
    const label = `${position} SRP ${bucket} ${d > 0 ? "+" : ""}${d}`;
    rows.push(sensitivityRow(label, baseline, solvePreflop(pf2Spot(bucketShift(defaultRealizationTable(), position, bucket, "srp", v => v + d, label))).result));
  }
  for (const pot of ["3bp", "4bp"] as const) for (const position of ["ip", "oop"] as const) for (const d of [-0.1, 0.1]) {
    const label = `${position} ${pot} ${d > 0 ? "+" : ""}${d}`;
    rows.push(sensitivityRow(label, baseline, solvePreflop(pf2Spot(flat(position === "ip" ? { [pot]: REALIZATION_DEFAULTS.ip[pot] + d } : {}, position === "oop" ? { [pot]: REALIZATION_DEFAULTS.oop[pot] + d } : {}, label))).result));
  }
  const raked = solvePreflop(pf2Spot(defaultRealizationTable(), { pct: 0.05, capBb: 3, noFlopNoDrop: true }, "PF2 rake-stub direction check: 5% capped at 3bb")).result;
  rows.push(sensitivityRow("rake stub on: 5% cap 3bb, no flop no drop (general-sum: CFR+ has no guarantee)", baseline, raked));
  return rows;
}

function pf3Sensitivity(baseline: PreflopResultV1, table: RealizationTableV1) {
  const rows = [];
  const scaled = (positions: readonly RealizationPosition[], pots: readonly PotType[], f: number, label: string) =>
    mapRealizationTable(table, label, (p, t, _c, v) => (positions.includes(p) && pots.includes(t) ? v * f : v));
  for (const f of [0.9, 1.1]) {
    const pct = `${f > 1 ? "+" : "−"}10%`;
    rows.push(sensitivityRow(`R_IP(SRP) ${pct}`, baseline, solvePreflop(pf3Spot(scaled(["ip"], ["srp"], f, `R_IP(SRP) ${pct}`))).result));
    rows.push(sensitivityRow(`R_OOP(SRP) ${pct}`, baseline, solvePreflop(pf3Spot(scaled(["oop"], ["srp"], f, `R_OOP(SRP) ${pct}`))).result));
    rows.push(sensitivityRow(`all R ${pct} (a no-op: shares depend only on R_IP/R_OOP)`, baseline, solvePreflop(pf3Spot(scaled(["ip", "oop"], POT_TYPES, f, `all R ${pct}`))).result));
    for (const pot of ["3bp", "4bp"] as const) for (const position of ["ip", "oop"] as const) {
      rows.push(sensitivityRow(`${position} ${pot} (default) ${pct}`, baseline, solvePreflop(pf3Spot(scaled([position], [pot], f, `${position} ${pot} ${pct}`))).result));
    }
    for (const position of ["ip", "oop"] as const) for (const bucket of HAND_BUCKETS) {
      const label = `${position} SRP ${bucket} ${pct}`;
      rows.push(sensitivityRow(label, baseline, solvePreflop(pf3Spot(bucketShift(table, position, bucket, "srp", v => v * f, label))).result));
    }
  }
  return rows;
}

function structuralChecks(result: PreflopResultV1) {
  const game = validatePreflopResult(result);
  const profile = profileFromResult(result);
  const { grade } = evaluatePreflopProfile(game, profile); // validates frequencies ∈ [0,1], sums = 1
  const folds = premiumFolds(result);
  if (folds.length) throw new Error(`${result.label}: premium hands fold: ${folds.join("; ")}`);
  if ((result.stats.bbDefendPct ?? 100) < 37.5) throw new Error(`${result.label}: BB defend ${result.stats.bbDefendPct}% below the 37.5% MDF-style bound`);
  if (grade.exploitability > MAX_EXPLOITABILITY) throw new Error(`${result.label}: re-graded exploitability ${grade.exploitability} > ${MAX_EXPLOITABILITY}`);
  if (Math.abs(grade.exploitability - result.grade.exploitability) > 1e-12) throw new Error(`${result.label}: re-grade ${grade.exploitability} ≠ saved ${result.grade.exploitability}`);
  return grade;
}

function pf1Summary(depths: readonly number[]) {
  return depths.map(stack => {
    const c = comparePushFold(stack);
    return {
      stack, iterations: c.iterations, exploitability: c.exploitability, value: c.value, pushfoldValue: c.pushfoldValue,
      valueDiff: c.valueDiff, pushfoldNashGap: c.pushfoldNashGap, shovePct: c.shovePct, pushfoldShovePct: c.pushfoldShovePct,
      callPct: c.callPct, pushfoldCallPct: c.pushfoldCallPct, differing: c.differing,
    };
  });
}

function main() {
  const t0 = Date.now();
  if (MODE === "write") mkdirSync(ART, { recursive: true });

  // PF3 inputs and fit (fast, pure).
  const tFit = Date.now();
  const { fit, inputs, manifestSha256 } = pf3Fit();
  const fitArtifact = {
    format: "poker-face-preflop-realization-fit", version: 1,
    note: HONEST_NOTE,
    inputs: { libraryManifestSha256: manifestSha256, roots: inputs, defaults: { file: "src/lib/solver/preflop/realization-defaults.json", sha256: hashJson(defaultsJson) } },
    stratumWeights: stratumWeights(),
    options: fit.options, steps: fit.steps, maxShareError: fit.maxShareError, converged: fit.converged,
    anchor: fit.anchor, conservationShift: fit.conservationShift, clamps: fit.clamps,
    measuredCells: { ip: { srp: "per class (measured / bucket / default: see rows)", "3bp": "default", "4bp": "default" }, oop: { srp: "per class (see rows)", "3bp": "default", "4bp": "default" } },
    buckets: fit.buckets, rows: fit.rows,
    table: fit.table, tableHash: hashRealizationTable(fit.table),
  };
  const fitMs = Date.now() - tFit;

  const tPf2 = Date.now();
  const pf2 = solvePreflop(pf2Spot()).result;
  const pf2Ms = Date.now() - tPf2;
  const tPf3 = Date.now();
  const pf3 = solvePreflop(pf3Spot(fit.table)).result;
  const pf3Ms = Date.now() - tPf3;
  for (const r of [pf2, pf3]) if (!r.converged) throw new Error(`${r.label} did not converge (${r.grade.exploitability})`);

  if (MODE === "write") {
    const pf1 = pf1Summary(PUSHFOLD_DEPTHS);
    const pf2Sens = pf2Sensitivity(pf2);
    const pf3Sens = pf3Sensitivity(pf3, fit.table);
    const outputs: Record<string, unknown> = {
      "pf1-pushfold-equivalence.json": { format: "poker-face-preflop-pf1", version: 1, note: "hu jam/fold special case vs src/lib/solver/pushfold-solutions.json; Nash gap measured with pushfold.ts's own best responses", rows: pf1 },
      "pf2-default-r.json": pf2,
      "pf2-sensitivity.json": { format: "poker-face-preflop-sensitivity", version: 1, baseline: { label: pf2.label, spotHash: pf2.spotHash }, note: "spec §3.3 sweep; checked in as a table, not tuned against", rows: pf2Sens },
      "pf3-realization-fit.json": fitArtifact,
      "pf3-measured-r.json": pf3,
      "pf3-sensitivity.json": { format: "poker-face-preflop-sensitivity", version: 1, baseline: { label: pf3.label, spotHash: pf3.spotHash }, note: "R ±10% one position / pot type / bucket at a time around the fitted table", rows: pf3Sens },
    };
    for (const [name, value] of Object.entries(outputs)) writeFileSync(file(name), serialize(value));
    const lock = {
      format: "poker-face-preflop-lock", version: 1, note: HONEST_NOTE,
      files: Object.fromEntries(Object.keys(outputs).map(name => [name, sha256File(name)])),
      locked: {
        result: "pf3-measured-r.json", spotHash: pf3.spotHash, realizationHash: pf3.realizationHash, fitTableHash: fitArtifact.tableHash,
        inputs: fitArtifact.inputs, exploitability: pf3.grade.exploitability, iterations: pf3.iterations, stats: pf3.stats,
      },
      validation: { pf2: validationTable(pf2), pf3: validationTable(pf3) },
      pf3VsPf2: {
        openL1Combos: rangeL1(pf2, pf3, OPEN, "r2.5"), bbDefendL1Combos: rangeL1(pf2, pf3, BB_NODE, "fold"),
        bbCallL1Combos: rangeL1(pf2, pf3, BB_NODE, "call"), bb3betL1Combos: rangeL1(pf2, pf3, BB_NODE, "r11"),
      },
      monotonicity: {
        pf2Open: monotonicityViolations(pf2, OPEN, "r2.5"), pf3Open: monotonicityViolations(pf3, OPEN, "r2.5"),
      },
      timingsMs: { fit: fitMs, pf2: pf2Ms, pf3: pf3Ms, note: "wall clock on the generating machine; informational" },
    };
    writeFileSync(file("lock.json"), serialize(lock));
    console.log(`wrote ${Object.keys(outputs).length + 1} artifacts to ${path.relative(ROOT, ART)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } else {
    const fail = (message: string) => { throw new Error(`audit:preflop: ${message}`); };
    for (const name of ["pf1-pushfold-equivalence.json", "pf2-default-r.json", "pf2-sensitivity.json", "pf3-realization-fit.json", "pf3-measured-r.json", "pf3-sensitivity.json", "lock.json"]) {
      if (!existsSync(file(name))) fail(`missing ${name}`);
    }
    const lock = JSON.parse(readFileSync(file("lock.json"), "utf8"));
    for (const [name, hash] of Object.entries(lock.files as Record<string, string>)) if (sha256File(name) !== hash) fail(`${name} sha256 differs from lock.json`);
    // (2) realization fit reproduces.
    const savedFit = JSON.parse(readFileSync(file("pf3-realization-fit.json"), "utf8"));
    if (savedFit.tableHash !== fitArtifact.tableHash) fail(`R table hash ${fitArtifact.tableHash} ≠ saved ${savedFit.tableHash}`);
    if (serialize(fitArtifact) !== readFileSync(file("pf3-realization-fit.json"), "utf8")) fail("pf3-realization-fit.json is not byte-identical to a fresh fit");
    // (3) re-solve byte-identical.
    for (const [name, result] of [["pf2-default-r.json", pf2], ["pf3-measured-r.json", pf3]] as const) {
      if (serialize(result) !== readFileSync(file(name), "utf8")) fail(`${name} is not byte-identical to a fresh solve`);
    }
    // (4, 5) independent re-grade of the saved JSON + structural checks.
    for (const name of ["pf2-default-r.json", "pf3-measured-r.json"]) {
      const saved = JSON.parse(readFileSync(file(name), "utf8")) as PreflopResultV1;
      const grade = structuralChecks(saved);
      console.log(`  ${name}: re-graded exploitability ${(grade.exploitability * 1000).toFixed(4)} mbb/hand, value BTN ${grade.value[0].toFixed(4)} bb`);
    }
    if (lock.locked.realizationHash !== pf3.realizationHash || lock.locked.spotHash !== pf3.spotHash) fail("lock.json locked hashes differ from the PF3 result");
    // (6) PF1 spot check.
    const savedPf1 = JSON.parse(readFileSync(file("pf1-pushfold-equivalence.json"), "utf8"));
    for (const stack of [3, 10, 20]) {
      const [row] = pf1Summary([stack]);
      const saved = savedPf1.rows.find((r: { stack: number }) => r.stack === stack);
      if (serialize(row) !== serialize(saved)) fail(`PF1 at ${stack}bb differs from the saved row`);
      if (Math.abs(row.valueDiff) > 1e-4 || row.pushfoldNashGap > 5e-4) fail(`PF1 at ${stack}bb: value diff ${row.valueDiff}, pushfold Nash gap ${row.pushfoldNashGap}`);
    }
    console.log(`audit:preflop OK in ${((Date.now() - t0) / 1000).toFixed(1)} s (fit ${fitMs} ms, PF2 ${pf2.iterations} it / ${pf2Ms} ms, PF3 ${pf3.iterations} it / ${pf3Ms} ms)`);
  }
  console.log(`PF2 default R: ${(pf2.grade.exploitability * 1000).toFixed(3)} mbb/hand after ${pf2.iterations} it; stats ${JSON.stringify(round(pf2.stats))}`);
  console.log(`PF3 fitted R:  ${(pf3.grade.exploitability * 1000).toFixed(3)} mbb/hand after ${pf3.iterations} it; stats ${JSON.stringify(round(pf3.stats))}`);
  console.log(`fit: ${fit.steps} steps, max share error ${fit.maxShareError.toFixed(4)}, δ ${fit.conservationShift.toFixed(4)}, ${fit.clamps.length} clamps`);
}

function round(stats: Record<string, number>) {
  return Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Math.round(v * 100) / 100]));
}

main();
