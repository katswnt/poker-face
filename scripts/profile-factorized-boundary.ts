import { performance } from "node:perf_hooks";
import { COMPACT_RIVER_WIDER_REQUEST } from "../src/lib/solver/river/compact/fixture";
import { prepareConfigurableRiver, type ConfigurableRiverRequest } from "../src/lib/solver/river/configurable/solve";
import { solveCompiledFactorizedRiverCfr } from "../src/lib/solver/river/factorized/cfr";
import { FACTORIZED_RIVER_WIDE_REQUEST } from "../src/lib/solver/river/factorized/fixture";
import { compileFactorizedRiverGame } from "../src/lib/solver/river/factorized/game";
import {
  compileFactorizedRiverScorekeeper,
  gradeFactorizedRiverStrategy,
} from "../src/lib/solver/river/factorized/scorekeeper";
import { FACTORIZED_CONFIGURABLE_RIVER_LIMITS } from "../src/lib/solver/river/factorized/solve";

const RICH_RANGE = "AA KK QQ JJ TT 88 66 55 AKs AQs AJs ATs KQs";
const RICH_NEAR_CEILING_REQUEST = {
  id: "factorized-rich-near-ceiling",
  board: ["2c", "3d", "4h", "7s", "9c"],
  rangeText: [RICH_RANGE, RICH_RANGE],
  committed: [50, 50],
  stackBehind: [100, 100],
  openingBetSizes: [25, 50, 75, 100],
  raiseToSizes: [50, 75, 100],
} as const satisfies ConfigurableRiverRequest;

const RICH_REJECTED_REQUEST = {
  ...FACTORIZED_RIVER_WIDE_REQUEST,
  id: "factorized-rich-over-ceiling",
  openingBetSizes: [25, 50, 75, 100],
  raiseToSizes: [50, 75, 100],
} as const satisfies ConfigurableRiverRequest;

const BOUNDARY_RANGE =
  "AA KK QQ JJ TT 88 66 55 AKs AQs AJs ATs KQs KJs QJs KTs QTs JTs T9s 98s 87s 76s 65s 54s";
const EXPLORATORY_BOUNDARY_REQUEST = {
  id: "factorized-exploratory-boundary",
  board: ["2c", "3d", "4h", "7s", "9c"],
  rangeText: [BOUNDARY_RANGE, BOUNDARY_RANGE],
  committed: [50, 50],
  stackBehind: [100, 100],
  openingBetSizes: [10, 25, 50, 75, 100],
  raiseToSizes: [25, 50, 75, 100],
} as const satisfies ConfigurableRiverRequest;

const EXPLORATORY_LIMITS = {
  maxRangeEntriesPerPlayer: 128,
  maxCompatibleDeals: 20_000,
  maxProjectedStates: 1_000_000,
} as const;

const SAMPLES = 5;
const PROFILE_ITERATIONS = 25;

function elapsed<T>(run: () => T): { readonly value: T; readonly milliseconds: number } {
  const started = performance.now();
  const value = run();
  return { value, milliseconds: performance.now() - started };
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function profile(
  label: string,
  request: ConfigurableRiverRequest,
  limits = FACTORIZED_CONFIGURABLE_RIVER_LIMITS,
) {
  const prepared = prepareConfigurableRiver(request, limits);
  const compilation = elapsed(() => compileFactorizedRiverGame(prepared.game));
  const compiled = compilation.value;
  solveCompiledFactorizedRiverCfr(compiled, {
    iterations: PROFILE_ITERATIONS,
    algorithm: "cfr-plus",
  });
  const solveTimes: number[] = [];
  let strategy = solveCompiledFactorizedRiverCfr(compiled, {
    iterations: PROFILE_ITERATIONS,
    algorithm: "cfr-plus",
  });
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const measured = elapsed(() => solveCompiledFactorizedRiverCfr(compiled, {
      iterations: PROFILE_ITERATIONS,
      algorithm: "cfr-plus",
    }));
    solveTimes.push(measured.milliseconds);
    strategy = measured.value;
  }
  const gradeTimes: number[] = [];
  let grade = gradeFactorizedRiverStrategy(
    compileFactorizedRiverScorekeeper(compiled),
    strategy.averageStrategy,
  );
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const measured = elapsed(() => gradeFactorizedRiverStrategy(
      compileFactorizedRiverScorekeeper(compiled),
      strategy.averageStrategy,
    ));
    gradeTimes.push(measured.milliseconds);
    grade = measured.value;
  }
  if (!Number.isFinite(grade.exploitability)) {
    throw new Error(`${label} produced non-finite exploitability`);
  }
  return {
    label,
    rangeEntries: prepared.game.preflight.rangeEntries[0],
    compatibleDeals: prepared.game.preflight.compatibleDeals,
    publicStates: prepared.game.preflight.publicStatesPerDeal,
    equivalentStates: prepared.game.preflight.projectedFullStates,
    informationSets: compiled.index.informationSets.length,
    compileMs: compilation.milliseconds,
    structuralBytes: compiled.typedStorageBytes,
    solveWorkspaceBytes: strategy.workingStorageBytes,
    solve25MedianMs: median(solveTimes),
    solveMsPerIteration: median(solveTimes) / PROFILE_ITERATIONS,
    scorekeeperIndexBytes: compileFactorizedRiverScorekeeper(compiled).typedStorageBytes,
    gradeWorkspaceBytes: grade.workingStorageBytes,
    gradeMedianMs: median(gradeTimes),
  };
}

const results = [
  profile("small", COMPACT_RIVER_WIDER_REQUEST),
  profile("more private deals", FACTORIZED_RIVER_WIDE_REQUEST),
  profile("richer tree near ceiling", RICH_NEAR_CEILING_REQUEST),
  profile("exploratory CPU boundary", EXPLORATORY_BOUNDARY_REQUEST, EXPLORATORY_LIMITS),
];

let rejection = "";
try {
  prepareConfigurableRiver(RICH_REJECTED_REQUEST, FACTORIZED_CONFIGURABLE_RIVER_LIMITS);
} catch (error) {
  rejection = error instanceof Error ? error.message : String(error);
}
if (!/287965 full states; exact limit is 250000/.test(rejection)) {
  throw new Error(`Expected the over-ceiling profile to fail closed; received: ${rejection}`);
}

console.log(`Runtime: Node ${process.version} on ${process.arch}`);
console.table(results.map(result => ({
  profile: result.label,
  entries: result.rangeEntries,
  deals: result.compatibleDeals,
  public: result.publicStates,
  states: result.equivalentStates,
  infosets: result.informationSets,
  compile_ms: result.compileMs.toFixed(2),
  solve_25_ms: result.solve25MedianMs.toFixed(2),
  ms_per_iteration: result.solveMsPerIteration.toFixed(2),
  grade_ms: result.gradeMedianMs.toFixed(2),
})));
for (const result of results) {
  console.log(`${result.label}:`);
  console.log(`  structural typed arrays  ${result.structuralBytes.toLocaleString()} bytes`);
  console.log(`  solve working arrays     ${result.solveWorkspaceBytes.toLocaleString()} bytes`);
  console.log(`  scorekeeper index        ${result.scorekeeperIndexBytes.toLocaleString()} bytes`);
  console.log(`  grade working arrays     ${result.gradeWorkspaceBytes.toLocaleString()} bytes`);
}
console.log(`Rejected profile: ${rejection}`);
console.log("Factorized boundary profile: passed");
