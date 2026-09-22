import { performance } from "node:perf_hooks";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import type { BehavioralStrategy } from "../src/lib/solver/toy/game";
import { solveCompactCfr } from "../src/lib/solver/river/compact/cfr";
import { COMPACT_RIVER_WIDER_REQUEST } from "../src/lib/solver/river/compact/fixture";
import {
  compileCompactScorekeeper,
  gradeCompactStrategy,
  type CompactStrategyGrade,
} from "../src/lib/solver/river/compact/scorekeeper";
import { configurableRiverV2DemoGame } from "../src/lib/solver/river/configurable/fixture";
import type {
  ConfigurableRiverAction,
  ConfigurableRiverGame,
} from "../src/lib/solver/river/configurable/game";
import { prepareConfigurableRiver } from "../src/lib/solver/river/configurable/solve";

const SAMPLES = 15;
const MINIMUM_WIDER_SPEEDUP = 3;
const TOLERANCE = 1e-12;

function elapsed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function maximumChoiceDifference(
  readable: ReadonlyMap<string, ConfigurableRiverAction>,
  compact: ReadonlyMap<string, ConfigurableRiverAction>,
): number {
  if (readable.size !== compact.size) return 1;
  for (const [key, action] of readable) {
    if (compact.get(key) !== action) return 1;
  }
  return 0;
}

function maximumGradeDifference(
  readable: ReturnType<typeof gradeStrategy<unknown, ConfigurableRiverAction, unknown>>,
  compact: CompactStrategyGrade<ConfigurableRiverAction>,
): number {
  return Math.max(
    Math.abs(readable.value[0] - compact.value[0]),
    Math.abs(readable.value[1] - compact.value[1]),
    Math.abs(readable.bestResponses[0].value - compact.bestResponses[0].value),
    Math.abs(readable.bestResponses[1].value - compact.bestResponses[1].value),
    Math.abs(readable.gains[0] - compact.gains[0]),
    Math.abs(readable.gains[1] - compact.gains[1]),
    Math.abs(readable.nashGap - compact.nashGap),
    Math.abs(readable.exploitability - compact.exploitability),
    maximumChoiceDifference(readable.bestResponses[0].choices, compact.bestResponses[0].choices),
    maximumChoiceDifference(readable.bestResponses[1].choices, compact.bestResponses[1].choices),
  );
}

interface GradeBenchmark {
  readonly game: string;
  readonly states: number;
  readonly informationSets: number;
  readonly maximumDifference: number;
  readonly readableMedianMs: number;
  readonly compactMedianMs: number;
  readonly speedup: number;
  readonly scorekeeperStorageBytes: number;
  readonly gradeWorkingStorageBytes: number;
}

function benchmarkGrade(
  game: ConfigurableRiverGame,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
  compiled: ReturnType<typeof solveCompactCfr<unknown, ConfigurableRiverAction, unknown>>["compiled"],
): GradeBenchmark {
  const scorekeeper = compileCompactScorekeeper(compiled);
  const readable = gradeStrategy(game, strategy, compiled.index);
  const compact = gradeCompactStrategy(scorekeeper, strategy);
  const difference = maximumGradeDifference(readable, compact);
  if (difference > TOLERANCE) {
    throw new Error(`${game.id} compact scorekeeper differs by ${difference}`);
  }

  // Warm up both paths. The compact timing includes its information-set node index so
  // both measurements represent the complete public grading call.
  gradeStrategy(game, strategy, compiled.index);
  gradeCompactStrategy(compileCompactScorekeeper(compiled), strategy);
  const readableTimes: number[] = [];
  const compactTimes: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    if (sample % 2 === 0) {
      readableTimes.push(elapsed(() => gradeStrategy(game, strategy, compiled.index)));
      compactTimes.push(elapsed(() => gradeCompactStrategy(
        compileCompactScorekeeper(compiled),
        strategy,
      )));
    } else {
      compactTimes.push(elapsed(() => gradeCompactStrategy(
        compileCompactScorekeeper(compiled),
        strategy,
      )));
      readableTimes.push(elapsed(() => gradeStrategy(game, strategy, compiled.index)));
    }
  }
  const readableMedianMs = median(readableTimes);
  const compactMedianMs = median(compactTimes);
  return {
    game: game.id,
    states: compiled.index.totalStates,
    informationSets: compiled.index.informationSets.length,
    maximumDifference: difference,
    readableMedianMs,
    compactMedianMs,
    speedup: readableMedianMs / compactMedianMs,
    scorekeeperStorageBytes: scorekeeper.storageBytes,
    gradeWorkingStorageBytes: compact.workingStorageBytes,
  };
}

const demoSolve = solveCompactCfr(configurableRiverV2DemoGame, {
  iterations: 100,
  algorithm: "cfr-plus",
});
const demo = benchmarkGrade(
  configurableRiverV2DemoGame,
  demoSolve.averageStrategy,
  demoSolve.compiled,
);

const widerGame = prepareConfigurableRiver(COMPACT_RIVER_WIDER_REQUEST, {
  maxRangeEntriesPerPlayer: 128,
  maxCompatibleDeals: 2_000,
  maxProjectedStates: 50_000,
}).game;
const widerSolve = solveCompactCfr(widerGame, {
  iterations: 100,
  algorithm: "cfr-plus",
});
const wider = benchmarkGrade(widerGame, widerSolve.averageStrategy, widerSolve.compiled);
if (wider.speedup < MINIMUM_WIDER_SPEEDUP) {
  throw new Error(`Compact wider scorekeeper speedup ${wider.speedup.toFixed(2)}x is too small`);
}

console.log(`Runtime:                    Node ${process.version} on ${process.arch}`);
for (const result of [demo, wider]) {
  console.log(`Game:                       ${result.game}`);
  console.log(`States/information sets:    ${result.states}/${result.informationSets}`);
  console.log(`Maximum grade difference:   ${result.maximumDifference.toExponential(3)} chips`);
  console.log(`Readable grade median:      ${result.readableMedianMs.toFixed(3)} ms`);
  console.log(`Compact grade median:       ${result.compactMedianMs.toFixed(3)} ms`);
  console.log(`Observed grade speedup:     ${result.speedup.toFixed(2)}x`);
  console.log(`Scorekeeper index storage:  ${result.scorekeeperStorageBytes.toLocaleString()} bytes`);
  console.log(`Grade working storage:      ${result.gradeWorkingStorageBytes.toLocaleString()} bytes`);
}
console.log("Compact scorekeeper audit:  passed");
