// Offline only. No browser dependency on node:crypto or on the generated policy.
import { createHash } from "node:crypto";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../toy/artifact";
import { gradeStrategy } from "../toy/best-response";
import type { CfrSolveResult } from "../toy/cfr";
import { TURN_RULES_VERSION, type TurnAction, type TurnGame, type TurnState } from "./game";
import { turnDemoGame } from "./fixture";
import { auditTurnRules } from "./oracle";

export const TURN_ARTIFACT_ITERATIONS = 16_384;
export const TURN_ARTIFACT_CHECKPOINTS = [256, 1_024, 4_096, TURN_ARTIFACT_ITERATIONS] as const;
export const TURN_MAXIMUM_EXPLOITABILITY = 0.10;
const digest = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");

/** Fingerprints transitions, probabilities, legal observations, action order and payoffs. */
export function fingerprintTurnGame(game: TurnGame): string {
  const hash = createHash("sha256");
  hash.update(`${canonicalSolverJson({ version: TURN_RULES_VERSION, request: game.request })}\n`);
  const visit = (state: TurnState) => {
    const node = game.node(state);
    hash.update(`${canonicalSolverJson({ state, node,
      informationSet: node.kind === "player" ? game.informationSet(state, node.player) : null })}\n`);
    if (node.kind === "chance") node.outcomes.forEach(child => visit(game.nextChance(state, child.outcome)));
    if (node.kind === "player") node.actions.forEach(action => visit(game.nextAction(state, action)));
  };
  visit(game.initialState());
  return hash.digest("hex");
}

export function createTurnArtifact(result: CfrSolveResult<TurnAction>) {
  const game = turnDemoGame;
  if (result.gameId !== game.id || result.algorithm !== "full-tree-cfr" || result.algorithmVersion !== 1 ||
    result.iterations !== TURN_ARTIFACT_ITERATIONS ||
    result.checkpoints.map(checkpoint => checkpoint.iteration).join(",") !== TURN_ARTIFACT_CHECKPOINTS.join(",")) {
    throw new Error("Turn artifact requires the locked fixture, algorithm, iterations and checkpoints");
  }
  // Rebuild the grade/index from the game, not caller-provided numeric metadata.
  const grade = gradeStrategy(game, result.averageStrategy);
  const rulesAudit = auditTurnRules(game);
  const payload = {
    schemaVersion: 1 as const,
    game: game.id,
    rulesVersion: TURN_RULES_VERSION,
    request: game.request,
    algorithm: result.algorithm,
    algorithmVersion: result.algorithmVersion,
    iterations: result.iterations,
    rulesFingerprint: fingerprintTurnGame(game),
    preflight: game.preflight,
    informationSets: result.averageStrategy.size,
    strategy: serializeBehavioralStrategy(result.averageStrategy),
    value: grade.value,
    bestResponseValue: [grade.bestResponses[0].value, grade.bestResponses[1].value],
    gains: grade.gains,
    nashGap: grade.nashGap,
    exploitability: grade.exploitability,
    exploitabilityConvention: "half-nash-gap" as const,
    exploitabilityUnits: "net-chips-per-hand" as const,
    equilibriumValueIntervalPlayer0: [-grade.bestResponses[1].value, grade.bestResponses[0].value],
    convergence: result.checkpoints.map(checkpoint => {
      const measured = gradeStrategy(game, checkpoint.averageStrategy);
      return { iteration: checkpoint.iteration, value: measured.value, gains: measured.gains,
        exploitability: measured.exploitability };
    }),
    rulesAudit,
    acceptance: { maximumExploitability: TURN_MAXIMUM_EXPLOITABILITY,
      passed: grade.exploitability <= TURN_MAXIMUM_EXPLOITABILITY },
    limitations: ["Two players, turn and river only", "Tiny explicit ranges", "One bet size per street; no raises",
      "Approximate full-tree CFR strategy for this finite game, not universal or exact GTO",
      "No independent external turn-solver comparison yet"],
  };
  return { ...payload, payloadHash: digest(payload) };
}
export type TurnArtifact = ReturnType<typeof createTurnArtifact>;
export const stringifyTurnArtifact = (artifact: TurnArtifact) => `${canonicalSolverJson(artifact, true)}\n`;
export function verifyTurnArtifactHash(artifact: TurnArtifact): boolean {
  const { payloadHash, ...payload } = artifact;
  return payload.schemaVersion === 1 && payload.rulesVersion === TURN_RULES_VERSION &&
    payloadHash === digest(payload) && payload.rulesFingerprint === fingerprintTurnGame(turnDemoGame);
}
