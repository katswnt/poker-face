import { createHash } from "node:crypto";
import { compileCompactTurn } from "../src/lib/solver/postflop/compact-turn";
import { createCompactTurnSession } from "../src/lib/solver/postflop/session";
import type { CompactTurnJob, CompactTurnProgress, CompactTurnWorkerMessage } from "../src/lib/solver/postflop/protocol";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { fingerprintTurnGame } from "../src/lib/solver/turn/artifact-node";

const send = (message: CompactTurnWorkerMessage) => process.send?.(message);
const flush = (message: CompactTurnWorkerMessage) => new Promise<void>((resolve, reject) => {
  process.send!(message, error => error ? reject(error) : resolve());
});
if (!process.send) throw new Error("Compact turn worker must be started by its runner");
process.once("message", async (job: CompactTurnJob) => {
  const started = performance.now();
  const progress = (stage: CompactTurnProgress["stage"], iterations: number) => send({ type: "progress", stage,
    iterations, requestedIterations: job.options.iterations, elapsedMs: performance.now() - started,
    rssBytes: process.memoryUsage().rss });
  try {
    progress("compiling", 0);
    const game = compileCompactTurn(job.request), session = createCompactTurnSession(game, job.options);
    progress("solving", 0);
    while (!session.done) {
      session.advance(32);
      progress("solving", session.iterations);
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    const snapshot = session.snapshot();
    progress("grading", session.iterations);
    const grade = gradeStrategy(game.source, snapshot.averageStrategy, game.index);
    progress("serializing", session.iterations);
    const policy = serializeBehavioralStrategy(snapshot.averageStrategy);
    const digest = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
    const payload = { schemaVersion: 1, backend: snapshot.backend, algorithmVersion: snapshot.algorithmVersion,
      algorithm: snapshot.algorithm, averagingDelay: snapshot.averagingDelay, iterations: snapshot.iterations,
      request: game.source.request, requestHash: digest(game.source.request), rulesHash: fingerprintTurnGame(game.source),
      counts: game.source.preflight, publicStates: game.nodeKinds.length, informationSets: game.index.informationSets.length,
      typedStorageBytes: game.typedStorageBytes, workingStorageBytes: snapshot.workingStorageBytes,
      strategy: policy, policyHash: digest(policy),
      value: grade.value, gains: grade.gains, exploitability: grade.exploitability,
      exploitabilityConvention: "half-nash-gap", exploitabilityUnits: "net-chips-per-hand",
      status: "completed-and-independently-graded",
      limitations: ["Approximate strategy for this specific finite game, not exact or universal GTO",
        "Turn v1 limits: tiny ranges, one opening size per street, no raises",
        "Readable independent grader; no wider-range vector engine or external solver validation",
        "Complete iterations in memory; no restartable disk checkpoint"] };
    await flush({ type: "result", json: canonicalSolverJson({ ...payload, payloadHash: digest(payload) }, true) });
  } catch (error) {
    await flush({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally { process.disconnect?.(); }
});
