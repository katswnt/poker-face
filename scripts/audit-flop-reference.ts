import { fork, execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { FLOP_REFERENCE_REQUEST, FLOP_REFERENCE_RUN } from "../src/lib/solver/postflop/flop/fixtures";
import { flopDigest, verifyFlopReferenceArtifactHash, type FlopReferenceArtifact } from "../src/lib/solver/postflop/flop/artifact-node";

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !["--check", "--write"].includes(mode)) throw new Error("Usage: audit-flop-reference.ts --check|--write");
  const locked = JSON.parse(readFileSync("tasks/heads-up-flop-v1-input-hashes.json", "utf8"));
  if (flopDigest({ request: FLOP_REFERENCE_REQUEST, run: FLOP_REFERENCE_RUN }) !== locked.canonicalRequestAndRunSha256) throw new Error("Locked flop input changed");
  const budget = Math.min(2 * 1024 ** 3, Math.floor(totalmem() / 8));
  if (budget < 1024 ** 3) throw new Error("Reference flop run needs at least a 1 GiB established budget");
  const started = performance.now(); let peakCombined = process.memoryUsage().rss, peakWorker = 0;
  const json = await new Promise<string>((resolve, reject) => {
    const worker = fork(new URL("./flop-reference-worker.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx", `--max-old-space-size=${Math.floor(budget / 1024 ** 2 * 0.75)}`], stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let settled = false, pending: string | undefined, diagnostics = "", polling = false, lastWorkerRss = 0;
    const cleanup = () => { clearInterval(sampler); clearTimeout(timer); process.off("SIGINT", cancel); process.off("SIGTERM", cancel); };
    const fail = (e: Error) => { if (settled) return; settled = true; cleanup(); worker.kill("SIGKILL"); reject(e); };
    const cancel = () => fail(new Error("Flop reference cancelled; no artifact written"));
    const observe = (rss: number) => {
      lastWorkerRss = rss;
      peakWorker = Math.max(peakWorker, rss); peakCombined = Math.max(peakCombined, rss + process.memoryUsage().rss);
      if (peakCombined > budget) fail(new Error("Flop reference sampled combined RSS exceeds budget; no artifact written"));
    };
    const timer = setTimeout(() => fail(new Error("Flop reference exceeded 10 minutes; no artifact written")), 600000);
    // Parent-side sampling still runs during the unchanged synchronous CFR reference.
    const sampler = setInterval(() => {
      if (settled || polling || !worker.pid) return; polling = true;
      try {
        execFile("ps", ["-o", "rss=", "-p", String(worker.pid)], (error, stdout) => {
          polling = false; if (settled) return;
          if (error) { if (["EPERM", "EACCES", "ENOENT"].includes(String(error.code))) fail(new Error("Cannot sample flop worker memory")); return; }
          const rss = Number(stdout.trim()) * 1024; if (Number.isFinite(rss) && rss > 0) observe(rss);
        });
      } catch (error) { polling = false; fail(new Error(`Cannot sample flop worker memory: ${String(error)}`)); }
    }, 200);
    worker.stderr?.on("data", data => { diagnostics = (diagnostics + String(data)).slice(-4096); });
    process.on("SIGINT", cancel); process.on("SIGTERM", cancel); worker.on("error", fail);
    worker.on("message", (message: { type: string; json?: string; message?: string; rssBytes?: number }) => {
      if (settled) return;
      if (message.type === "error") fail(new Error(message.message));
      else if (message.type === "result") { pending = message.json; observe(lastWorkerRss); }
      else { observe(message.rssBytes!); console.error(JSON.stringify(message)); }
    });
    worker.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0 || signal || !pending) { fail(new Error(`Flop worker incomplete (${code ?? signal}): ${diagnostics}`)); return; }
      observe(0); if (settled) return; settled = true; cleanup(); resolve(pending);
    });
    worker.send({ start: true });
  });
  const artifact = JSON.parse(json) as FlopReferenceArtifact;
  if (!verifyFlopReferenceArtifactHash(artifact) || !artifact.acceptance.passed || canonicalSolverJson(artifact) + "\n" !== json) throw new Error("Invalid flop artifact");
  peakCombined = Math.max(peakCombined, process.memoryUsage().rss);
  if (peakCombined > budget || performance.now() - started > 600000) throw new Error("Flop parent validation exceeded the run envelope; no artifact written");
  const path = "src/lib/solver/postflop/flop/artifacts/heads-up-flop-v1.json";
  if (mode === "--check") { if (readFileSync(path, "utf8") !== json) throw new Error("Flop reference artifact does not reproduce"); }
  else { mkdirSync("src/lib/solver/postflop/flop/artifacts", { recursive: true }); writeFileSync(path, json); }
  console.log(JSON.stringify({ mode, counts: artifact.counts, iterations: artifact.iterations, value: artifact.value, gains: artifact.gains,
    exploitability: artifact.exploitability, convergence: artifact.convergence, payloadHash: artifact.payloadHash, policyHash: artifact.policyHash,
    elapsedMs: performance.now() - started, sampledPeakWorkerRss: peakWorker, sampledPeakCombinedRss: peakCombined, budgetBytes: budget, rawBytes: Buffer.byteLength(json) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
