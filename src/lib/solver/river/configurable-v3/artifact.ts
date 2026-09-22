import {
  canonicalSolverJson,
  deserializeBehavioralStrategy,
  serializeBehavioralStrategy,
  type SerializedBehavioralStrategy,
} from "../../toy/artifact";
import type { Utility } from "../../toy/game";
import type { ConfigurableRiverAction } from "../configurable/game";
import { CONFIGURABLE_RIVER_RANGE_PARSER_VERSION } from "../configurable/range";
import type { FactorizedRiverCfrResult } from "../factorized/cfr";
import { compileFactorizedRiverGame } from "../factorized/game";
import {
  compileFactorizedRiverScorekeeper,
  gradeFactorizedRiverStrategy,
} from "../factorized/scorekeeper";
import { configurableRiverV3DemoGame } from "./fixture";
import type { ConfigurableRiverV3RulesAudit } from "./oracle";

export type SerializedConfigurableRiverV3Strategy =
  SerializedBehavioralStrategy<ConfigurableRiverAction>;

export interface ConfigurableRiverV3ArtifactPayload {
  readonly schemaVersion: 3;
  readonly game: "river-configurable-v3";
  readonly rules: {
    readonly version: 3;
    readonly rangeParserVersion: number;
    readonly board: readonly string[];
    readonly ranges: readonly [
      readonly { readonly cards: string; readonly weight: number }[],
      readonly { readonly cards: string; readonly weight: number }[],
    ];
    readonly committedBeforeRiver: readonly [number, number];
    readonly stackBehind: readonly [number, number];
    readonly positions: readonly ["out-of-position", "in-position"];
    readonly actionOrder: readonly [0, 1];
    readonly openingBetSizes: readonly number[];
    readonly raiseToSizes: readonly number[];
    readonly maximumRaisesAfterOpeningBet: 2;
  };
  readonly algorithm: "factorized-river-alternating-cfr-plus";
  readonly algorithmVersion: 1;
  readonly rulesFingerprint: string;
  readonly iterations: number;
  readonly averagingDelay: number;
  readonly traversal: {
    readonly regretPasses: number;
    readonly reachOnlyPasses: number;
  };
  readonly preflight: typeof configurableRiverV3DemoGame.preflight;
  readonly factorizedTree: {
    readonly publicStates: number;
    readonly equivalentRepeatedStates: number;
    readonly informationSets: number;
    readonly compatiblePrivateDeals: number;
    readonly actionSlots: number;
    readonly structuralTypedBytes: number;
    readonly solveWorkingBytes: number;
  };
  readonly strategy: SerializedConfigurableRiverV3Strategy;
  readonly value: Utility;
  readonly bestResponseValue: Utility;
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
  readonly exploitabilityConvention: "half-nash-gap";
  readonly exploitabilityUnits: "net-chips-per-hand";
  readonly convergence: readonly {
    readonly iteration: number;
    readonly value: Utility;
    readonly gains: Utility;
    readonly nashGap: number;
    readonly exploitability: number;
  }[];
  readonly rulesAudit: ConfigurableRiverV3RulesAudit;
  readonly independentChecks: {
    readonly exactV2OneRaiseReduction: true;
    readonly ordinaryCfrMaximumDifference: number;
    readonly factorizedGradeMaximumDifference: number;
    readonly hiddenOpponentCardsExcluded: true;
  };
  readonly acceptance: {
    readonly maximumExploitability: number;
    readonly maximumRulesAuditError: number;
    readonly maximumDifferentialError: number;
    readonly passed: boolean;
  };
  readonly teaching: {
    readonly decisionCount: number;
    readonly bulkExportStateLimit: 100_000;
    readonly decisionsSha256: string;
  };
}

export interface ConfigurableRiverV3Artifact extends ConfigurableRiverV3ArtifactPayload {
  readonly payloadHash: string;
}

export const CONFIGURABLE_RIVER_V3_ACCEPTANCE = {
  maximumExploitability: 0.25,
  maximumRulesAuditError: 1e-9,
  maximumDifferentialError: 1e-10,
} as const;

export function deserializeConfigurableRiverV3Strategy(
  strategy: SerializedConfigurableRiverV3Strategy,
) {
  const compiled = compileFactorizedRiverGame(configurableRiverV3DemoGame);
  return deserializeBehavioralStrategy(compiled.index, strategy);
}

export function createConfigurableRiverV3ArtifactPayload(
  result: FactorizedRiverCfrResult,
  rulesFingerprint: string,
  rulesAudit: ConfigurableRiverV3RulesAudit,
  teaching: ConfigurableRiverV3ArtifactPayload["teaching"],
  independentChecks: ConfigurableRiverV3ArtifactPayload["independentChecks"],
): ConfigurableRiverV3ArtifactPayload {
  if (result.gameId !== configurableRiverV3DemoGame.id) {
    throw new Error(`Cannot create v3 artifact from ${result.gameId}`);
  }
  if (result.algorithm !== "factorized-river-alternating-cfr-plus") {
    throw new Error(`v3 artifact requires factorized CFR+, received ${result.algorithm}`);
  }
  if (!/^[a-f0-9]{64}$/.test(rulesFingerprint)) throw new Error("Invalid v3 rules fingerprint");
  const scorekeeper = compileFactorizedRiverScorekeeper(result.compiled);
  const grade = gradeFactorizedRiverStrategy(scorekeeper, result.averageStrategy);
  const convergence = result.checkpoints.map(checkpoint => {
    const checkpointGrade = gradeFactorizedRiverStrategy(scorekeeper, checkpoint.averageStrategy);
    return {
      iteration: checkpoint.iteration,
      value: checkpointGrade.value,
      gains: checkpointGrade.gains,
      nashGap: checkpointGrade.nashGap,
      exploitability: checkpointGrade.exploitability,
    };
  });
  const maximumRulesError = Math.max(
    rulesAudit.maximumProbabilityDifference,
    rulesAudit.maximumUtilityDifference,
    rulesAudit.maximumZeroSumError,
  );
  const maximumDifferentialError = Math.max(
    independentChecks.ordinaryCfrMaximumDifference,
    independentChecks.factorizedGradeMaximumDifference,
  );
  const acceptance = CONFIGURABLE_RIVER_V3_ACCEPTANCE;
  const passed = grade.exploitability <= acceptance.maximumExploitability &&
    maximumRulesError <= acceptance.maximumRulesAuditError &&
    maximumDifferentialError <= acceptance.maximumDifferentialError;
  const scenario = configurableRiverV3DemoGame.scenario;
  if (scenario.maxRaises !== 2) throw new Error("The locked v3 artifact must permit two raises");
  return {
    schemaVersion: 3,
    game: "river-configurable-v3",
    rules: {
      version: scenario.version,
      rangeParserVersion: CONFIGURABLE_RIVER_RANGE_PARSER_VERSION,
      board: [...scenario.board],
      ranges: [
        scenario.ranges[0].map(item => ({ cards: item.cards.join(""), weight: item.weight })),
        scenario.ranges[1].map(item => ({ cards: item.cards.join(""), weight: item.weight })),
      ],
      committedBeforeRiver: [...scenario.committed],
      stackBehind: [...scenario.stackBehind],
      positions: [...scenario.positions],
      actionOrder: [...scenario.actionOrder],
      openingBetSizes: [...scenario.openingBetSizes],
      raiseToSizes: [...scenario.raiseToSizes],
      maximumRaisesAfterOpeningBet: 2,
    },
    algorithm: result.algorithm,
    algorithmVersion: result.algorithmVersion,
    rulesFingerprint,
    iterations: result.iterations,
    averagingDelay: result.averagingDelay,
    traversal: {
      regretPasses: result.fullDealRegretPasses,
      reachOnlyPasses: result.reachOnlyPasses,
    },
    preflight: configurableRiverV3DemoGame.preflight,
    factorizedTree: {
      publicStates: result.compiled.publicNodeCount,
      equivalentRepeatedStates: result.compiled.equivalentRepeatedStates,
      informationSets: result.compiled.index.informationSets.length,
      compatiblePrivateDeals: result.compiled.dealProbabilities.length,
      actionSlots: result.compiled.actionSlotCount,
      structuralTypedBytes: result.compiled.typedStorageBytes,
      solveWorkingBytes: result.workingStorageBytes,
    },
    strategy: serializeBehavioralStrategy(result.averageStrategy),
    value: grade.value,
    bestResponseValue: [grade.bestResponses[0].value, grade.bestResponses[1].value],
    gains: grade.gains,
    nashGap: grade.nashGap,
    exploitability: grade.exploitability,
    exploitabilityConvention: "half-nash-gap",
    exploitabilityUnits: "net-chips-per-hand",
    convergence,
    rulesAudit,
    independentChecks,
    acceptance: {
      ...acceptance,
      passed,
    },
    teaching,
  };
}

export function stringifyConfigurableRiverV3Artifact(
  artifact: ConfigurableRiverV3Artifact,
): string {
  return `${canonicalSolverJson(artifact, true)}\n`;
}
