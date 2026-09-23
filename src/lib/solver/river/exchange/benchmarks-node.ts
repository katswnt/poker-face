import { canonicalSolverJson } from "../../toy/artifact";
import { gradeStrategy } from "../../toy/best-response";
import acceptedV3 from "../configurable-v3/artifacts/configurable-river-v3.json";
import { auditConfigurableRiverV3Rules } from "../configurable-v3/oracle";
import { solveCompiledFactorizedRiverCfr } from "../factorized/cfr";
import { RIVER_BENCHMARKS, RIVER_BENCHMARK_SUITE_VERSION } from "./catalog";
import { exportRiverPolicy, gradeRiverPolicy, prepareRiverExchange } from "./exchange-node";

/** Deterministic reference evidence, deliberately excluding machine timings. */
export function createRiverBenchmarkManifest() {
  const benchmarks = RIVER_BENCHMARKS.map(benchmark => {
    const prepared = prepareRiverExchange(benchmark.request);
    const result = solveCompiledFactorizedRiverCfr(prepared.compiled, benchmark.solver);
    const policy = exportRiverPolicy(prepared, result.averageStrategy);
    const report = gradeRiverPolicy(prepared, JSON.parse(JSON.stringify(policy)));
    const readable = gradeStrategy(prepared.game, result.averageStrategy, prepared.compiled.index);
    const maximumGradeDifference = Math.max(
      ...report.value.map((value, player) => Math.abs(value - readable.value[player])),
      ...report.bestResponseValue.map((value, player) => Math.abs(value - readable.bestResponses[player].value)),
      ...report.gains.map((value, player) => Math.abs(value - readable.gains[player])),
      Math.abs(report.nashGap - readable.nashGap), Math.abs(report.exploitability - readable.exploitability),
    );
    const rulesAudit = auditConfigurableRiverV3Rules(prepared.game);
    if (maximumGradeDifference > 1e-9 || Math.max(
      rulesAudit.maximumProbabilityDifference, rulesAudit.maximumUtilityDifference, rulesAudit.maximumZeroSumError,
    ) > 1e-9) throw new Error(`${benchmark.id} failed independent reference checks`);
    if (benchmark.id === "v3-two-raise" && canonicalSolverJson(policy.strategy) !== canonicalSolverJson(acceptedV3.strategy)) {
      throw new Error("Exchange round trip changed the accepted v3 strategy");
    }
    return {
      id: benchmark.id, description: benchmark.description, solver: benchmark.solver,
      counts: prepared.exported.counts, report, rulesAudit, maximumGradeDifference,
    };
  });
  return {
    format: "poker-face-river-benchmark-manifest", schemaVersion: 1,
    suiteVersion: RIVER_BENCHMARK_SUITE_VERSION,
    scope: "reference-approximations-for-four-declared-finite-games-not-full-holdem-strength",
    benchmarks,
  };
}
