import { canonicalSolverJson } from "../toy/artifact";
import { gradeMultiwayStrategy } from "./best-response";
import type { MultiwayCfrSolveResult } from "./cfr";
import {
  buildMultiwayGameTreeIndex,
  validateMultiwayStrategy,
  type MultiwayBehavioralStrategy,
} from "./game";
import { multiwayRiverV1Game } from "./fixture";
import type { MultiwayIndependentAudit } from "./independent-node";
import type { MultiwayRiverAction } from "./river-game";
import { multiwayRiverDecisionFacts, type MultiwayDecisionFacts } from "./teaching";
import type { MultiwayRiverRulesAudit } from "./oracle";

export type SerializedMultiwayStrategy = Readonly<Record<
  string,
  Readonly<Partial<Record<MultiwayRiverAction, number>>>
>>;

export interface MultiwayConvergenceCheckpoint {
  readonly iteration: number;
  readonly value: readonly number[];
  readonly unilateralGains: readonly number[];
  readonly sumUnilateralGains: number;
  readonly maximumUnilateralGain: number;
}

export interface MultiwaySolveArtifactPayload {
  readonly schemaVersion: 1;
  readonly game: "three-player-river-v1";
  readonly resultLabel: "bounded-multiway-river-proof";
  readonly rules: {
    readonly version: 1;
    readonly playerCount: 3;
    readonly board: readonly string[];
    readonly ranges: readonly (readonly { readonly cards: string; readonly weight: number }[])[];
    readonly committedBeforeRiver: readonly number[];
    readonly stackBehind: readonly number[];
    readonly positions: readonly string[];
    readonly actionOrder: readonly number[];
    readonly betSize: number;
    readonly maximumRaises: 0;
    readonly exactPrivateEnumeration: true;
    readonly evaluator: "score7-v1";
  };
  readonly algorithm: "simultaneous-full-tree-cfr";
  readonly algorithmVersion: 1;
  readonly iterations: number;
  readonly rulesFingerprint: string;
  readonly tree: {
    readonly totalStates: number;
    readonly chanceNodes: number;
    readonly decisionNodes: number;
    readonly terminalNodes: number;
    readonly informationSets: number;
    readonly compatiblePrivateDeals: number;
  };
  readonly strategy: SerializedMultiwayStrategy;
  readonly value: readonly number[];
  readonly bestResponseValue: readonly number[];
  readonly unilateralGains: readonly number[];
  readonly sumUnilateralGains: number;
  readonly maximumUnilateralGain: number;
  readonly qualityMeasure: "maximum-unilateral-gain";
  readonly units: "net-chips-per-hand";
  readonly convergence: readonly MultiwayConvergenceCheckpoint[];
  readonly rulesAudit: MultiwayRiverRulesAudit;
  readonly independentChecks: MultiwayIndependentAudit;
  readonly independentOpenSourceReference: {
    readonly status: "no-pinned-matching-solver";
    readonly note: string;
  };
  readonly acceptance: {
    readonly maximumAllowedUnilateralGain: 0.45;
    readonly maximumAllowedAuditError: 1e-9;
    readonly maximumProfileZeroSumError: number;
    readonly passed: boolean;
  };
  readonly decisions: readonly MultiwayDecisionFacts[];
}

export interface MultiwaySolveArtifact extends MultiwaySolveArtifactPayload {
  readonly payloadHash: string;
}

export const MULTIWAY_ACCEPTANCE = {
  maximumUnilateralGain: 0.45,
  maximumAuditError: 1e-9,
  maximumArtifactBytes: 10 * 1024 * 1024,
  maximumRuntimeSeconds: 60,
  maximumResidentMemoryMiB: 1024,
} as const;

export function serializeMultiwayStrategy(
  strategy: MultiwayBehavioralStrategy<MultiwayRiverAction>,
): SerializedMultiwayStrategy {
  const serialized: Record<string, Partial<Record<MultiwayRiverAction, number>>> = {};
  for (const [key, entry] of [...strategy].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    serialized[key] = Object.fromEntries(
      entry.actions.map((action, actionIndex) => [action, entry.probabilities[actionIndex]]),
    );
  }
  return serialized;
}

export function deserializeMultiwayStrategy(
  serialized: SerializedMultiwayStrategy,
): MultiwayBehavioralStrategy<MultiwayRiverAction> {
  const index = buildMultiwayGameTreeIndex(multiwayRiverV1Game);
  if (
    Object.keys(serialized).length !== index.informationSets.length ||
    Object.keys(serialized).some(key => !index.informationSetByKey.has(key))
  ) throw new Error("Serialized multiway strategy does not match the game information sets");
  const strategy = new Map(index.informationSets.map(definition => {
    const stored = serialized[definition.key];
    if (!stored) throw new Error(`Missing serialized strategy at ${definition.key}`);
    if (
      Object.keys(stored).length !== definition.actions.length ||
      Object.keys(stored).some(action => !definition.actions.includes(action as MultiwayRiverAction))
    ) throw new Error(`Serialized actions do not match the game at ${definition.key}`);
    return [definition.key, {
      actions: [...definition.actions],
      probabilities: definition.actions.map(action => {
        const probability = stored[action];
        if (probability === undefined) throw new Error(`Missing ${action} at ${definition.key}`);
        return probability;
      }),
    }] as const;
  }));
  validateMultiwayStrategy(index, strategy);
  return strategy;
}

export function createMultiwayArtifactPayload(
  result: MultiwayCfrSolveResult<MultiwayRiverAction>,
  rulesFingerprint: string,
  rulesAudit: MultiwayRiverRulesAudit,
  independentChecks: MultiwayIndependentAudit,
): MultiwaySolveArtifactPayload {
  if (result.gameId !== multiwayRiverV1Game.id) throw new Error(`Cannot create artifact from ${result.gameId}`);
  if (!/^[a-f0-9]{64}$/.test(rulesFingerprint)) throw new Error(`Invalid rules fingerprint ${rulesFingerprint}`);
  const grade = gradeMultiwayStrategy(multiwayRiverV1Game, result.averageStrategy, result.index);
  const convergence = result.checkpoints.map(checkpoint => {
    const checkpointGrade = gradeMultiwayStrategy(
      multiwayRiverV1Game,
      checkpoint.averageStrategy,
      result.index,
    );
    return {
      iteration: checkpoint.iteration,
      value: checkpointGrade.value,
      unilateralGains: checkpointGrade.unilateralGains,
      sumUnilateralGains: checkpointGrade.sumUnilateralGains,
      maximumUnilateralGain: checkpointGrade.maximumUnilateralGain,
    };
  });
  const maximumProfileZeroSumError = Math.abs(grade.value.reduce((sum, value) => sum + value, 0));
  const maximumRulesError = Math.max(
    rulesAudit.maximumProbabilityDifference,
    rulesAudit.maximumUtilityDifference,
    rulesAudit.maximumZeroSumError,
  );
  const independentPassed =
    independentChecks.reducedBestResponse.maximumValueDifference <= MULTIWAY_ACCEPTANCE.maximumAuditError &&
    independentChecks.hiddenInformationBoundary.cheatingAdvantage > 0.01 &&
    independentChecks.headsUpAdapter.committedArtifactHashValid &&
    independentChecks.headsUpAdapter.treeCountsMatch &&
    independentChecks.headsUpAdapter.maximumValueDifference <= MULTIWAY_ACCEPTANCE.maximumAuditError &&
    independentChecks.headsUpAdapter.maximumBestResponseDifference <= MULTIWAY_ACCEPTANCE.maximumAuditError;
  const scenario = multiwayRiverV1Game.scenario;
  return {
    schemaVersion: 1,
    game: "three-player-river-v1",
    resultLabel: "bounded-multiway-river-proof",
    rules: {
      version: scenario.version,
      playerCount: 3,
      board: [...scenario.board],
      ranges: scenario.ranges.map(range => range.map(entry => ({
        cards: entry.cards.join(""),
        weight: entry.weight,
      }))),
      committedBeforeRiver: [...scenario.committed],
      stackBehind: [...scenario.stackBehind],
      positions: [...scenario.positions],
      actionOrder: [...scenario.actionOrder],
      betSize: scenario.betSize,
      maximumRaises: scenario.maxRaises,
      exactPrivateEnumeration: true,
      evaluator: "score7-v1",
    },
    algorithm: result.algorithm,
    algorithmVersion: result.algorithmVersion,
    iterations: result.iterations,
    rulesFingerprint,
    tree: {
      totalStates: result.index.totalStates,
      chanceNodes: result.index.chanceNodes,
      decisionNodes: result.index.decisionNodes,
      terminalNodes: result.index.terminalNodes,
      informationSets: result.index.informationSets.length,
      compatiblePrivateDeals: multiwayRiverV1Game.deals.length,
    },
    strategy: serializeMultiwayStrategy(result.averageStrategy),
    value: grade.value,
    bestResponseValue: grade.bestResponses.map(response => response.value),
    unilateralGains: grade.unilateralGains,
    sumUnilateralGains: grade.sumUnilateralGains,
    maximumUnilateralGain: grade.maximumUnilateralGain,
    qualityMeasure: "maximum-unilateral-gain",
    units: "net-chips-per-hand",
    convergence,
    rulesAudit,
    independentChecks,
    independentOpenSourceReference: {
      status: "no-pinned-matching-solver",
      note: "The audited open-source river solvers are heads-up; none matched this exact three-player game.",
    },
    acceptance: {
      maximumAllowedUnilateralGain: 0.45,
      maximumAllowedAuditError: 1e-9,
      maximumProfileZeroSumError,
      passed:
        grade.maximumUnilateralGain <= MULTIWAY_ACCEPTANCE.maximumUnilateralGain &&
        maximumRulesError <= MULTIWAY_ACCEPTANCE.maximumAuditError &&
        maximumProfileZeroSumError <= MULTIWAY_ACCEPTANCE.maximumAuditError &&
        independentPassed,
    },
    decisions: multiwayRiverDecisionFacts(multiwayRiverV1Game, result.averageStrategy),
  };
}

export function stringifyMultiwayArtifact(artifact: MultiwaySolveArtifact): string {
  return `${canonicalSolverJson(artifact, true)}\n`;
}
