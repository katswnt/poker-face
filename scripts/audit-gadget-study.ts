import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import type { BehavioralStrategy } from "../src/lib/solver/toy/game";
import type { ConfigurableRiverAction as Action } from "../src/lib/solver/river/configurable/game";
import { gradeSubgameResponse, solveGadgetSubgame } from "../src/lib/solver/river/resolving";
import { buildRiverStudyFixture, buildTurnStudyFixture, type GadgetStudyFixture } from "./gadget-study-fixtures";

export const P4_SAFETY_TARGET = .0002;
export const P4_CHECKPOINTS = [1_000, 10_000, 100_000, 200_000] as const;
export const P4_REPORT_PATH = "tasks/artifacts/hu-play-p4-gadget-study.json";
const hash = (x: unknown) => createHash("sha256").update(canonicalSolverJson(x)).digest("hex");

export function runGadgetStudyFixture<S, C>(f: GadgetStudyFixture<S, C>) {
  const baseline = gradeStrategy(f.game, f.problem.blueprint, f.problem.index);
  const replacedKeys = new Set(f.problem.roots.map(r => f.game.informationSet(r.state, 0)));
  const row = (mode: string, strategy: BehavioralStrategy<Action>, iterations: number, trainingGameNashGap: number | null) => {
    const g = gradeStrategy(f.game, strategy, f.problem.index), constraints = gradeSubgameResponse(f.problem, strategy);
    const maximumGain = Math.max(...constraints.map(c => c.gain));
    const opponentWholeGameGain = g.bestResponses[1].value - baseline.bestResponses[1].value;
    return { mode, iterations, trainingGameNashGap,
      attempts: [] as { iterations: number; maximumGain: number; opponentWholeGameGain: number; trainingGameNashGap: number }[],
      policyHash: hash(serializeBehavioralStrategy(strategy)),
      replacement: serializeBehavioralStrategy(new Map([...strategy].filter(([key]) => replacedKeys.has(key)))),
      grade: { value: g.value, bestResponseValues: g.bestResponses.map(b => b.value), gains: g.gains, exploitability: g.exploitability },
      constraints, maximumGain, minimumMargin: -maximumGain, opponentWholeGameGain,
      accepted: mode === "resolve" || mode === "max-margin"
        ? maximumGain <= P4_SAFETY_TARGET && opponentWholeGameGain <= P4_SAFETY_TARGET : null };
  };
  const rows = [row("translation", f.problem.blueprint, 0, null)];
  for (const mode of ["unsafe", "unsafe-at-parent", "resolve", "max-margin"] as const) {
    const counts = mode === "resolve" || mode === "max-margin" ? P4_CHECKPOINTS : [10_000];
    const attempts: typeof rows[number]["attempts"] = [];
    for (const iterations of counts) {
      const solved = solveGadgetSubgame(mode === "unsafe-at-parent" ? f.parent : f.problem,
        mode === "unsafe-at-parent" ? "unsafe" : mode, { iterations, averagingDelay: 20 });
      // The parent solve's other branches are NOT played; grade the actually grafted profile.
      const strategy = new Map(f.problem.blueprint);
      for (const key of replacedKeys) strategy.set(key, solved.strategy.get(key)!);
      const measured = row(mode, strategy, iterations, solved.gadgetNashGap);
      attempts.push({ iterations, maximumGain: measured.maximumGain, opponentWholeGameGain: measured.opponentWholeGameGain,
        trainingGameNashGap: solved.gadgetNashGap });
      if (measured.accepted !== false || iterations === counts[counts.length - 1]) { rows.push({ ...measured, attempts }); break; }
    }
  }
  return { name: f.name, inputFiles: f.inputFiles, sizes: f.sizes, lowerTranslationProbability: f.lowerWeight,
    expandedGameStates: f.problem.index.totalStates, expandedInformationSets: f.problem.index.informationSets.length,
    roots: f.problem.roots.length, opponentHands: f.problem.bounds.length, replacedAiInformationSets: replacedKeys.size,
    originalBlueprintPolicyHash: hash(serializeBehavioralStrategy(f.saved)),
    expandedBlueprintPolicyHash: rows[0].policyHash, rows };
}

export function buildGadgetStudyReport() {
  const payload = { format: "poker-face-hu-p4-gadget-study", version: 1, algorithm: "compact-alternating-cfr-plus",
    averagingDelay: 20, checkpoints: P4_CHECKPOINTS, safetyTargetChips: P4_SAFETY_TARGET,
    limits: ["Referee-scale TypeScript study, not a production play policy or Rust gadget",
      "Finite floating-point policies, exact enumeration rather than exact equilibrium",
      "Protection is compared with the complete translated blueprint in the expanded game, not a missing-action abstraction",
      "Only AI strategy is grafted; human profile is unchanged; per-hand bounds use counterfactual rather than modeled reach",
      "Turn fixture replaces one river response; not a turn gadget or full-street production safety claim"],
    fixtures: [runGadgetStudyFixture(buildRiverStudyFixture()), runGadgetStudyFixture(buildTurnStudyFixture())] };
  return { ...payload, payloadHash: hash(payload) };
}
function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 1 && ["--write", "--check"].includes(args[0]), "Usage: audit-gadget-study.ts --write|--check");
  const started = performance.now(), report = buildGadgetStudyReport(), bytes = JSON.stringify(report, null, 2) + "\n";
  if (args[0] === "--write") writeFileSync(P4_REPORT_PATH, bytes);
  else assert.equal(readFileSync(P4_REPORT_PATH, "utf8"), bytes, "Frozen gadget study must reproduce byte for byte");
  console.log(JSON.stringify({ payloadHash: report.payloadHash, elapsedMs: performance.now() - started,
    fixtures: report.fixtures.map(f => ({ name: f.name, rows: f.rows.map(({ mode, iterations, maximumGain, opponentWholeGameGain, grade, accepted }) =>
      ({ mode, iterations, maximumGain, opponentWholeGameGain, exploitability: grade.exploitability, accepted })) })) }));
  assert.ok(report.fixtures.every(f => f.rows.filter(r => r.accepted !== null).every(r => r.accepted)), "P4 per-hand/whole-game gate failed; do not loosen it");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
