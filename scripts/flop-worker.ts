import { join } from "node:path";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { compileVectorFlop } from "../src/lib/solver/postflop/flop/compiled";
import { createVectorFlopSession, restoreVectorFlopSession } from "../src/lib/solver/postflop/flop/session";
import { gradeVectorFlop } from "../src/lib/solver/postflop/flop/scorekeeper";
import { atomicFlopWrite, decodeFlopCheckpointFile, encodeFlopCheckpointFile, encodeFlopPolicyFile, readFlopBinary } from "../src/lib/solver/postflop/flop/binary-node";
import { flopDigest } from "../src/lib/solver/postflop/flop/artifact-node";
import { FLOP_GRADE_ITERATIONS, type FlopProgress, type FlopWorkerJob, type FlopWorkerMessage } from "../src/lib/solver/postflop/flop/protocol";
import { validateVectorOptions } from "../src/lib/solver/postflop/vector/session";

if (!process.send) throw new Error("Start flop worker through its bounded runner");
const send = (message: FlopWorkerMessage) => new Promise<void>((resolve, reject) => process.send!(message, error => error ? reject(error) : resolve()));
process.once("message", async (job: FlopWorkerJob) => {
  const started = performance.now(), convergence: { iteration: number; value: readonly number[]; gains: readonly number[]; exploitability: number }[] = [];
  let iterations = 0;
  const progress = (stage: FlopProgress["stage"]) => send({ type: "progress", stage, iterations,
    requestedIterations: job.options.iterations, elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss,
    lastExploitability: convergence.at(-1)?.exploitability });
  try {
    await progress("compiling"); const game = compileVectorFlop(job.request, job.memoryLimitBytes);
    const saved = job.resumePath ? decodeFlopCheckpointFile(game, readFlopBinary(job.resumePath)) : undefined;
    if (saved && JSON.stringify(saved.options) !== JSON.stringify(validateVectorOptions(job.options))) throw new Error("Resume options differ");
    const session = saved ? restoreVectorFlopSession(game, saved) : createVectorFlopSession(game, job.options);
    iterations = session.iterations;
    const grades = new Set<number>([...FLOP_GRADE_ITERATIONS.filter(n => n <= job.options.iterations), job.options.iterations]);
    if (iterations > 0) grades.add(iterations);
    let snapshot: ReturnType<typeof session.snapshot> | undefined, grade: ReturnType<typeof gradeVectorFlop> | undefined, passed = false;
    let lastSaved = -1;
    while (true) {
      if (grades.has(iterations) && iterations > 0) {
        await progress("grading"); snapshot = session.snapshot(); grade = gradeVectorFlop(game, snapshot.policy);
        convergence.push({ iteration: iterations, value: grade.value, gains: grade.gains, exploitability: grade.exploitability });
        passed = grade.exploitability <= job.maximumExploitability; await progress("grading");
      }
      if (job.checkpointPath && iterations > 0 && lastSaved !== iterations
        && (iterations % (job.checkpointEvery ?? 256) === 0 || passed || session.done)) {
        await progress("checkpointing"); const encoded = encodeFlopCheckpointFile(game, session.checkpoint());
        atomicFlopWrite(job.checkpointPath, encoded.compressed, lastSaved >= 0); lastSaved = iterations; await progress("checkpointing");
      }
      if (passed || session.done) break;
      const nextGrade = [...grades].filter(n => n > iterations).sort((a, b) => a - b)[0];
      const nextSave = job.checkpointPath ? (job.checkpointEvery ?? 256) - iterations % (job.checkpointEvery ?? 256) : 8;
      session.advance(Math.min(8, nextGrade - iterations, nextSave)); iterations = session.iterations;
      await progress("solving"); await new Promise<void>(resolve => setImmediate(resolve));
    }
    if (!snapshot || !grade) throw new Error("Flop job ended without a completed independently graded policy");
    await progress("exporting");
    const encoded = encodeFlopPolicyFile(game, snapshot);
    const counts = { ...game.preflight }; delete (counts as Partial<typeof counts>).memoryLimitBytes;
    const payload = { schemaVersion: 1, rulesVersion: 1, backend: "vector-flop", backendVersion: 1, precision: "float64",
      request: game.request, inputHash: flopDigest(game.request), gameHash: flopDigest(game.gameIdentity), counts,
      informationSets: game.informationSets, iterations, options: snapshot.options, convergence,
      value: grade.value, bestResponseValues: grade.bestResponses.map(b => b.value), gains: grade.gains,
      exploitability: grade.exploitability, nashGap: grade.nashGap, exploitabilityConvention: "half-nash-gap", exploitabilityUnits: "net-chips-per-hand",
      equilibriumValueIntervalPlayer0: grade.equilibriumValueIntervalPlayer0,
      policy: { format: "flop-float64-v1-gzip", contentHash: encoded.contentHash, rawBytes: encoded.rawBytes, actionSlots: snapshot.policy.length },
      acceptance: { maximumExploitability: job.maximumExploitability, passed },
      limitations: ["Heads-up, no rake, explicit weighted ranges", "One capped opening bet per street, no raises",
        "Approximate joint three-street finite-game strategy, not exact or universal GTO", "Range provenance is fixture-specific; no preflop solution implied"] };
    atomicFlopWrite(join(job.outputDirectory, "policy.f64.gz"), encoded.compressed);
    atomicFlopWrite(join(job.outputDirectory, "artifact.json"), Buffer.from(canonicalSolverJson({ ...payload, payloadHash: flopDigest(payload) }) + "\n"));
    await progress("exporting"); await send({ type: "result" });
  } catch (error) { await send({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  finally { process.disconnect?.(); }
});
