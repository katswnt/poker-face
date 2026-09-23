import { compileTurnV2 } from "../src/lib/solver/postflop/configurable-turn/game";
import { createTurnV2Artifact } from "../src/lib/solver/postflop/configurable-turn/artifact-node";
import type { TurnV2Job, TurnV2Progress, TurnV2WorkerMessage } from "../src/lib/solver/postflop/configurable-turn/protocol";
import { createVectorTurnSession, restoreVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { encodeVectorCheckpoint, type VectorConvergence } from "../src/lib/solver/postflop/vector/artifact-node";
import { VECTOR_GRADE_ITERATIONS } from "../src/lib/solver/postflop/vector/protocol";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";

if (!process.send) throw new Error("Start the turn v2 worker through its runner");
const send = (message: TurnV2WorkerMessage) => new Promise<void>((resolve, reject) => process.send!(message, error => error ? reject(error) : resolve()));
process.once("message", async (job: TurnV2Job) => {
  const started = performance.now(), convergence: VectorConvergence[] = [];
  let iterations = job.resume?.iterations ?? 0;
  const progress = (stage: TurnV2Progress["stage"]) => send({ type: "progress", stage, iterations,
    requestedIterations: job.options.iterations, regretPasses: iterations * (job.options.algorithm === "vanilla" ? 1 : 2),
    elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss, lastGrade: convergence.at(-1) });
  try {
    await progress("compiling");
    const game = compileTurnV2(job.request), session = job.resume ? restoreVectorTurnSession(game, job.resume) : createVectorTurnSession(game, job.options);
    const grades = new Set<number>([...VECTOR_GRADE_ITERATIONS, job.options.iterations]);
    if (job.resume && iterations > 0) grades.add(iterations);
    let passed = false, lastSaved = -1;
    while (true) {
      if (grades.has(iterations) && iterations > 0) {
        await progress("grading");
        const grade = gradeVectorTurn(game, session.snapshot().averageStrategy);
        convergence.push({ iteration: iterations, value: grade.value, gains: grade.gains, exploitability: grade.exploitability });
        await progress("grading"); passed = grade.exploitability <= job.maximumExploitability;
      }
      if (job.checkpointEvery && iterations > 0 && lastSaved !== iterations
        && (iterations % job.checkpointEvery === 0 || passed || session.done)) {
        await progress("checkpointing"); await send({ type: "checkpoint", json: encodeVectorCheckpoint(session.checkpoint()) }); lastSaved = iterations;
      }
      if (passed || session.done) break;
      const nextGrade = [...grades].filter(n => n > iterations).sort((a, b) => a - b)[0] ?? job.options.iterations;
      const nextSave = job.checkpointEvery ? job.checkpointEvery - iterations % job.checkpointEvery : 32;
      session.advance(Math.min(32, nextGrade - iterations, nextSave)); iterations = session.iterations;
      await progress("solving"); await new Promise<void>(resolve => setImmediate(resolve));
    }
    await progress("exporting");
    const artifact = createTurnV2Artifact(game, session.snapshot(), job.maximumExploitability, convergence);
    const json = canonicalSolverJson(artifact);
    await progress("exporting"); await send({ type: "result", json });
  } catch (error) { await send({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  finally { process.disconnect?.(); }
});
