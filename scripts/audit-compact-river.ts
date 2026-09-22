import { performance } from "node:perf_hooks";
import acceptedArtifact from "../src/lib/solver/river/configurable/artifacts/configurable-river-v2.json" with { type: "json" };
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import type { BehavioralStrategy } from "../src/lib/solver/toy/game";
import {
  compileCompactGame,
  solveCompactCfr,
  solveCompiledCompactCfr,
} from "../src/lib/solver/river/compact/cfr";
import { configurableRiverV2DemoGame } from "../src/lib/solver/river/configurable/fixture";
import type { ConfigurableRiverAction } from "../src/lib/solver/river/configurable/game";
import { auditConfigurableRiverRules } from "../src/lib/solver/river/configurable/oracle";
import { solveCompactConfigurableRiver } from "../src/lib/solver/river/compact/solve";

const EQUIVALENCE_ITERATIONS = 1_000;
const CFR_PLUS_ITERATIONS = 1_000;
const BENCHMARK_ITERATIONS = 2_000;
const BENCHMARK_SAMPLES = 5;
const MINIMUM_SPEEDUP = 3;
const MAXIMUM_EXPLOITABILITY = 0.25;

const WIDER_REQUEST = {
  id: "compact-wide-fixture",
  board: ["2c", "3d", "4h", "7s", "9c"],
  rangeText: ["AA KK QQ JJ TT", "AA KK QQ JJ TT"],
  committed: [50, 50],
  stackBehind: [100, 100],
  openingBetSizes: [50, 100],
  raiseToSizes: [100],
} as const;

function maximumStrategyDifference(
  left: BehavioralStrategy<ConfigurableRiverAction>,
  right: BehavioralStrategy<ConfigurableRiverAction>,
): number {
  let maximum = 0;
  for (const [key, entry] of left) {
    const other = right.get(key);
    if (!other) throw new Error(`Compact audit strategy omitted ${key}`);
    if (entry.actions.join("\u0000") !== other.actions.join("\u0000")) {
      throw new Error(`Compact audit action order changed at ${key}`);
    }
    for (let action = 0; action < entry.probabilities.length; action += 1) {
      maximum = Math.max(maximum, Math.abs(entry.probabilities[action] - other.probabilities[action]));
    }
  }
  return maximum;
}

function maximumRegretDifference(
  left: ReadonlyMap<string, readonly number[]>,
  right: ReadonlyMap<string, readonly number[]>,
): number {
  let maximum = 0;
  for (const [key, regrets] of left) {
    const other = right.get(key);
    if (!other) throw new Error(`Compact audit regrets omitted ${key}`);
    for (let action = 0; action < regrets.length; action += 1) {
      maximum = Math.max(maximum, Math.abs(regrets[action] - other[action]));
    }
  }
  return maximum;
}

function elapsed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

const game = configurableRiverV2DemoGame;
const readable = solveCfr(game, { iterations: EQUIVALENCE_ITERATIONS });
const compact = solveCompactCfr(game, { iterations: EQUIVALENCE_ITERATIONS });
const maximumAverageStrategyDifference = maximumStrategyDifference(
  readable.averageStrategy,
  compact.averageStrategy,
);
const maximumCurrentStrategyDifference = maximumStrategyDifference(
  readable.currentStrategy,
  compact.currentStrategy,
);
const maximumCumulativeRegretDifference = maximumRegretDifference(
  readable.cumulativeRegrets,
  compact.cumulativeRegrets,
);
const readableGrade = gradeStrategy(game, readable.averageStrategy, readable.index);
const compactGrade = gradeStrategy(game, compact.averageStrategy, compact.index);
const maximumGradeDifference = Math.max(
  Math.abs(readableGrade.value[0] - compactGrade.value[0]),
  Math.abs(readableGrade.value[1] - compactGrade.value[1]),
  Math.abs(readableGrade.exploitability - compactGrade.exploitability),
);
if (
  maximumAverageStrategyDifference > 1e-9 ||
  maximumCurrentStrategyDifference > 1e-9 ||
  maximumCumulativeRegretDifference > 1e-9 ||
  maximumGradeDifference > 1e-9
) {
  throw new Error("Compact ordinary CFR disagrees with the readable solver");
}

const compiled = compileCompactGame(game);
const cfrPlus = solveCompiledCompactCfr(compiled, {
  iterations: CFR_PLUS_ITERATIONS,
  algorithm: "cfr-plus",
  checkpointIterations: [100, 400, CFR_PLUS_ITERATIONS],
});
const cfrPlusGrade = gradeStrategy(game, cfrPlus.averageStrategy, cfrPlus.index);
if (cfrPlusGrade.exploitability > MAXIMUM_EXPLOITABILITY) {
  throw new Error(
    `Compact CFR+ exploitability ${cfrPlusGrade.exploitability} exceeds ${MAXIMUM_EXPLOITABILITY}`,
  );
}
for (const regrets of cfrPlus.cumulativeRegrets.values()) {
  if (regrets.some(regret => !Number.isFinite(regret) || regret < 0)) {
    throw new Error("Compact CFR+ produced a negative or non-finite regret");
  }
}

const rulesAudit = auditConfigurableRiverRules(game);
const maximumRulesError = Math.max(
  rulesAudit.maximumProbabilityDifference,
  rulesAudit.maximumUtilityDifference,
  rulesAudit.maximumZeroSumError,
);
if (maximumRulesError !== 0) throw new Error(`Accepted river rules changed by ${maximumRulesError}`);

// Warm both implementations before comparing medians. Each measured call includes its
// own tree construction so the result reflects the public solve functions a caller uses.
solveCfr(game, { iterations: 200 });
solveCompactCfr(game, { iterations: 200 });
const readableTimes: number[] = [];
const compactTimes: number[] = [];
for (let sample = 0; sample < BENCHMARK_SAMPLES; sample += 1) {
  if (sample % 2 === 0) {
    readableTimes.push(elapsed(() => solveCfr(game, { iterations: BENCHMARK_ITERATIONS })));
    compactTimes.push(elapsed(() => solveCompactCfr(game, { iterations: BENCHMARK_ITERATIONS })));
  } else {
    compactTimes.push(elapsed(() => solveCompactCfr(game, { iterations: BENCHMARK_ITERATIONS })));
    readableTimes.push(elapsed(() => solveCfr(game, { iterations: BENCHMARK_ITERATIONS })));
  }
}
const readableMedianMs = median(readableTimes);
const compactMedianMs = median(compactTimes);
const speedup = readableMedianMs / compactMedianMs;
if (speedup < MINIMUM_SPEEDUP) {
  throw new Error(`Compact CFR speedup ${speedup.toFixed(2)}x is below ${MINIMUM_SPEEDUP}x`);
}

const referenceValue = acceptedArtifact.reference.value[0];
const widerStarted = performance.now();
const wider = solveCompactConfigurableRiver(WIDER_REQUEST, {
  iterations: 400,
  algorithm: "cfr-plus",
  includeDecisionFacts: false,
});
const widerElapsedMs = performance.now() - widerStarted;
if (wider.game.preflight.compatibleDeals <= 500 || wider.grade.exploitability > MAXIMUM_EXPLOITABILITY) {
  throw new Error("The compact wider-range fixture missed its size or exploitability gate");
}
console.log(`Runtime:                 Node ${process.version} on ${process.arch}`);
console.log(`Game states/infosets:   ${compiled.index.totalStates}/${compiled.index.informationSets.length}`);
console.log(`Ordinary iterations:    ${EQUIVALENCE_ITERATIONS}`);
console.log(`Max strategy difference:${maximumAverageStrategyDifference.toExponential(3)}`);
console.log(`Max regret difference:  ${maximumCumulativeRegretDifference.toExponential(3)}`);
console.log(`Max grade difference:   ${maximumGradeDifference.toExponential(3)} chips`);
console.log(`CFR+ iterations:        ${CFR_PLUS_ITERATIONS}`);
console.log(`CFR+ regret passes:     ${cfrPlus.fullTreeRegretPasses}`);
console.log(`CFR+ reach-only passes: ${cfrPlus.reachOnlyPasses}`);
console.log(`CFR+ value:             ${cfrPlusGrade.value[0].toFixed(9)} chips`);
console.log(`Reference value delta:  ${Math.abs(cfrPlusGrade.value[0] - referenceValue).toFixed(9)} chip`);
console.log(`CFR+ exploitability:    ${cfrPlusGrade.exploitability.toFixed(9)} chips`);
console.log(`Compiled typed arrays:  ${compiled.storageBytes.toLocaleString()} bytes`);
console.log(`Numeric working arrays: ${cfrPlus.workingStorageBytes.toLocaleString()} bytes`);
console.log(`Benchmark iterations:   ${BENCHMARK_ITERATIONS} × ${BENCHMARK_SAMPLES} samples`);
console.log(`Readable median:        ${readableMedianMs.toFixed(2)} ms`);
console.log(`Compact median:         ${compactMedianMs.toFixed(2)} ms`);
console.log(`Observed speedup:       ${speedup.toFixed(2)}x`);
console.log(`Wider compatible deals: ${wider.game.preflight.compatibleDeals}`);
console.log(`Wider full states:      ${wider.result.index.totalStates}`);
console.log(`Wider CFR+ runtime:     ${widerElapsedMs.toFixed(2)} ms`);
console.log(`Wider exploitability:  ${wider.grade.exploitability.toFixed(9)} chips`);
console.log("Compact river audit:    passed");
