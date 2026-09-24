import { createFlopReference } from "../src/lib/solver/postflop/flop/reference";
import { FLOP_REFERENCE_REQUEST, FLOP_REFERENCE_RUN } from "../src/lib/solver/postflop/flop/fixtures";
import { compileCompactGame, solveCompiledCompactCfr } from "../src/lib/solver/river/compact/cfr";
import { createFlopReferenceArtifact } from "../src/lib/solver/postflop/flop/artifact-node";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";

if (!process.send) throw new Error("Start through the bounded flop reference runner");
const send = (message: unknown) => new Promise<void>((resolve, reject) => process.send!(message, error => error ? reject(error) : resolve()));
process.once("message", async () => {
  const started = performance.now();
  const progress = (stage: string, iterations: number) => send({ type: "progress", stage, iterations,
    elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss });
  try {
    await progress("compiling", 0);
    const compiled = compileCompactGame(createFlopReference(FLOP_REFERENCE_REQUEST));
    await progress("solving", 0);
    // The old reference solver is synchronous. Report stages, never invented iteration progress.
    const result = solveCompiledCompactCfr(compiled, FLOP_REFERENCE_RUN);
    await progress("grading-and-auditing", result.iterations);
    const artifact = createFlopReferenceArtifact(result);
    if (!artifact.acceptance.passed) throw new Error(`Locked flop reference quality failed: ${artifact.exploitability} > ${FLOP_REFERENCE_RUN.maximumExploitability}`);
    await progress("exporting", result.iterations);
    const json = canonicalSolverJson(artifact) + "\n";
    await progress("exporting", result.iterations);
    await send({ type: "result", json });
  } catch (error) { await send({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  finally { process.disconnect?.(); }
});
