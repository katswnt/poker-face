import { canonicalSolverJson } from "../toy/artifact";
import { gradeMultiwayStrategy } from "./best-response";
import type { MultiwayCfrSolveResult } from "./cfr";
import {
  buildMultiwayGameTreeIndex,
  validateMultiwayStrategy,
  type MultiwayBehavioralStrategy,
} from "./game";
import { fourPlayerRiverV1Game } from "./four-player-fixture";
import type { FourPlayerIndependentAudit } from "./four-player-independent-node";
import type { FourPlayerRulesAudit } from "./four-player-oracle";
import type { FourPlayerRiverAction } from "./four-player-river-game";
import {
  fourPlayerDecisionFacts,
  type FourPlayerDecisionFacts,
} from "./four-player-teaching";

export type SerializedFourPlayerStrategy = Readonly<Record<
  string,
  Readonly<Partial<Record<FourPlayerRiverAction, number>>>
>>;

export interface FourPlayerConvergenceCheckpoint {
  readonly iteration: number;
  readonly value: readonly number[];
  readonly unilateralGains: readonly number[];
  readonly sumUnilateralGains: number;
  readonly maximumUnilateralGain: number;
}

export interface FourPlayerSolveArtifactPayload {
  readonly schemaVersion: 1;
  readonly game: "four-player-river-v1";
  readonly resultLabel: "bounded-four-player-river-proof";
  readonly rules: {
    readonly version: 1;
    readonly playerCount: 4;
    readonly board: readonly string[];
    readonly ranges: readonly (readonly { readonly cards: string; readonly weight: number }[])[];
    readonly committedBeforeRiver: readonly [30, 30, 30, 30];
    readonly stackBehind: readonly [60, 60, 60, 60];
    readonly positions: readonly string[];
    readonly actionOrder: readonly [0, 1, 2, 3];
    readonly betSize: 30;
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
    readonly terminalActionHistories: 33;
  };
  readonly strategy: SerializedFourPlayerStrategy;
  readonly value: readonly number[];
  readonly bestResponseValue: readonly number[];
  readonly unilateralGains: readonly number[];
  readonly sumUnilateralGains: number;
  readonly maximumUnilateralGain: number;
  readonly qualityMeasure: "maximum-unilateral-gain";
  readonly units: "net-chips-per-hand";
  readonly convergence: readonly FourPlayerConvergenceCheckpoint[];
  readonly rulesAudit: FourPlayerRulesAudit;
  readonly independentChecks: FourPlayerIndependentAudit;
  readonly independentOpenSourceReference: {
    readonly status: "no-pinned-matching-solver";
    readonly note: string;
  };
  readonly acceptance: {
    readonly maximumAllowedUnilateralGain: 0.6;
    readonly maximumAllowedAuditError: 1e-9;
    readonly maximumProfileZeroSumError: number;
    readonly passed: boolean;
  };
  readonly decisions: readonly FourPlayerDecisionFacts[];
}

export interface FourPlayerSolveArtifact extends FourPlayerSolveArtifactPayload {
  readonly payloadHash: string;
}

export const FOUR_PLAYER_ACCEPTANCE = {
  maximumUnilateralGain: 0.6,
  maximumAuditError: 1e-9,
  maximumArtifactBytes: 100 * 1024 * 1024,
  maximumRuntimeSeconds: 600,
  maximumResidentMemoryMiB: 4_096,
} as const;

export function serializeFourPlayerStrategy(
  strategy: MultiwayBehavioralStrategy<FourPlayerRiverAction>,
): SerializedFourPlayerStrategy {
  const serialized: Record<string, Partial<Record<FourPlayerRiverAction, number>>> = {};
  for (const [key, entry] of [...strategy].sort(([left], [right]) => left.localeCompare(right))) {
    serialized[key] = Object.fromEntries(
      entry.actions.map((action, actionIndex) => [action, entry.probabilities[actionIndex]]),
    );
  }
  return serialized;
}

export function deserializeFourPlayerStrategy(
  serialized: SerializedFourPlayerStrategy,
): MultiwayBehavioralStrategy<FourPlayerRiverAction> {
  const index = buildMultiwayGameTreeIndex(fourPlayerRiverV1Game);
  if (
    Object.keys(serialized).length !== index.informationSets.length ||
    Object.keys(serialized).some(key => !index.informationSetByKey.has(key))
  ) throw new Error("Serialized four-player strategy does not match the game information sets");
  const strategy = new Map(index.informationSets.map(definition => {
    const stored = serialized[definition.key];
    if (!stored) throw new Error(`Missing serialized four-player strategy at ${definition.key}`);
    if (
      Object.keys(stored).length !== definition.actions.length ||
      Object.keys(stored).some(action => !definition.actions.includes(action as FourPlayerRiverAction))
    ) throw new Error(`Serialized four-player actions do not match the game at ${definition.key}`);
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

export function createFourPlayerArtifactPayload(
  result: MultiwayCfrSolveResult<FourPlayerRiverAction>,
  rulesFingerprint: string,
  rulesAudit: FourPlayerRulesAudit,
  independentChecks: FourPlayerIndependentAudit,
): FourPlayerSolveArtifactPayload {
  if (result.gameId !== fourPlayerRiverV1Game.id) {
    throw new Error(`Cannot create a four-player artifact from ${result.gameId}`);
  }
  if (!/^[a-f0-9]{64}$/.test(rulesFingerprint)) {
    throw new Error(`Invalid four-player rules fingerprint ${rulesFingerprint}`);
  }
  const grade = gradeMultiwayStrategy(fourPlayerRiverV1Game, result.averageStrategy, result.index);
  const convergence = result.checkpoints.map(checkpoint => {
    const checkpointGrade = gradeMultiwayStrategy(
      fourPlayerRiverV1Game,
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
    rulesAudit.maximumAwardDifference,
    rulesAudit.maximumPotDifference,
    rulesAudit.maximumZeroSumError,
  );
  const independentPassed =
    independentChecks.reducedBestResponse.maximumValueDifference <= FOUR_PLAYER_ACCEPTANCE.maximumAuditError &&
    independentChecks.hiddenInformationBoundary.cheatingAdvantage > 0.01 &&
    independentChecks.seatPermutation.maximumProbabilityDifference <= FOUR_PLAYER_ACCEPTANCE.maximumAuditError &&
    independentChecks.seatPermutation.maximumUtilityDifference <= FOUR_PLAYER_ACCEPTANCE.maximumAuditError &&
    independentChecks.deadMoneyReduction.maximumAwardDifference <= FOUR_PLAYER_ACCEPTANCE.maximumAuditError &&
    independentChecks.deadMoneyReduction.maximumUtilityDifference <= FOUR_PLAYER_ACCEPTANCE.maximumAuditError &&
    independentChecks.headsUpAdapter.treeMatches &&
    independentChecks.headsUpAdapter.maximumValueDifference <= FOUR_PLAYER_ACCEPTANCE.maximumAuditError &&
    independentChecks.headsUpAdapter.maximumBestResponseDifference <= FOUR_PLAYER_ACCEPTANCE.maximumAuditError &&
    Object.values(independentChecks.priorArtifacts).every(Boolean);
  const scenario = fourPlayerRiverV1Game.scenario;
  if (
    scenario.committed.join(",") !== "30,30,30,30" ||
    scenario.stackBehind.join(",") !== "60,60,60,60" ||
    scenario.actionOrder.join(",") !== "0,1,2,3"
  ) throw new Error("Four-player v1 artifact supports only the locked money and seat order");
  return {
    schemaVersion: 1,
    game: "four-player-river-v1",
    resultLabel: "bounded-four-player-river-proof",
    rules: {
      version: scenario.version,
      playerCount: 4,
      board: [...scenario.board],
      ranges: scenario.ranges.map(range => range.map(entry => ({
        cards: entry.cards.join(""),
        weight: entry.weight,
      }))),
      committedBeforeRiver: [...scenario.committed] as [30, 30, 30, 30],
      stackBehind: [...scenario.stackBehind] as [60, 60, 60, 60],
      positions: [...scenario.positions],
      actionOrder: [...scenario.actionOrder] as [0, 1, 2, 3],
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
      compatiblePrivateDeals: fourPlayerRiverV1Game.deals.length,
      terminalActionHistories: 33,
    },
    strategy: serializeFourPlayerStrategy(result.averageStrategy),
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
      note: "The audited open-source river solvers are heads-up; none matches this exact four-player game.",
    },
    acceptance: {
      maximumAllowedUnilateralGain: 0.6,
      maximumAllowedAuditError: 1e-9,
      maximumProfileZeroSumError,
      passed:
        grade.maximumUnilateralGain <= FOUR_PLAYER_ACCEPTANCE.maximumUnilateralGain &&
        maximumRulesError <= FOUR_PLAYER_ACCEPTANCE.maximumAuditError &&
        maximumProfileZeroSumError <= FOUR_PLAYER_ACCEPTANCE.maximumAuditError &&
        independentPassed,
    },
    decisions: fourPlayerDecisionFacts(fourPlayerRiverV1Game, result.averageStrategy),
  };
}

export function stringifyFourPlayerArtifact(artifact: FourPlayerSolveArtifact): string {
  return `${canonicalSolverJson(artifact, true)}\n`;
}
