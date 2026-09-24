import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runFlopJob } from "./flop-runner";
import { preflightVectorFlop } from "../src/lib/solver/postflop/flop/compiled";
import { validateFlopRequest } from "../src/lib/solver/postflop/flop/rules";
import { atomicFlopWrite, readFlopBinary } from "../src/lib/solver/postflop/flop/binary-node";

async function main() {
  const args = process.argv.slice(2), allowed = new Set(["--request", "--output", "--iterations", "--target", "--averaging-delay", "--checkpoint", "--resume"]);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: npm run solve:flop -- --request game.json [--preflight | --output prefix] [--iterations 100000] [--target chips] [--averaging-delay 20] [--checkpoint checkpoint.gz] [--resume checkpoint.gz]");
    console.log("The default quality target is 0.25% of the starting pot; --target is in chips. Checkpoint output must be a new path, separate from the resume input.");
    console.log("Offline heads-up flop/turn/river: one capped bet per street, no raises. Approximate finite-game strategy, not exact GTO. Existing output files are never overwritten."); return;
  }
  const values = new Map<string, string>(); let preflightOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--preflight" && !preflightOnly) { preflightOnly = true; continue; }
    if (!allowed.has(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown, duplicate or incomplete flop CLI option; use --help");
    values.set(args[i], args[++i]);
  }
  const path = values.get("--request");
  if (!path || statSync(path).size > 65536) throw new Error("A request JSON file of at most 64 KiB is required");
  const request = validateFlopRequest(JSON.parse(readFileSync(path, "utf8")));
  console.log(JSON.stringify({ stage: "preflight", ...preflightVectorFlop(request) }));
  if (preflightOnly) { if (values.has("--output")) throw new Error("Choose either --preflight or --output"); return; }
  const output = values.get("--output"); if (!output) throw new Error("An explicit --output prefix is required");
  const prefix = resolve(output), paths = [`${prefix}.json`, `${prefix}.policy.f64.gz`];
  if (paths.some(existsSync)) throw new Error("Output exists; choose a new prefix");
  const controller = new AbortController(), cancel = () => controller.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try {
    const result = await runFlopJob({ request, options: { iterations: Number(values.get("--iterations") ?? 100000), algorithm: "cfr-plus",
      averagingDelay: Number(values.get("--averaging-delay") ?? 20) }, maximumExploitability: Number(values.get("--target") ?? request.committedPerPlayer * 2 * 0.0025) }, {
      checkpointPath: values.get("--checkpoint"), resumePath: values.get("--resume"), signal: controller.signal,
      onProgress: p => console.error(JSON.stringify(p)),
    });
    if (paths.some(existsSync)) throw new Error("Output appeared during solve; choose a new prefix");
    mkdirSync(dirname(prefix), { recursive: true });
    atomicFlopWrite(paths[1], readFlopBinary(result.policyPath), false); atomicFlopWrite(paths[0], Buffer.from(result.json), false);
    const artifact = JSON.parse(result.json);
    console.log(JSON.stringify({ accepted: artifact.acceptance.passed, exploitabilityChips: artifact.exploitability,
      iterations: artifact.iterations, elapsedMs: result.elapsedMs, sampledPeakCombinedRss: result.sampledPeakCombinedRss, files: paths }));
    if (!artifact.acceptance.passed) process.exitCode = 2;
  } finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
