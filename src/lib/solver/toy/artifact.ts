import {
  buildGameTreeIndex,
  validateStrategy,
  type BehavioralStrategy,
  type InformationSetKey,
} from "./game";
import { gradeStrategy } from "./best-response";
import type { CfrSolveResult } from "./cfr";
import { kuhnDecisionFacts, type KuhnDecisionFacts } from "./explain";
import { kuhnGame, type KuhnAction } from "./kuhn";

export type SerializedKuhnStrategy = Readonly<Record<
  InformationSetKey,
  Readonly<Partial<Record<KuhnAction, number>>>
>>;

export interface KuhnConvergenceCheckpoint {
  readonly iteration: number;
  readonly value: readonly [number, number];
  readonly nashGap: number;
  readonly exploitability: number;
}

export interface KuhnSolveArtifactPayload {
  readonly schemaVersion: 1;
  readonly game: "kuhn-v1";
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
  readonly strategy: SerializedKuhnStrategy;
  readonly value: readonly [number, number];
  readonly bestResponseValue: readonly [number, number];
  readonly gains: readonly [number, number];
  readonly nashGap: number;
  readonly exploitability: number;
  readonly exploitabilityConvention: "half-nash-gap";
  readonly exploitabilityUnits: "net-chips-per-hand";
  readonly convergence: readonly KuhnConvergenceCheckpoint[];
  readonly acceptance: {
    readonly referencePlayer0Value: number;
    readonly player0ValueTolerance: number;
    readonly maximumExploitability: number;
    readonly passed: boolean;
  };
  readonly decisions: readonly KuhnDecisionFacts[];
}

export interface KuhnSolveArtifact extends KuhnSolveArtifactPayload {
  readonly payloadHash: string;
}

const REFERENCE_PLAYER_0_VALUE = -1 / 18;
const VALUE_TOLERANCE = 0.001;
const MAXIMUM_EXPLOITABILITY = 0.001;

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map(key => [key, sortedJsonValue(record[key])]),
    );
  }
  return value;
}

export function canonicalKuhnJson(value: unknown, pretty = false): string {
  return JSON.stringify(sortedJsonValue(value), null, pretty ? 2 : undefined);
}

export function serializeKuhnStrategy(
  strategy: BehavioralStrategy<KuhnAction>,
): SerializedKuhnStrategy {
  return Object.fromEntries([...strategy.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => [
      key,
      Object.fromEntries(entry.actions.map((action, index) => [action, entry.probabilities[index]])),
    ]));
}

export function deserializeKuhnStrategy(
  serialized: SerializedKuhnStrategy,
): BehavioralStrategy<KuhnAction> {
  const index = buildGameTreeIndex(kuhnGame);
  const strategy = new Map(index.informationSets.map(definition => {
    const serializedEntry = serialized[definition.key];
    if (!serializedEntry) throw new Error(`Missing serialized Kuhn strategy at ${definition.key}`);
    return [definition.key, {
      actions: [...definition.actions],
      probabilities: definition.actions.map(action => {
        const probability = serializedEntry[action];
        if (probability === undefined) {
          throw new Error(`Missing serialized Kuhn action ${action} at ${definition.key}`);
        }
        return probability;
      }),
    }] as const;
  }));
  validateStrategy(index, strategy);
  return strategy;
}

export function createKuhnSolveArtifactPayload(
  result: CfrSolveResult<KuhnAction>,
): KuhnSolveArtifactPayload {
  if (result.gameId !== kuhnGame.id) {
    throw new Error(`Cannot create a Kuhn artifact from ${result.gameId}`);
  }
  const grade = gradeStrategy(kuhnGame, result.averageStrategy, result.index);
  const convergence = result.checkpoints.map(checkpoint => {
    const checkpointGrade = gradeStrategy(kuhnGame, checkpoint.averageStrategy, result.index);
    return {
      iteration: checkpoint.iteration,
      value: checkpointGrade.value,
      nashGap: checkpointGrade.nashGap,
      exploitability: checkpointGrade.exploitability,
    };
  });
  const valuePassed = Math.abs(grade.value[0] - REFERENCE_PLAYER_0_VALUE) <= VALUE_TOLERANCE;
  const exploitabilityPassed = grade.exploitability <= MAXIMUM_EXPLOITABILITY;
  const payload: KuhnSolveArtifactPayload = {
    schemaVersion: 1,
    game: "kuhn-v1",
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
    strategy: serializeKuhnStrategy(result.averageStrategy),
    value: grade.value,
    bestResponseValue: [grade.bestResponses[0].value, grade.bestResponses[1].value],
    gains: grade.gains,
    nashGap: grade.nashGap,
    exploitability: grade.exploitability,
    exploitabilityConvention: "half-nash-gap",
    exploitabilityUnits: "net-chips-per-hand",
    convergence,
    acceptance: {
      referencePlayer0Value: REFERENCE_PLAYER_0_VALUE,
      player0ValueTolerance: VALUE_TOLERANCE,
      maximumExploitability: MAXIMUM_EXPLOITABILITY,
      passed: valuePassed && exploitabilityPassed,
    },
    decisions: kuhnDecisionFacts(result.averageStrategy),
  };
  return payload;
}

export function stringifyKuhnArtifact(artifact: KuhnSolveArtifact): string {
  return `${canonicalKuhnJson(artifact, true)}\n`;
}

export const KUHN_ACCEPTANCE = {
  referencePlayer0Value: REFERENCE_PLAYER_0_VALUE,
  player0ValueTolerance: VALUE_TOLERANCE,
  maximumExploitability: MAXIMUM_EXPLOITABILITY,
} as const;
