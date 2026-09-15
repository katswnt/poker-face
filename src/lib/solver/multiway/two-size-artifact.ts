import { canonicalSolverJson } from "../toy/artifact";
import { gradeMultiwayStrategy } from "./best-response";
import type { MultiwayCfrSolveResult } from "./cfr";
import {
  buildMultiwayGameTreeIndex,
  validateMultiwayStrategy,
  type MultiwayBehavioralStrategy,
} from "./game";
import type { TwoSizeRiverIndependentAudit } from "./two-size-independent-node";
import type { TwoSizeRiverRulesAudit } from "./two-size-oracle";
import type { TwoSizeRiverAction } from "./two-size-river-game";
import { twoSizeRiverV1Game } from "./two-size-fixture";
import { twoSizeRiverDecisionFacts, type TwoSizeDecisionFacts } from "./two-size-teaching";

export type SerializedTwoSizeRiverStrategy = Readonly<Record<
  string,
  Readonly<Partial<Record<TwoSizeRiverAction, number>>>
>>;

export interface TwoSizeRiverConvergenceCheckpoint {
  readonly iteration: number;
  readonly value: readonly number[];
  readonly unilateralGains: readonly number[];
  readonly sumUnilateralGains: number;
  readonly maximumUnilateralGain: number;
}

export interface TwoSizeRiverSolveArtifactPayload {
  readonly schemaVersion: 1;
  readonly game: "three-player-two-size-river-v1";
  readonly resultLabel: "bounded-multiway-two-size-river-proof";
  readonly rules: {
    readonly version: 1;
    readonly playerCount: 3;
    readonly board: readonly string[];
    readonly ranges: readonly (readonly { readonly cards: string; readonly weight: number }[])[];
    readonly committedBeforeRiver: readonly number[];
    readonly stackBehind: readonly number[];
    readonly positions: readonly string[];
    readonly actionOrder: readonly number[];
    readonly openingBets: readonly [30, 60];
    readonly allInRaiseTo: 60;
    readonly maximumRaises: 1;
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
    readonly terminalActionHistories: 55;
  };
  readonly strategy: SerializedTwoSizeRiverStrategy;
  readonly value: readonly number[];
  readonly bestResponseValue: readonly number[];
  readonly unilateralGains: readonly number[];
  readonly sumUnilateralGains: number;
  readonly maximumUnilateralGain: number;
  readonly qualityMeasure: "maximum-unilateral-gain";
  readonly units: "net-chips-per-hand";
  readonly convergence: readonly TwoSizeRiverConvergenceCheckpoint[];
  readonly rulesAudit: TwoSizeRiverRulesAudit;
  readonly independentChecks: TwoSizeRiverIndependentAudit;
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
  readonly decisions: readonly TwoSizeDecisionFacts[];
}

export interface TwoSizeRiverSolveArtifact extends TwoSizeRiverSolveArtifactPayload {
  readonly payloadHash: string;
}

export const TWO_SIZE_RIVER_ACCEPTANCE = {
  maximumUnilateralGain: 0.45,
  maximumAuditError: 1e-9,
  maximumArtifactBytes: 100 * 1024 * 1024,
  maximumRuntimeSeconds: 600,
  maximumResidentMemoryMiB: 4_096,
} as const;

export function serializeTwoSizeRiverStrategy(
  strategy: MultiwayBehavioralStrategy<TwoSizeRiverAction>,
): SerializedTwoSizeRiverStrategy {
  const serialized: Record<string, Partial<Record<TwoSizeRiverAction, number>>> = {};
  for (const [key, entry] of [...strategy].sort(([left], [right]) => left.localeCompare(right))) {
    serialized[key] = Object.fromEntries(
      entry.actions.map((action, actionIndex) => [action, entry.probabilities[actionIndex]]),
    );
  }
  return serialized;
}

export function deserializeTwoSizeRiverStrategy(
  serialized: SerializedTwoSizeRiverStrategy,
): MultiwayBehavioralStrategy<TwoSizeRiverAction> {
  const index = buildMultiwayGameTreeIndex(twoSizeRiverV1Game);
  if (
    Object.keys(serialized).length !== index.informationSets.length ||
    Object.keys(serialized).some(key => !index.informationSetByKey.has(key))
  ) throw new Error("Serialized two-size strategy does not match the game information sets");
  const strategy = new Map(index.informationSets.map(definition => {
    const stored = serialized[definition.key];
    if (!stored) throw new Error(`Missing serialized two-size strategy at ${definition.key}`);
    if (
      Object.keys(stored).length !== definition.actions.length ||
      Object.keys(stored).some(action => !definition.actions.includes(action as TwoSizeRiverAction))
    ) throw new Error(`Serialized two-size actions do not match the game at ${definition.key}`);
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

export function createTwoSizeRiverArtifactPayload(
  result: MultiwayCfrSolveResult<TwoSizeRiverAction>,
  rulesFingerprint: string,
  rulesAudit: TwoSizeRiverRulesAudit,
  independentChecks: TwoSizeRiverIndependentAudit,
): TwoSizeRiverSolveArtifactPayload {
  if (result.gameId !== twoSizeRiverV1Game.id) throw new Error(`Cannot create artifact from ${result.gameId}`);
  if (!/^[a-f0-9]{64}$/.test(rulesFingerprint)) throw new Error(`Invalid rules fingerprint ${rulesFingerprint}`);
  const grade = gradeMultiwayStrategy(twoSizeRiverV1Game, result.averageStrategy, result.index);
  const convergence = result.checkpoints.map(checkpoint => {
    const checkpointGrade = gradeMultiwayStrategy(
      twoSizeRiverV1Game,
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
    rulesAudit.maximumReturnedUncalledDifference,
    rulesAudit.maximumContestablePotDifference,
    rulesAudit.maximumZeroSumError,
  );
  const independentPassed =
    independentChecks.reducedBestResponse.maximumValueDifference <= TWO_SIZE_RIVER_ACCEPTANCE.maximumAuditError &&
    independentChecks.hiddenInformationBoundary.cheatingAdvantage > 0.01 &&
    independentChecks.priorArtifacts.noRaiseHashValid &&
    independentChecks.priorArtifacts.raisedHashValid &&
    independentChecks.priorArtifacts.headsUpHashValid;
  const scenario = twoSizeRiverV1Game.scenario;
  if (scenario.smallBet !== 30 || scenario.allInBet !== 60) {
    throw new Error("Two-size v1 artifact only supports the locked 30 and 60 chip sizes");
  }
  return {
    schemaVersion: 1,
    game: "three-player-two-size-river-v1",
    resultLabel: "bounded-multiway-two-size-river-proof",
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
      openingBets: [scenario.smallBet, scenario.allInBet],
      allInRaiseTo: scenario.allInBet,
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
      compatiblePrivateDeals: twoSizeRiverV1Game.deals.length,
      terminalActionHistories: 55,
    },
    strategy: serializeTwoSizeRiverStrategy(result.averageStrategy),
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
      note: "The audited open-source river solvers are heads-up; none matches this exact three-player two-size game.",
    },
    acceptance: {
      maximumAllowedUnilateralGain: 0.45,
      maximumAllowedAuditError: 1e-9,
      maximumProfileZeroSumError,
      passed:
        grade.maximumUnilateralGain <= TWO_SIZE_RIVER_ACCEPTANCE.maximumUnilateralGain &&
        maximumRulesError <= TWO_SIZE_RIVER_ACCEPTANCE.maximumAuditError &&
        maximumProfileZeroSumError <= TWO_SIZE_RIVER_ACCEPTANCE.maximumAuditError &&
        independentPassed,
    },
    decisions: twoSizeRiverDecisionFacts(twoSizeRiverV1Game, result.averageStrategy),
  };
}

export function stringifyTwoSizeRiverArtifact(artifact: TwoSizeRiverSolveArtifact): string {
  return `${canonicalSolverJson(artifact, true)}\n`;
}
