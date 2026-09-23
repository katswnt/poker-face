import { serializeBehavioralStrategy } from "../../toy/artifact";
import { vectorDigest, type VectorConvergence } from "../vector/artifact-node";
import { gradeVectorTurn } from "../vector/scorekeeper";
import type { createVectorTurnSession } from "../vector/session";
import type { TurnV2Game } from "./game";
import type { TurnV2Action } from "./rules";

export function createTurnV2Artifact(game: TurnV2Game,
  snapshot: ReturnType<ReturnType<typeof createVectorTurnSession<TurnV2Action>>["snapshot"]>,
  maximumExploitability: number, convergence: readonly VectorConvergence[]) {
  if (!Number.isFinite(maximumExploitability) || maximumExploitability < 0) throw new Error("Invalid artifact quality target");
  const grade = gradeVectorTurn(game, snapshot.averageStrategy), strategy = serializeBehavioralStrategy(snapshot.averageStrategy);
  const passed = grade.exploitability <= maximumExploitability;
  const payload = { schemaVersion: 1 as const, rules: "turn-v2" as const, rulesVersion: 2 as const,
    backend: snapshot.backend, backendVersion: snapshot.backendVersion,
    request: game.request, requestHash: vectorDigest(game.request), gameHash: vectorDigest(game.gameIdentity),
    algorithm: snapshot.options.algorithm, averagingDelay: snapshot.options.averagingDelay, kernel: snapshot.options.kernel,
    iterations: snapshot.iterations, requestedIterations: snapshot.options.iterations,
    counts: { compatibleDeals: game.preflight.compatibleDeals, publicStates: game.preflight.publicStates,
      equivalentStates: game.index.totalStates, informationSets: game.index.informationSets.length, actionSlots: game.actionSlotCount,
      terminalStates: game.index.terminalNodes, legalRiversPerDeal: 44, dealRiverPairs: game.preflight.dealRiverPairs },
    strategy, policyHash: vectorDigest(strategy), value: grade.value, bestResponseValues: grade.bestResponses.map(response => response.value),
    gains: grade.gains, exploitability: grade.exploitability, exploitabilityConvention: "half-nash-gap",
    exploitabilityUnits: "net-chips-per-hand", exploitabilityPercentOfPot: 100 * grade.exploitability / (2 * game.request.committedPerPlayer),
    equilibriumValueIntervalPlayer0: grade.equilibriumValueIntervalPlayer0, convergence,
    acceptance: { maximumExploitability, passed }, status: passed ? "quality-target-met" : "iteration-budget-exhausted",
    limitations: ["Approximate strategy for this specific finite heads-up turn/river game, not exact or universal GTO",
      "Up to 64 combinations per player, three opening targets, three raise targets, optional all-in and one raise per street",
      "Exact card enumeration with floating-point arithmetic; whole-chip menus, no rake or external turn-solver numerical validation",
      "Handcrafted ranges are teaching/test assumptions, not solved or recommended preflop strategies",
      "Offline CPU solve only; no flop, preflop, neural training or claim of full-game poker strength"] };
  return { ...payload, payloadHash: vectorDigest(payload) };
}
export type TurnV2Artifact = ReturnType<typeof createTurnV2Artifact>;
