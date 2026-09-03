import {
  buildGameTreeIndex,
  type BehavioralStrategy,
  type Utility,
} from "./game";
import {
  canonicalSolverJson,
  deserializeBehavioralStrategy,
  serializeBehavioralStrategy,
  type SerializedBehavioralStrategy,
} from "./artifact";
import { gradeStrategy } from "./best-response";
import type { CfrSolveResult } from "./cfr";
import { leducGame, type LeducAction } from "./leduc";

export type SerializedLeducStrategy = SerializedBehavioralStrategy<LeducAction>;

export interface LeducReferenceResult {
  readonly source: "noambrown/poker_solver";
  readonly commit: string;
  readonly game: "leduc";
  readonly algorithm: "cfr";
  readonly iterations: number;
  readonly value: Utility;
  readonly exploitability: number;
  readonly provenance: {
    readonly runtime: string;
    readonly command: string;
    readonly valueDefinition: string;
    readonly exploitabilityDefinition: string;
  };
}

export interface LeducConvergenceCheckpoint {
  readonly iteration: number;
  readonly value: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
}

export interface LeducSolveArtifactPayload {
  readonly schemaVersion: 1;
  readonly game: "leduc-v1";
  readonly algorithm: "full-tree-cfr";
  readonly algorithmVersion: 1;
  readonly iterations: number;
  readonly tree: {
    readonly totalStates: number;
    readonly chanceNodes: number;
    readonly decisionNodes: number;
    readonly terminalNodes: number;
    readonly informationSets: number;
  };
  readonly strategy: SerializedLeducStrategy;
  readonly value: Utility;
  readonly bestResponseValue: Utility;
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
  readonly exploitabilityConvention: "half-nash-gap";
  readonly exploitabilityUnits: "net-chips-per-hand";
  readonly convergence: readonly LeducConvergenceCheckpoint[];
  readonly reference: LeducReferenceResult;
  readonly acceptance: {
    readonly player0ValueTolerance: number;
    readonly maximumExploitability: number;
    readonly referenceValueDifference: number;
    readonly passed: boolean;
  };
}

export interface LeducSolveArtifact extends LeducSolveArtifactPayload {
  readonly payloadHash: string;
}

const PINNED_REFERENCE_COMMIT = "6a10442877ffc8fd28af93e16e279b9bbdd97b2a";
const VALUE_TOLERANCE = 0.001;
const MAXIMUM_EXPLOITABILITY = 0.01;

function validateReference(reference: LeducReferenceResult): void {
  if (
    reference.source !== "noambrown/poker_solver" ||
    reference.game !== "leduc" ||
    reference.algorithm !== "cfr"
  ) {
    throw new Error("Unexpected Leduc reference identity");
  }
  if (reference.commit !== PINNED_REFERENCE_COMMIT) {
    throw new Error(`Unexpected Leduc reference commit ${reference.commit}`);
  }
  if (reference.iterations <= 0 || !Number.isSafeInteger(reference.iterations)) {
    throw new Error(`Invalid Leduc reference iteration count ${reference.iterations}`);
  }
  if (
    !reference.value.every(Number.isFinite) ||
    Math.abs(reference.value[0] + reference.value[1]) > 1e-12 ||
    !Number.isFinite(reference.exploitability) || reference.exploitability < 0
  ) {
    throw new Error("Invalid Leduc reference measurements");
  }
}

export function serializeLeducStrategy(
  strategy: BehavioralStrategy<LeducAction>,
): SerializedLeducStrategy {
  return serializeBehavioralStrategy(strategy);
}

export function deserializeLeducStrategy(
  serialized: SerializedLeducStrategy,
): BehavioralStrategy<LeducAction> {
  return deserializeBehavioralStrategy(buildGameTreeIndex(leducGame), serialized);
}

export function createLeducSolveArtifactPayload(
  result: CfrSolveResult<LeducAction>,
  reference: LeducReferenceResult,
): LeducSolveArtifactPayload {
  if (result.gameId !== leducGame.id) {
    throw new Error(`Cannot create a Leduc artifact from ${result.gameId}`);
  }
  validateReference(reference);

  const grade = gradeStrategy(leducGame, result.averageStrategy, result.index);
  const convergence = result.checkpoints.map(checkpoint => {
    const checkpointGrade = gradeStrategy(leducGame, checkpoint.averageStrategy, result.index);
    return {
      iteration: checkpoint.iteration,
      value: checkpointGrade.value,
      nashGap: checkpointGrade.nashGap,
      exploitability: checkpointGrade.exploitability,
    };
  });
  const referenceValueDifference = Math.abs(grade.value[0] - reference.value[0]);
  const passed =
    referenceValueDifference <= VALUE_TOLERANCE &&
    grade.exploitability <= MAXIMUM_EXPLOITABILITY &&
    reference.exploitability <= MAXIMUM_EXPLOITABILITY;

  return {
    schemaVersion: 1,
    game: "leduc-v1",
    algorithm: result.algorithm,
    algorithmVersion: result.algorithmVersion,
    iterations: result.iterations,
    tree: {
      totalStates: result.index.totalStates,
      chanceNodes: result.index.chanceNodes,
      decisionNodes: result.index.decisionNodes,
      terminalNodes: result.index.terminalNodes,
      informationSets: result.index.informationSets.length,
    },
    strategy: serializeLeducStrategy(result.averageStrategy),
    value: grade.value,
    bestResponseValue: [grade.bestResponses[0].value, grade.bestResponses[1].value],
    gains: grade.gains,
    nashGap: grade.nashGap,
    exploitability: grade.exploitability,
    exploitabilityConvention: "half-nash-gap",
    exploitabilityUnits: "net-chips-per-hand",
    convergence,
    reference,
    acceptance: {
      player0ValueTolerance: VALUE_TOLERANCE,
      maximumExploitability: MAXIMUM_EXPLOITABILITY,
      referenceValueDifference,
      passed,
    },
  };
}

export function stringifyLeducArtifact(artifact: LeducSolveArtifact): string {
  return `${canonicalSolverJson(artifact, true)}\n`;
}

export const LEDUC_ACCEPTANCE = {
  pinnedReferenceCommit: PINNED_REFERENCE_COMMIT,
  player0ValueTolerance: VALUE_TOLERANCE,
  maximumExploitability: MAXIMUM_EXPLOITABILITY,
} as const;
