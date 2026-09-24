import { createHash } from "node:crypto";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../../toy/artifact";
import { gradeStrategy } from "../../toy/best-response";
import type { CompactCfrSolveResult } from "../../river/compact/cfr";
import { compileCompactScorekeeper, gradeCompactStrategy } from "../../river/compact/scorekeeper";
import { FLOP_REFERENCE_REQUEST, FLOP_REFERENCE_RUN } from "./fixtures";
import { createFlopReference, type FlopReference, type FlopReferenceState } from "./reference";
import { auditFlopReference } from "./oracle";
import type { FlopAction } from "./rules";

export const flopDigest = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
export function fingerprintFlopReference(game: FlopReference) {
  const hash = createHash("sha256");
  hash.update(canonicalSolverJson({ rules: "flop-v1", request: game.request }) + "\n");
  const visit = (state: FlopReferenceState) => {
    const node = game.node(state);
    hash.update(canonicalSolverJson({ state, node, informationSet: node.kind === "player" ? game.informationSet(state, node.player) : null }) + "\n");
    if (node.kind === "chance") node.outcomes.forEach(c => visit(game.nextChance(state, c.outcome)));
    if (node.kind === "player") node.actions.forEach(a => visit(game.nextAction(state, a)));
  };
  visit(game.initialState()); return hash.digest("hex");
}
export function createFlopReferenceArtifact(result: CompactCfrSolveResult<FlopAction>) {
  const game = createFlopReference(FLOP_REFERENCE_REQUEST), locked = FLOP_REFERENCE_RUN;
  if (result.gameId !== game.id || result.algorithm !== "compact-alternating-cfr-plus" || result.algorithmVersion !== 1
    || result.iterations !== locked.iterations || result.averagingDelay !== locked.averagingDelay
    || result.checkpoints.map(c => c.iteration).join() !== locked.checkpointIterations.join()) throw new Error("Flop artifact requires the locked run");
  // Rebuild the index and legal best response independently of solver state/deltas.
  const grade = gradeStrategy(game, result.averageStrategy), scorekeeper = compileCompactScorekeeper(result.compiled);
  const convergence = result.checkpoints.map(c => {
    const measured = gradeCompactStrategy(scorekeeper, c.averageStrategy);
    return { iteration: c.iteration, value: measured.value, gains: measured.gains, exploitability: measured.exploitability };
  });
  const last = convergence.at(-1)!, tolerance = 1e-10 * (game.request.committedPerPlayer + Math.min(...game.request.stackBehind));
  if ([...grade.value.map((v, p) => v - last.value[p]), ...grade.gains.map((v, p) => v - last.gains[p])]
    .some(d => !Number.isFinite(d) || Math.abs(d) > tolerance)) throw new Error("Independent flop graders disagree");
  const strategy = serializeBehavioralStrategy(result.averageStrategy);
  const payload = { schemaVersion: 1, rulesVersion: 1, backend: result.algorithm, backendVersion: result.algorithmVersion,
    request: game.request, inputHash: flopDigest({ request: FLOP_REFERENCE_REQUEST, run: locked }),
    iterations: result.iterations, averagingDelay: result.averagingDelay, precision: "float64",
    rulesFingerprint: fingerprintFlopReference(game), counts: { ...game.preflight, informationSets: result.index.informationSets.length },
    strategy, policyHash: flopDigest(strategy), value: grade.value, bestResponseValues: grade.bestResponses.map(r => r.value),
    gains: grade.gains, nashGap: grade.nashGap, exploitability: grade.exploitability,
    exploitabilityConvention: "half-nash-gap", exploitabilityUnits: "net-chips-per-hand",
    equilibriumValueIntervalPlayer0: [-grade.bestResponses[1].value, grade.bestResponses[0].value], convergence,
    independentRulesAudit: auditFlopReference(game), acceptance: { maximumExploitability: locked.maximumExploitability,
      passed: grade.exploitability <= locked.maximumExploitability },
    limitations: ["Tiny three-deal reference, not the wider-range M5 target", "One capped opening size per street; no raises",
      "Handcrafted ranges, not solved preflop play", "Approximate finite-game strategy, not exact or universal GTO",
      "No external flop-solver numerical certification"],
  };
  return { ...payload, payloadHash: flopDigest(payload) };
}
export type FlopReferenceArtifact = ReturnType<typeof createFlopReferenceArtifact>;
export function verifyFlopReferenceArtifactHash(artifact: FlopReferenceArtifact) {
  const { payloadHash, ...payload } = artifact;
  return payload.schemaVersion === 1 && payload.rulesVersion === 1 && payloadHash === flopDigest(payload)
    && payload.policyHash === flopDigest(payload.strategy)
    && payload.inputHash === flopDigest({ request: payload.request, run: FLOP_REFERENCE_RUN })
    && payload.inputHash === flopDigest({ request: FLOP_REFERENCE_REQUEST, run: FLOP_REFERENCE_RUN })
    && payload.rulesFingerprint === fingerprintFlopReference(createFlopReference(FLOP_REFERENCE_REQUEST));
}
