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
import { leducDecisionFacts, type LeducDecisionFacts } from "./leduc-explain";
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

export interface LeducAcceptance {
  readonly player0ValueTolerance: number;
  readonly maximumExploitability: number;
  /** Certified converged game value used as the correctness gate. */
  readonly convergedReferenceValue: number;
  readonly convergedReferenceValueDifference: number;
  /** [v0 - gain1, v0 + gain0]: the true game value must lie here for this strategy. */
  readonly certifiedValueInterval: readonly [number, number];
  readonly certificateContainsConvergedReference: boolean;
  /** Informational only: Brown's reference is an unconverged 1,600-iteration CFR run. */
  readonly brownReferenceValueDifference: number;
  readonly passed: boolean;
}

export interface LeducSolveArtifactPayload {
  readonly schemaVersion: 3;
  readonly game: "leduc-v1";
  readonly algorithm: "full-tree-cfr";
  readonly algorithmVersion: 1;
  /** SHA-256 of every chance edge, public decision, information set, and terminal payoff. */
  readonly rulesFingerprint: string;
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
  readonly acceptance: LeducAcceptance;
  readonly decisions: readonly LeducDecisionFacts[];
}

export interface LeducSolveArtifact extends LeducSolveArtifactPayload {
  readonly payloadHash: string;
}

const PINNED_REFERENCE_COMMIT = "6a10442877ffc8fd28af93e16e279b9bbdd97b2a";
const VALUE_TOLERANCE = 0.001;
const MAXIMUM_EXPLOITABILITY = 0.01;

/**
 * Converged value of this Leduc variant (1-chip then 2-chip bets, one raise per round),
 * player 0's net chips per hand.
 *
 * Provenance: CFR+ (alternating updates, linearly weighted average) run for 20,000
 * iterations by a Leduc tree builder and solver written independently of this
 * directory. The resulting strategy is checked in at
 * test/fixtures/solver/leduc-cfr-plus-20k-reference.json, and
 * test/audit-regressions-toy.test.ts re-grades it with this repo's exact best response:
 * gains [7.0e-6, 3.1e-6], exploitability 5.1e-6 chips, so the true game value lies in
 * `certifiedInterval` (width 1.0e-5, 100x tighter than VALUE_TOLERANCE). Brown's
 * pinned 1,600-iteration value (-0.053540) sits 0.00108 outside that interval, which is
 * why it is kept only as an informational comparison.
 */
export const LEDUC_CONVERGED_REFERENCE = {
  value: -0.05245578203316426,
  certifiedInterval: [-0.052458894979468526, -0.052448778404938515],
  exploitability: 0.000005058287265005679,
  iterations: 20_000,
  algorithm: "cfr-plus-linear-average",
  strategyFixture: "test/fixtures/solver/leduc-cfr-plus-20k-reference.json",
} as const;

export interface LeducMeasuredResult {
  readonly value: Utility;
  readonly gains: Utility;
  readonly exploitability: number;
}

/**
 * Gate a measured strategy against the converged reference. Passing requires (a) the
 * player-0 value within VALUE_TOLERANCE of the converged value, (b) the strategy's own
 * best-response certificate [v0 - gain1, v0 + gain0] to contain that value, and
 * (c) exploitability within MAXIMUM_EXPLOITABILITY. Brown's value is reported only.
 */
export function evaluateLeducAcceptance(
  measured: LeducMeasuredResult,
  brownReference: LeducReferenceResult,
): LeducAcceptance {
  const convergedReferenceValue = LEDUC_CONVERGED_REFERENCE.value;
  const convergedReferenceValueDifference = Math.abs(measured.value[0] - convergedReferenceValue);
  const certifiedValueInterval: readonly [number, number] = [
    measured.value[0] - measured.gains[1],
    measured.value[0] + measured.gains[0],
  ];
  const certificateContainsConvergedReference =
    certifiedValueInterval[0] <= convergedReferenceValue &&
    convergedReferenceValue <= certifiedValueInterval[1];
  return {
    player0ValueTolerance: VALUE_TOLERANCE,
    maximumExploitability: MAXIMUM_EXPLOITABILITY,
    convergedReferenceValue,
    convergedReferenceValueDifference,
    certifiedValueInterval,
    certificateContainsConvergedReference,
    brownReferenceValueDifference: Math.abs(measured.value[0] - brownReference.value[0]),
    passed:
      convergedReferenceValueDifference <= VALUE_TOLERANCE &&
      certificateContainsConvergedReference &&
      measured.exploitability <= MAXIMUM_EXPLOITABILITY,
  };
}

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
  rulesFingerprint: string,
): LeducSolveArtifactPayload {
  if (result.gameId !== leducGame.id) {
    throw new Error(`Cannot create a Leduc artifact from ${result.gameId}`);
  }
  validateReference(reference);
  if (!/^[a-f0-9]{64}$/.test(rulesFingerprint)) {
    throw new Error(`Invalid Leduc rules fingerprint ${rulesFingerprint}`);
  }

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

  return {
    schemaVersion: 3,
    game: "leduc-v1",
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
    acceptance: evaluateLeducAcceptance(grade, reference),
    decisions: leducDecisionFacts(result.averageStrategy),
  };
}

export function stringifyLeducArtifact(artifact: LeducSolveArtifact): string {
  return `${canonicalSolverJson(artifact, true)}\n`;
}

export const LEDUC_ACCEPTANCE = {
  pinnedReferenceCommit: PINNED_REFERENCE_COMMIT,
  player0ValueTolerance: VALUE_TOLERANCE,
  maximumExploitability: MAXIMUM_EXPLOITABILITY,
  convergedReferenceValue: LEDUC_CONVERGED_REFERENCE.value,
} as const;
