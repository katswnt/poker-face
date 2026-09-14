import {
  canonicalSolverJson,
  deserializeBehavioralStrategy,
  serializeBehavioralStrategy,
  type SerializedBehavioralStrategy,
} from "../toy/artifact";
import { gradeStrategy } from "../toy/best-response";
import type { CfrSolveResult } from "../toy/cfr";
import { buildGameTreeIndex, type BehavioralStrategy, type Utility } from "../toy/game";
import { riverDecisionFacts, type RiverDecisionFacts } from "./explain";
import { riverV1Game } from "./fixture";
import type { RiverAction } from "./game";
import type { RiverRulesAudit } from "./oracle";

export type SerializedRiverStrategy = SerializedBehavioralStrategy<RiverAction>;

export interface RiverReferenceFixture {
  readonly schemaVersion: 1;
  readonly source: "noambrown/poker_solver";
  readonly repository: "https://github.com/noambrown/poker_solver";
  readonly commit: string;
  readonly license: "MIT";
  readonly game: "river_nlth";
  readonly algorithm: string;
  readonly iterations: number;
  readonly sourceStrategySha256: string;
  readonly mappedStrategy: SerializedRiverStrategy;
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
  readonly provenance: {
    readonly adapter: string;
    readonly config: string;
    readonly command: string;
    readonly utilityTranslation: string;
    readonly maxRaisesTranslation: string;
    readonly showdownPath: string;
    readonly notes: readonly string[];
  };
}

export interface RiverConvergenceCheckpoint {
  readonly iteration: number;
  readonly value: Utility;
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
}

export interface RiverSolveArtifactPayload {
  readonly schemaVersion: 1;
  readonly game: "river-holdem-v1";
  readonly rules: {
    readonly version: 1;
    readonly board: readonly string[];
    readonly ranges: readonly [
      readonly { readonly cards: string; readonly weight: number }[],
      readonly { readonly cards: string; readonly weight: number }[],
    ];
    readonly committedBeforeRiver: readonly [number, number];
    readonly stackBehind: readonly [number, number];
    readonly positions: readonly ["out-of-position", "in-position"];
    readonly betSizes: { readonly halfPot: number; readonly pot: number };
    readonly maximumRaisesAfterOpeningBet: 1;
  };
  readonly algorithm: "full-tree-cfr";
  readonly algorithmVersion: 1;
  /** SHA-256 of all rules, chance edges, information sets, actions, and payoffs. */
  readonly rulesFingerprint: string;
  readonly iterations: number;
  readonly tree: {
    readonly totalStates: number;
    readonly chanceNodes: number;
    readonly decisionNodes: number;
    readonly terminalNodes: number;
    readonly informationSets: number;
    readonly compatiblePrivateDeals: number;
  };
  readonly strategy: SerializedRiverStrategy;
  readonly value: Utility;
  readonly bestResponseValue: Utility;
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
  readonly exploitabilityConvention: "half-nash-gap";
  readonly exploitabilityUnits: "net-chips-per-hand";
  readonly convergence: readonly RiverConvergenceCheckpoint[];
  readonly rulesAudit: RiverRulesAudit;
  readonly reference: RiverReferenceFixture;
  readonly acceptance: {
    readonly maximumExploitability: number;
    readonly referenceValueTolerance: number;
    readonly referenceValueDifference: number;
    readonly referenceMaximumExploitability: number;
    readonly maximumRulesAuditError: number;
    readonly passed: boolean;
  };
  readonly decisions: readonly RiverDecisionFacts[];
}

export interface RiverSolveArtifact extends RiverSolveArtifactPayload {
  readonly payloadHash: string;
}

const PINNED_REFERENCE_COMMIT = "6a10442877ffc8fd28af93e16e279b9bbdd97b2a";
const MAXIMUM_EXPLOITABILITY = 0.25;
const REFERENCE_VALUE_TOLERANCE = 0.25;
const MAXIMUM_RULES_AUDIT_ERROR = 1e-9;

function finiteUtility(value: Utility): boolean {
  return value.every(Number.isFinite) && Math.abs(value[0] + value[1]) <= 1e-9;
}

function validateReference(reference: RiverReferenceFixture): void {
  if (
    reference.source !== "noambrown/poker_solver" ||
    reference.repository !== "https://github.com/noambrown/poker_solver" ||
    reference.game !== "river_nlth" ||
    reference.license !== "MIT"
  ) {
    throw new Error("Unexpected river reference identity");
  }
  if (reference.commit !== PINNED_REFERENCE_COMMIT) {
    throw new Error(`Unexpected river reference commit ${reference.commit}`);
  }
  if (!Number.isSafeInteger(reference.iterations) || reference.iterations <= 0) {
    throw new Error(`Invalid river reference iteration count ${reference.iterations}`);
  }
  if (
    !finiteUtility(reference.value) ||
    !reference.bestResponseValue.every(Number.isFinite) ||
    !reference.gains.every(value => Number.isFinite(value) && value >= 0) ||
    !Number.isFinite(reference.exploitability) || reference.exploitability < 0 ||
    reference.exploitabilityConvention !== "half-nash-gap" ||
    reference.exploitabilityUnits !== "net-chips-per-hand" ||
    !reference.comparison.exactSharedTree
  ) {
    throw new Error("Invalid river reference measurements");
  }
  const referenceStrategy = deserializeRiverStrategy(reference.mappedStrategy);
  const referenceGrade = gradeStrategy(riverV1Game, referenceStrategy);
  if (
    Math.abs(referenceGrade.value[0] - reference.value[0]) > 1e-12 ||
    Math.abs(referenceGrade.bestResponses[0].value - reference.bestResponseValue[0]) > 1e-12 ||
    Math.abs(referenceGrade.bestResponses[1].value - reference.bestResponseValue[1]) > 1e-12 ||
    Math.abs(referenceGrade.exploitability - reference.exploitability) > 1e-12
  ) {
    throw new Error("Stored river reference strategy does not reproduce its grade");
  }
}

export function serializeRiverStrategy(
  strategy: BehavioralStrategy<RiverAction>,
): SerializedRiverStrategy {
  return serializeBehavioralStrategy(strategy);
}

export function deserializeRiverStrategy(
  serialized: SerializedRiverStrategy,
): BehavioralStrategy<RiverAction> {
  return deserializeBehavioralStrategy(buildGameTreeIndex(riverV1Game), serialized);
}

export function createRiverSolveArtifactPayload(
  result: CfrSolveResult<RiverAction>,
  reference: RiverReferenceFixture,
  rulesFingerprint: string,
  rulesAudit: RiverRulesAudit,
): RiverSolveArtifactPayload {
  if (result.gameId !== riverV1Game.id) {
    throw new Error(`Cannot create a river artifact from ${result.gameId}`);
  }
  validateReference(reference);
  if (!/^[a-f0-9]{64}$/.test(rulesFingerprint)) {
    throw new Error(`Invalid river rules fingerprint ${rulesFingerprint}`);
  }
  const grade = gradeStrategy(riverV1Game, result.averageStrategy, result.index);
  const convergence = result.checkpoints.map(checkpoint => {
    const checkpointGrade = gradeStrategy(riverV1Game, checkpoint.averageStrategy, result.index);
    return {
      iteration: checkpoint.iteration,
      value: checkpointGrade.value,
      gains: checkpointGrade.gains,
      nashGap: checkpointGrade.nashGap,
      exploitability: checkpointGrade.exploitability,
    };
  });
  const referenceValueDifference = Math.abs(grade.value[0] - reference.value[0]);
  const maximumRulesError = Math.max(
    rulesAudit.maximumProbabilityDifference,
    rulesAudit.maximumUtilityDifference,
    rulesAudit.maximumZeroSumError,
  );
  const passed =
    grade.exploitability <= MAXIMUM_EXPLOITABILITY &&
    referenceValueDifference <= REFERENCE_VALUE_TOLERANCE &&
    reference.exploitability <= MAXIMUM_EXPLOITABILITY &&
    maximumRulesError <= MAXIMUM_RULES_AUDIT_ERROR;

  const scenario = riverV1Game.scenario;
  return {
    schemaVersion: 1,
    game: "river-holdem-v1",
    rules: {
      version: scenario.version,
      board: [...scenario.board],
      ranges: [
        scenario.ranges[0].map(entry => ({ cards: entry.cards.join(""), weight: entry.weight })),
        scenario.ranges[1].map(entry => ({ cards: entry.cards.join(""), weight: entry.weight })),
      ],
      committedBeforeRiver: [...scenario.committed],
      stackBehind: [...scenario.stackBehind],
      positions: [...scenario.positions],
      betSizes: { ...scenario.betSizes },
      maximumRaisesAfterOpeningBet: scenario.maxRaises,
    },
    algorithm: result.algorithm,
    algorithmVersion: result.algorithmVersion,
    rulesFingerprint,
    iterations: result.iterations,
    tree: {
      totalStates: result.index.totalStates,
      chanceNodes: result.index.chanceNodes,
      decisionNodes: result.index.decisionNodes,
      terminalNodes: result.index.terminalNodes,
      informationSets: result.index.informationSets.length,
      compatiblePrivateDeals: riverV1Game.deals.length,
    },
    strategy: serializeRiverStrategy(result.averageStrategy),
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
    decisions: riverDecisionFacts(riverV1Game, result.averageStrategy),
  };
}

export function stringifyRiverArtifact(artifact: RiverSolveArtifact): string {
  return `${canonicalSolverJson(artifact, true)}\n`;
}

export const RIVER_ACCEPTANCE = {
  pinnedReferenceCommit: PINNED_REFERENCE_COMMIT,
  maximumExploitability: MAXIMUM_EXPLOITABILITY,
  referenceValueTolerance: REFERENCE_VALUE_TOLERANCE,
  maximumRulesAuditError: MAXIMUM_RULES_AUDIT_ERROR,
} as const;
