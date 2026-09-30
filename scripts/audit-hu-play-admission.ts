// Frozen P1 feasibility gate. This does not solve, certify or publish a playing policy.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { LIVE_LIMITS } from "../src/lib/solver/bridge/live/admission";
import { probeLibraryPrefixes } from "./hu-play-library-probe";

export const P1_COHORT_SIZE = 4096;
export const P1_ROOTS_PER_STREET = 32;
export const P1_MINIMUM_RETAINED_MASS = .99;
export const P1_ADMISSION_REPORT_PATH = "tasks/artifacts/hu-play-p1-admission.json";
const hash = (x: unknown) => createHash("sha256").update(canonicalSolverJson(x)).digest("hex");
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};

export function buildP1AdmissionReport() {
  const probe = probeLibraryPrefixes(Array.from({ length: P1_COHORT_SIZE }, (_, seed) => seed));
  const selected = (["turn", "river"] as const).flatMap(street => {
    const rows = probe.roots.filter(r => r.publicState.street === street).slice(0, P1_ROOTS_PER_STREET);
    assert.equal(rows.length, P1_ROOTS_PER_STREET, `Frozen cohort must supply ${P1_ROOTS_PER_STREET} ${street} roots; do not change seeds to pass`);
    return rows;
  });
  assert.equal(new Set(selected.map(r => `${r.seed}|${r.publicState.path.join(" ")}`)).size, 2 * P1_ROOTS_PER_STREET);
  const summary = (["turn", "river"] as const).map(street => {
    const rows = probe.roots.filter(r => r.publicState.street === street);
    const fractions = rows.map(r => Math.min(...r.capacity.map(c => c.retainedMass)));
    return { street, roots: rows.length, bothRangesFit99Within64: rows.filter(r => r.capacity.every(c => c.possible)).length,
      fullRangeBrowserInputsAccepted: rows.filter(r => r.browserInputError === null).length,
      exactSavedNodeAvailable: rows.filter(r => r.exactNodeAvailable).length,
      noSavedBoardPolicy: rows.filter(r => !r.savedBoardAvailable).length,
      blockedWithNoBoardFallback: rows.filter(r => !r.savedBoardAvailable && r.capacity.some(c => !c.possible)).length,
      smallerPlayerTop64Mass: { min: Math.min(...fractions), median: median(fractions), max: Math.max(...fractions) },
      handsFor99Mass: [0, 1].map(p => ({ min: Math.min(...rows.map(r => r.capacity[p].handsForTarget)),
        median: median(rows.map(r => r.capacity[p].handsForTarget)), max: Math.max(...rows.map(r => r.capacity[p].handsForTarget)) })) };
  });
  const blocked = summary.some(s => s.blockedWithNoBoardFallback > 0);
  const report = {
    format: "poker-face-hu-p1-admission-audit", version: 1,
    interpretation: "Necessary reach-capacity and saved-policy coverage test; no EV or exploitability claim.",
    seedPlan: { first: 0, last: P1_COHORT_SIZE - 1, flops: 12, selection: "first 32 reached roots per street in seed order",
      riverSelectionLimit: "River roots require an earlier sampled turn to have a usable saved policy; unavailable prefixes stop. This is not an unconditional river sample." },
    limits: { maxHandsPerPlayer: LIVE_LIMITS.rangeHands, minimumRetainedMass: P1_MINIMUM_RETAINED_MASS,
      solverBudgetBytes: LIVE_LIMITS.budgetBytes, medianLocalExploitabilityPctPotGate: 1 },
    inputFiles: probe.inputFiles, inputFilesHash: hash(probe.inputFiles),
    cohort: { hands: probe.hands.length, completedUsingSavedPoliciesOnly: probe.hands.filter(h => h.outcome === "completed").length,
      stoppedUnavailable: probe.hands.filter(h => h.outcome === "unavailable").length,
      stoppedForMissingPositiveReachColumn: probe.hands.filter(h => h.reason?.includes("positive-reach strategy column")).length,
      publicPrefixesHash: hash(probe.hands), byStreet: summary },
    corpus: selected.map(r => ({ seed: r.seed, librarySpotId: r.librarySpotId, street: r.publicState.street,
      path: r.publicState.path, spotHash: r.spotHash, pot: r.spot.startingPot, stack: r.spot.effectiveStack,
      capacity: r.capacity, savedBoardAvailable: r.savedBoardAvailable, exactNodeAvailable: r.exactNodeAvailable,
      browserInputError: r.browserInputError })),
    decision: { status: blocked ? "blocked-before-solving" : "requires-numerical-grading",
      reason: blocked ? "Some seeded roots cannot retain 99% of both ranges in 64 hands and have no saved policy on their board. Action-size translation cannot supply a different board." : "Necessary capacity checks alone do not certify the ladder.",
      nativeFullPrunedComparison: null, independentFullRangeExploitability: null, productionHandsTested: 0,
      unmeasured: "No admissible 99%-mass pruned policy exists at the blocked roots; do not report an invented EV/exploitability or substitute a top-64 game." },
  };
  return { ...report, payloadHash: hash(report) };
}

function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 1 && ["--write", "--check"].includes(args[0]), "Usage: audit-hu-play-admission.ts --write|--check");
  const report = buildP1AdmissionReport(), bytes = JSON.stringify(report, null, 2) + "\n";
  if (args[0] === "--write") writeFileSync(P1_ADMISSION_REPORT_PATH, bytes);
  else assert.equal(readFileSync(P1_ADMISSION_REPORT_PATH, "utf8"), bytes, "Frozen P1 admission audit must reproduce byte for byte");
  console.log(JSON.stringify({ payloadHash: report.payloadHash, cohort: report.cohort, corpusRoots: report.corpus.length, decision: report.decision }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
