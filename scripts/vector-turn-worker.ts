import { compileVectorTurn } from "../src/lib/solver/postflop/vector/game";
import { createVectorTurnSession, restoreVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { createVectorArtifact, encodeVectorCheckpoint, type VectorConvergence } from "../src/lib/solver/postflop/vector/artifact-node";
import { VECTOR_GRADE_ITERATIONS, type VectorJob, type VectorProgress, type VectorWorkerMessage } from "../src/lib/solver/postflop/vector/protocol";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";

if (!process.send) throw new Error("Start the vector worker through its runner");
const send = (message: VectorWorkerMessage) => new Promise<void>((resolve, reject) => process.send!(message, error => error ? reject(error) : resolve()));
process.once("message", async (job: VectorJob) => {
  const started = performance.now(), convergence: VectorConvergence[] = [];
  let iterations = job.resume?.iterations ?? 0;
  const progress = (stage: VectorProgress["stage"]) => send({ type: "progress", stage, iterations,
    requestedIterations: job.options.iterations, regretPasses: iterations * (job.options.algorithm === "vanilla" ? 1 : 2),
    elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss, lastGrade: convergence.at(-1) });
  try {
    await progress("compiling");
    const game = compileVectorTurn(job.request), session = job.resume ? restoreVectorTurnSession(game, job.resume) : createVectorTurnSession(game, job.options);
    const checkpoints = new Set<number>([...VECTOR_GRADE_ITERATIONS, job.options.iterations]);
    // A restored policy is regraded; a saved claim of quality is never trusted.
    if (job.resume && iterations > 0) checkpoints.add(iterations);
    let passed = false, lastSaved = -1;
    const save = async () => {
      if (!job.checkpointEvery || lastSaved === iterations) return;
      await progress("checkpointing"); await send({ type: "checkpoint", json: encodeVectorCheckpoint(session.checkpoint()) }); lastSaved = iterations;
    };
    while (true) {
      if (checkpoints.has(iterations) && iterations > 0) {
        await progress("grading");
        const grade = gradeVectorTurn(game, session.snapshot().averageStrategy);
        convergence.push({ iteration: iterations, value: grade.value, gains: grade.gains, exploitability: grade.exploitability });
        await progress("grading"); passed = grade.exploitability <= job.maximumExploitability;
      }
      if (job.checkpointEvery && iterations > 0 && (iterations % job.checkpointEvery === 0 || passed || session.done)) await save();
      if (passed || session.done) break;
      const nextGrade = [...checkpoints].filter(n => n > iterations).sort((a, b) => a - b)[0] ?? job.options.iterations;
      const nextSave = job.checkpointEvery ? job.checkpointEvery - iterations % job.checkpointEvery : 32;
      session.advance(Math.min(32, nextGrade - iterations, nextSave)); iterations = session.iterations;
      await progress("solving"); await new Promise<void>(resolve => setImmediate(resolve));
    }
    await progress("exporting");
    const artifact = createVectorArtifact(game, session.snapshot(), job.maximumExploitability, convergence);
    const json = canonicalSolverJson(artifact);
    await progress("exporting"); await send({ type: "result", json });
  } catch (error) { await send({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  finally { process.disconnect?.(); }
});
