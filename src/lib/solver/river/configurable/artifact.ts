import {
  canonicalSolverJson,
  deserializeBehavioralStrategy,
  serializeBehavioralStrategy,
  type SerializedBehavioralStrategy,
} from "../../toy/artifact";
import { gradeStrategy } from "../../toy/best-response";
import type { CfrSolveResult } from "../../toy/cfr";
import { buildGameTreeIndex, type BehavioralStrategy, type Utility } from "../../toy/game";
import {
  configurableRiverDecisionFacts,
  type ConfigurableRiverDecisionFacts,
} from "./explain";
import { configurableRiverV2DemoGame } from "./fixture";
import type { ConfigurableRiverAction } from "./game";
import type { ConfigurableRiverRulesAudit } from "./oracle";
import { CONFIGURABLE_RIVER_RANGE_PARSER_VERSION } from "./range";

export type SerializedConfigurableRiverStrategy = SerializedBehavioralStrategy<ConfigurableRiverAction>;

export interface ConfigurableRiverReferenceFixture {
  readonly schemaVersion: 2;
  readonly source: "noambrown/poker_solver";
  readonly repository: "https://github.com/noambrown/poker_solver";
  readonly commit: string;
  readonly license: "MIT";
  readonly game: "river_nlth";
  readonly algorithm: string;
  readonly iterations: number;
  readonly sourceStrategySha256: string;
  readonly mappedStrategy: SerializedConfigurableRiverStrategy;
  readonly value: Utility;
  readonly bestResponseValue: Utility;
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
  readonly exploitabilityConvention: "half-nash-gap";
  readonly exploitabilityUnits: "net-chips-per-hand";
  readonly comparison: {
    readonly exactSharedTree: true;
    readonly maximumBestResponseDifference: number;
    readonly exploitabilityDifference: number;
  };
  readonly provenance: Readonly<Record<string, string | readonly string[]>>;
}

export interface ConfigurableRiverSolveArtifactPayload {
  readonly schemaVersion: 2;
  readonly game: "river-configurable-v2";
  readonly rules: {
    readonly version: 2;
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
    readonly maximumRaisesAfterOpeningBet: 1;
  };
  readonly algorithm: "full-tree-cfr";
  readonly algorithmVersion: 1;
  readonly rulesFingerprint: string;
  readonly iterations: number;
  readonly preflight: typeof configurableRiverV2DemoGame.preflight;
  readonly tree: {
    readonly totalStates: number;
    readonly chanceNodes: number;
    readonly decisionNodes: number;
    readonly terminalNodes: number;
    readonly informationSets: number;
    readonly compatiblePrivateDeals: number;
  };
  readonly strategy: SerializedConfigurableRiverStrategy;
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
  readonly rulesAudit: ConfigurableRiverRulesAudit;
  readonly reference: ConfigurableRiverReferenceFixture;
  readonly acceptance: {
    readonly maximumExploitability: number;
    readonly referenceValueTolerance: number;
    readonly referenceValueDifference: number;
    readonly referenceMaximumExploitability: number;
    readonly maximumRulesAuditError: number;
    readonly passed: boolean;
  };
  readonly decisions: readonly ConfigurableRiverDecisionFacts[];
}

export interface ConfigurableRiverSolveArtifact extends ConfigurableRiverSolveArtifactPayload {
  readonly payloadHash: string;
}

const PINNED_REFERENCE_COMMIT = "6a10442877ffc8fd28af93e16e279b9bbdd97b2a";
const MAXIMUM_EXPLOITABILITY = 0.25;
const REFERENCE_VALUE_TOLERANCE = 0.25;
const MAXIMUM_RULES_AUDIT_ERROR = 1e-9;

export function serializeConfigurableRiverStrategy(
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
): SerializedConfigurableRiverStrategy {
  return serializeBehavioralStrategy(strategy);
}

export function deserializeConfigurableRiverStrategy(
  strategy: SerializedConfigurableRiverStrategy,
): BehavioralStrategy<ConfigurableRiverAction> {
  return deserializeBehavioralStrategy(buildGameTreeIndex(configurableRiverV2DemoGame), strategy);
}

function validateReference(reference: ConfigurableRiverReferenceFixture): void {
  if (
    reference.source !== "noambrown/poker_solver" ||
    reference.repository !== "https://github.com/noambrown/poker_solver" ||
    reference.commit !== PINNED_REFERENCE_COMMIT ||
    reference.license !== "MIT" ||
    !reference.comparison.exactSharedTree
  ) {
    throw new Error("Unexpected configurable river reference identity");
  }
  const strategy = deserializeConfigurableRiverStrategy(reference.mappedStrategy);
  const grade = gradeStrategy(configurableRiverV2DemoGame, strategy);
  if (
    Math.abs(grade.value[0] - reference.value[0]) > 1e-9 ||
    Math.abs(grade.exploitability - reference.exploitability) > 1e-9
  ) {
    throw new Error("Stored configurable river reference strategy does not reproduce its grade");
  }
}

export function createConfigurableRiverArtifactPayload(
  result: CfrSolveResult<ConfigurableRiverAction>,
  reference: ConfigurableRiverReferenceFixture,
  rulesFingerprint: string,
  rulesAudit: ConfigurableRiverRulesAudit,
): ConfigurableRiverSolveArtifactPayload {
  const game = configurableRiverV2DemoGame;
  if (result.gameId !== game.id) throw new Error(`Cannot create v2 artifact from ${result.gameId}`);
  if (!/^[a-f0-9]{64}$/.test(rulesFingerprint)) throw new Error("Invalid v2 rules fingerprint");
  validateReference(reference);
  const grade = gradeStrategy(game, result.averageStrategy, result.index);
  const convergence = result.checkpoints.map(checkpoint => {
    const checkpointGrade = gradeStrategy(game, checkpoint.averageStrategy, result.index);
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
  const referenceValueDifference = Math.abs(grade.value[0] - reference.value[0]);
  const passed = grade.exploitability <= MAXIMUM_EXPLOITABILITY &&
    reference.exploitability <= MAXIMUM_EXPLOITABILITY &&
    referenceValueDifference <= REFERENCE_VALUE_TOLERANCE &&
    maximumRulesError <= MAXIMUM_RULES_AUDIT_ERROR;
  const scenario = game.scenario;
  return {
    schemaVersion: 2,
    game: "river-configurable-v2",
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
      maximumRaisesAfterOpeningBet: scenario.maxRaises,
    },
    algorithm: result.algorithm,
    algorithmVersion: result.algorithmVersion,
    rulesFingerprint,
    iterations: result.iterations,
    preflight: game.preflight,
    tree: {
      totalStates: result.index.totalStates,
      chanceNodes: result.index.chanceNodes,
      decisionNodes: result.index.decisionNodes,
      terminalNodes: result.index.terminalNodes,
      informationSets: result.index.informationSets.length,
      compatiblePrivateDeals: game.deals.length,
    },
    strategy: serializeConfigurableRiverStrategy(result.averageStrategy),
    value: grade.value,
    bestResponseValue: [grade.bestResponses[0].value, grade.bestResponses[1].value],
    gains: grade.gains,
    nashGap: grade.nashGap,
    exploitability: grade.exploitability,
    exploitabilityConvention: "half-nash-gap",
    exploitabilityUnits: "net-chips-per-hand",
    convergence,
    rulesAudit,
    reference,
    acceptance: {
      maximumExploitability: MAXIMUM_EXPLOITABILITY,
      referenceValueTolerance: REFERENCE_VALUE_TOLERANCE,
      referenceValueDifference,
      referenceMaximumExploitability: MAXIMUM_EXPLOITABILITY,
      maximumRulesAuditError: MAXIMUM_RULES_AUDIT_ERROR,
      passed,
    },
    decisions: configurableRiverDecisionFacts(game, result.averageStrategy),
  };
}

export function stringifyConfigurableRiverArtifact(
  artifact: ConfigurableRiverSolveArtifact,
): string {
  return `${canonicalSolverJson(artifact, true)}\n`;
}

export const CONFIGURABLE_RIVER_ACCEPTANCE = {
  pinnedReferenceCommit: PINNED_REFERENCE_COMMIT,
  maximumExploitability: MAXIMUM_EXPLOITABILITY,
  referenceValueTolerance: REFERENCE_VALUE_TOLERANCE,
  maximumRulesAuditError: MAXIMUM_RULES_AUDIT_ERROR,
} as const;
