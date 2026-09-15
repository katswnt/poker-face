import { canonicalSolverJson } from "../toy/artifact";
import { gradeMultiwayStrategy } from "./best-response";
import type { MultiwayCfrSolveResult } from "./cfr";
import {
  buildMultiwayGameTreeIndex,
  validateMultiwayStrategy,
  type MultiwayBehavioralStrategy,
} from "./game";
import type { SidePotIndependentAudit } from "./side-pot-independent-node";
import type { SidePotRulesAudit } from "./side-pot-oracle";
import type { SidePotRiverAction } from "./side-pot-river-game";
import { sidePotRiverV1Game } from "./side-pot-fixture";
import { sidePotRiverDecisionFacts, type SidePotDecisionFacts } from "./side-pot-teaching";

export type SerializedSidePotStrategy = Readonly<Record<
  string,
  Readonly<Partial<Record<SidePotRiverAction, number>>>
>>;

export interface SidePotConvergenceCheckpoint {
  readonly iteration: number;
  readonly value: readonly number[];
  readonly unilateralGains: readonly number[];
  readonly sumUnilateralGains: number;
  readonly maximumUnilateralGain: number;
}

export interface SidePotSolveArtifactPayload {
  readonly schemaVersion: 1;
  readonly game: "three-player-side-pot-river-v1";
  readonly resultLabel: "bounded-multiway-side-pot-river-proof";
  readonly rules: {
    readonly version: 1;
    readonly playerCount: 3;
    readonly board: readonly string[];
    readonly ranges: readonly (readonly { readonly cards: string; readonly weight: number }[])[];
    readonly committedBeforeRiver: readonly [30, 30, 30];
    readonly stackBehind: readonly [30, 60, 60];
    readonly positions: readonly string[];
    readonly actionOrder: readonly [0, 1, 2];
    readonly openingBets: readonly [30, 60];
    readonly allInRaiseTo: 60;
    readonly maximumRaises: 1;
    readonly potModel: "layered-side-pots-v1";
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
  readonly strategy: SerializedSidePotStrategy;
  readonly value: readonly number[];
  readonly bestResponseValue: readonly number[];
  readonly unilateralGains: readonly number[];
  readonly sumUnilateralGains: number;
  readonly maximumUnilateralGain: number;
  readonly qualityMeasure: "maximum-unilateral-gain";
  readonly units: "net-chips-per-hand";
  readonly convergence: readonly SidePotConvergenceCheckpoint[];
  readonly rulesAudit: SidePotRulesAudit;
  readonly independentChecks: SidePotIndependentAudit;
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
  readonly decisions: readonly SidePotDecisionFacts[];
}

export interface SidePotSolveArtifact extends SidePotSolveArtifactPayload {
  readonly payloadHash: string;
}

export const SIDE_POT_ACCEPTANCE = {
  maximumUnilateralGain: 0.45,
  maximumAuditError: 1e-9,
  maximumArtifactBytes: 100 * 1024 * 1024,
  maximumRuntimeSeconds: 600,
  maximumResidentMemoryMiB: 4_096,
} as const;

export function serializeSidePotStrategy(
  strategy: MultiwayBehavioralStrategy<SidePotRiverAction>,
): SerializedSidePotStrategy {
  const serialized: Record<string, Partial<Record<SidePotRiverAction, number>>> = {};
  for (const [key, entry] of [...strategy].sort(([left], [right]) => left.localeCompare(right))) {
    serialized[key] = Object.fromEntries(
      entry.actions.map((action, actionIndex) => [action, entry.probabilities[actionIndex]]),
    );
  }
  return serialized;
}

export function deserializeSidePotStrategy(
  serialized: SerializedSidePotStrategy,
): MultiwayBehavioralStrategy<SidePotRiverAction> {
  const index = buildMultiwayGameTreeIndex(sidePotRiverV1Game);
  if (
    Object.keys(serialized).length !== index.informationSets.length ||
    Object.keys(serialized).some(key => !index.informationSetByKey.has(key))
  ) throw new Error("Serialized side-pot strategy does not match the game information sets");
  const strategy = new Map(index.informationSets.map(definition => {
    const stored = serialized[definition.key];
    if (!stored) throw new Error(`Missing serialized side-pot strategy at ${definition.key}`);
    if (
      Object.keys(stored).length !== definition.actions.length ||
      Object.keys(stored).some(action => !definition.actions.includes(action as SidePotRiverAction))
    ) throw new Error(`Serialized side-pot actions do not match the game at ${definition.key}`);
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

export function createSidePotArtifactPayload(
  result: MultiwayCfrSolveResult<SidePotRiverAction>,
  rulesFingerprint: string,
  rulesAudit: SidePotRulesAudit,
  independentChecks: SidePotIndependentAudit,
): SidePotSolveArtifactPayload {
  if (result.gameId !== sidePotRiverV1Game.id) throw new Error(`Cannot create artifact from ${result.gameId}`);
  if (!/^[a-f0-9]{64}$/.test(rulesFingerprint)) throw new Error(`Invalid rules fingerprint ${rulesFingerprint}`);
  const grade = gradeMultiwayStrategy(sidePotRiverV1Game, result.averageStrategy, result.index);
  const convergence = result.checkpoints.map(checkpoint => {
    const checkpointGrade = gradeMultiwayStrategy(
      sidePotRiverV1Game,
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
    rulesAudit.maximumLayerAmountDifference,
    rulesAudit.maximumZeroSumError,
  );
  const independentPassed =
    independentChecks.reducedBestResponse.maximumValueDifference <= SIDE_POT_ACCEPTANCE.maximumAuditError &&
    independentChecks.hiddenInformationBoundary.cheatingAdvantage > 0.01 &&
    independentChecks.priorArtifacts.noRaiseHashValid &&
    independentChecks.priorArtifacts.raisedHashValid &&
    independentChecks.priorArtifacts.twoSizeHashValid &&
    independentChecks.priorArtifacts.headsUpHashValid;
  const scenario = sidePotRiverV1Game.scenario;
  if (
    scenario.committed.join(",") !== "30,30,30" ||
    scenario.stackBehind.join(",") !== "30,60,60"
  ) throw new Error("Side-pot v1 artifact supports only the locked money configuration");
  return {
    schemaVersion: 1,
    game: "three-player-side-pot-river-v1",
    resultLabel: "bounded-multiway-side-pot-river-proof",
    rules: {
      version: scenario.version,
      playerCount: 3,
      board: [...scenario.board],
      ranges: scenario.ranges.map(range => range.map(entry => ({
        cards: entry.cards.join(""),
        weight: entry.weight,
      }))),
      committedBeforeRiver: [...scenario.committed] as [30, 30, 30],
      stackBehind: [...scenario.stackBehind] as [30, 60, 60],
      positions: [...scenario.positions],
      actionOrder: [...scenario.actionOrder] as [0, 1, 2],
      openingBets: [scenario.smallBet, scenario.allInBet],
      allInRaiseTo: scenario.allInBet,
      maximumRaises: scenario.maxRaises,
      potModel: "layered-side-pots-v1",
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
      compatiblePrivateDeals: sidePotRiverV1Game.deals.length,
      terminalActionHistories: 33,
    },
    strategy: serializeSidePotStrategy(result.averageStrategy),
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
      note: "The audited open-source river solvers are heads-up; none matches this exact three-player unequal-stack game.",
    },
    acceptance: {
      maximumAllowedUnilateralGain: 0.45,
      maximumAllowedAuditError: 1e-9,
      maximumProfileZeroSumError,
      passed:
        grade.maximumUnilateralGain <= SIDE_POT_ACCEPTANCE.maximumUnilateralGain &&
        maximumRulesError <= SIDE_POT_ACCEPTANCE.maximumAuditError &&
        rulesAudit.layerStructureMismatches === 0 &&
        maximumProfileZeroSumError <= SIDE_POT_ACCEPTANCE.maximumAuditError &&
        independentPassed,
    },
    decisions: sidePotRiverDecisionFacts(sidePotRiverV1Game, result.averageStrategy),
  };
}

export function stringifySidePotArtifact(artifact: SidePotSolveArtifact): string {
  return `${canonicalSolverJson(artifact, true)}\n`;
}
