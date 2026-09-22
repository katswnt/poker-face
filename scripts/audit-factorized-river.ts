import { performance } from "node:perf_hooks";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import type { BehavioralStrategy } from "../src/lib/solver/toy/game";
import {
  compileCompactGame,
  solveCompiledCompactCfr,
} from "../src/lib/solver/river/compact/cfr";
import {
  compileCompactScorekeeper,
  gradeCompactStrategy,
} from "../src/lib/solver/river/compact/scorekeeper";
import { configurableRiverV2DemoGame } from "../src/lib/solver/river/configurable/fixture";
import type { ConfigurableRiverAction } from "../src/lib/solver/river/configurable/game";
import { prepareConfigurableRiver } from "../src/lib/solver/river/configurable/solve";
import {
  solveCompiledFactorizedRiverCfr,
} from "../src/lib/solver/river/factorized/cfr";
import { FACTORIZED_RIVER_WIDE_REQUEST } from "../src/lib/solver/river/factorized/fixture";
import { compileFactorizedRiverGame } from "../src/lib/solver/river/factorized/game";
import {
  compileFactorizedRiverScorekeeper,
  gradeFactorizedRiverStrategy,
} from "../src/lib/solver/river/factorized/scorekeeper";
import { FACTORIZED_CONFIGURABLE_RIVER_LIMITS } from "../src/lib/solver/river/factorized/solve";

const TOLERANCE = 1e-10;
const TIMING_ITERATIONS = 50;
const TIMING_SAMPLES = 7;

function elapsed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function maximumStrategyDifference(
  left: BehavioralStrategy<ConfigurableRiverAction>,
  right: BehavioralStrategy<ConfigurableRiverAction>,
): number {
  if (left.size !== right.size) return Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (const [key, leftEntry] of left) {
    const rightEntry = right.get(key);
    if (!rightEntry || leftEntry.actions.join("|") !== rightEntry.actions.join("|")) {
      return Number.POSITIVE_INFINITY;
    }
    leftEntry.probabilities.forEach((probability, action) => {
      maximum = Math.max(maximum, Math.abs(probability - rightEntry.probabilities[action]));
    });
  }
  return maximum;
}

function maximumChoiceDifference(
  left: ReadonlyMap<string, ConfigurableRiverAction>,
  right: ReadonlyMap<string, ConfigurableRiverAction>,
): number {
  if (left.size !== right.size) return 1;
  for (const [key, action] of left) if (right.get(key) !== action) return 1;
  return 0;
}

function maximumGradeDifference(
  left: ReturnType<typeof gradeCompactStrategy<ConfigurableRiverAction>>,
  right: ReturnType<typeof gradeFactorizedRiverStrategy>,
): number {
  return Math.max(
    Math.abs(left.value[0] - right.value[0]),
    Math.abs(left.value[1] - right.value[1]),
    Math.abs(left.bestResponses[0].value - right.bestResponses[0].value),
    Math.abs(left.bestResponses[1].value - right.bestResponses[1].value),
    Math.abs(left.gains[0] - right.gains[0]),
    Math.abs(left.gains[1] - right.gains[1]),
    Math.abs(left.nashGap - right.nashGap),
    Math.abs(left.exploitability - right.exploitability),
    maximumChoiceDifference(left.bestResponses[0].choices, right.bestResponses[0].choices),
    maximumChoiceDifference(left.bestResponses[1].choices, right.bestResponses[1].choices),
  );
}

const demoCompact = compileCompactGame(configurableRiverV2DemoGame);
const demoFactorized = compileFactorizedRiverGame(configurableRiverV2DemoGame);
const demoCompactSolve = solveCompiledCompactCfr(demoCompact, { iterations: 200 });
const demoFactorizedSolve = solveCompiledFactorizedRiverCfr(demoFactorized, { iterations: 200 });
const demoStrategyDifference = maximumStrategyDifference(
  demoCompactSolve.averageStrategy,
  demoFactorizedSolve.averageStrategy,
);
if (demoStrategyDifference > TOLERANCE) {
  throw new Error(`Factorized ordinary CFR differs from compact CFR by ${demoStrategyDifference}`);
}
const demoReadableGrade = gradeStrategy(
  configurableRiverV2DemoGame,
  demoFactorizedSolve.averageStrategy,
  demoFactorized.index,
);
const demoFactorizedGrade = gradeFactorizedRiverStrategy(
  compileFactorizedRiverScorekeeper(demoFactorized),
  demoFactorizedSolve.averageStrategy,
);
if (Math.abs(demoReadableGrade.exploitability - demoFactorizedGrade.exploitability) > TOLERANCE) {
  throw new Error("Factorized demo grade differs from the readable checker");
}

const wideGame = prepareConfigurableRiver(
  FACTORIZED_RIVER_WIDE_REQUEST,
  FACTORIZED_CONFIGURABLE_RIVER_LIMITS,
).game;
const wideCompact = compileCompactGame(wideGame);
const wideFactorized = compileFactorizedRiverGame(wideGame);
const wideCompactSolve = solveCompiledCompactCfr(wideCompact, {
  iterations: 400,
  algorithm: "cfr-plus",
  averagingDelay: 20,
});
const wideFactorizedSolve = solveCompiledFactorizedRiverCfr(wideFactorized, {
  iterations: 400,
  algorithm: "cfr-plus",
  averagingDelay: 20,
});
const wideStrategyDifference = maximumStrategyDifference(
  wideCompactSolve.averageStrategy,
  wideFactorizedSolve.averageStrategy,
);
if (wideStrategyDifference > TOLERANCE) {
  throw new Error(`Factorized CFR+ differs from repeated compact CFR+ by ${wideStrategyDifference}`);
}
const wideCompactGrade = gradeCompactStrategy(
  compileCompactScorekeeper(wideCompact),
  wideFactorizedSolve.averageStrategy,
);
const wideFactorizedScorekeeper = compileFactorizedRiverScorekeeper(wideFactorized);
const wideFactorizedGrade = gradeFactorizedRiverStrategy(
  wideFactorizedScorekeeper,
  wideFactorizedSolve.averageStrategy,
);
const wideGradeDifference = maximumGradeDifference(wideCompactGrade, wideFactorizedGrade);
if (wideGradeDifference > TOLERANCE) {
  throw new Error(`Factorized wide scorekeeper differs by ${wideGradeDifference} chips`);
}
if (wideFactorizedGrade.exploitability >= 0.25) {
  throw new Error(
    `Factorized wide fixture exploitability ${wideFactorizedGrade.exploitability} exceeds 0.25 chips`,
  );
}

// Warm up, then alternate timing order. These figures describe only this machine and run.
solveCompiledCompactCfr(wideCompact, { iterations: TIMING_ITERATIONS, algorithm: "cfr-plus" });
solveCompiledFactorizedRiverCfr(wideFactorized, {
  iterations: TIMING_ITERATIONS,
  algorithm: "cfr-plus",
});
const compactTimes: number[] = [];
const factorizedTimes: number[] = [];
for (let sample = 0; sample < TIMING_SAMPLES; sample += 1) {
  const compactRun = () => solveCompiledCompactCfr(wideCompact, {
    iterations: TIMING_ITERATIONS,
    algorithm: "cfr-plus" as const,
  });
  const factorizedRun = () => solveCompiledFactorizedRiverCfr(wideFactorized, {
    iterations: TIMING_ITERATIONS,
    algorithm: "cfr-plus" as const,
  });
  if (sample % 2 === 0) {
    compactTimes.push(elapsed(compactRun));
    factorizedTimes.push(elapsed(factorizedRun));
  } else {
    factorizedTimes.push(elapsed(factorizedRun));
    compactTimes.push(elapsed(compactRun));
  }
}
const compactMedian = median(compactTimes);
const factorizedMedian = median(factorizedTimes);
const structuralRatio = wideFactorized.typedStorageBytes / wideCompact.storageBytes;
if (structuralRatio >= 0.25) {
  throw new Error(`Factorized structural storage ratio ${structuralRatio} is not below 25%`);
}

console.log(`Runtime:                         Node ${process.version} on ${process.arch}`);
console.log(`Wide compatible deals:           ${wideGame.preflight.compatibleDeals.toLocaleString()}`);
console.log(`Equivalent repeated states:      ${wideFactorized.equivalentRepeatedStates.toLocaleString()}`);
console.log(`Public states stored once:       ${wideFactorized.publicNodeCount}`);
console.log(`Information sets:                ${wideFactorized.index.informationSets.length.toLocaleString()}`);
console.log(`Ordinary CFR maximum difference: ${demoStrategyDifference.toExponential(3)}`);
console.log(`CFR+ maximum difference:         ${wideStrategyDifference.toExponential(3)}`);
console.log(`Grade maximum difference:        ${wideGradeDifference.toExponential(3)} chips`);
console.log(`Exploitability after 400:        ${wideFactorizedGrade.exploitability.toFixed(9)} chips`);
console.log(`Repeated typed storage:          ${wideCompact.storageBytes.toLocaleString()} bytes`);
console.log(`Factorized typed storage:        ${wideFactorized.typedStorageBytes.toLocaleString()} bytes`);
console.log(`Factorized/repeated ratio:       ${(100 * structuralRatio).toFixed(2)}%`);
console.log(`Repeated solve workspace:        ${wideCompactSolve.workingStorageBytes.toLocaleString()} bytes`);
console.log(`Factorized solve workspace:      ${wideFactorizedSolve.workingStorageBytes.toLocaleString()} bytes`);
console.log(`Factorized scorekeeper index:    ${wideFactorizedScorekeeper.typedStorageBytes.toLocaleString()} bytes`);
console.log(`Factorized grade workspace:      ${wideFactorizedGrade.workingStorageBytes.toLocaleString()} bytes`);
console.log(`Repeated 50-iteration median:    ${compactMedian.toFixed(3)} ms`);
console.log(`Factorized 50-iteration median:  ${factorizedMedian.toFixed(3)} ms`);
console.log(`Observed solve speed ratio:      ${(compactMedian / factorizedMedian).toFixed(2)}x`);
console.log("Factorized river audit:          passed");
