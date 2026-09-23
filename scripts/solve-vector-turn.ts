import { readFileSync, statSync } from "node:fs";
import { COMPACT_TURN_FIXTURES, POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";
import { readVectorCheckpoint } from "../src/lib/solver/postflop/vector/artifact-node";
import type { VectorTurnOptions } from "../src/lib/solver/postflop/vector/session";
import { runVectorTurnJob } from "./vector-turn-runner";

async function main() {
  const args = process.argv.slice(2), flags = new Map<string, string>();
  const allowed = ["--fixture", "--request", "--iterations", "--algorithm", "--delay", "--target-chips", "--timeout-ms", "--checkpoint", "--resume", "--checkpoint-every"];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw new Error("Usage: solve:turn:vector -- [--fixture wide|demo | --request file.json | --resume checkpoint.json] [--iterations N] [--algorithm vanilla|cfr-plus] [--delay N] [--target-chips N] [--timeout-ms N] [--checkpoint new-file.json] [--checkpoint-every N]");
    flags.set(args[i], args[i + 1]);
  }
  if (["--fixture", "--request", "--resume"].filter(flag => flags.has(flag)).length > 1) throw new Error("Choose one input source");
  const resume = flags.has("--resume") ? readVectorCheckpoint(flags.get("--resume")!) : undefined;
  const fixture = flags.get("--fixture") ?? "wide";
  if (!["wide", "demo"].includes(fixture)) throw new Error("Unknown vector fixture");
  let request = resume ? JSON.parse(resume.gameIdentity).request : fixture === "wide" ? POSTFLOP_M2_PROBE : COMPACT_TURN_FIXTURES[0];
  if (flags.has("--request")) {
    const path = flags.get("--request")!, stat = statSync(path);
    if (!stat.isFile() || stat.size > 65536) throw new Error("Request must be a regular JSON file of at most 64 KiB");
    request = JSON.parse(readFileSync(path, "utf8"));
  }
  if (resume && ["--iterations", "--algorithm", "--delay"].some(flag => flags.has(flag))) throw new Error("Resume preserves its original iteration/algorithm settings");
  const options: VectorTurnOptions = resume?.options ?? { iterations: Number(flags.get("--iterations") ?? 100000),
    algorithm: (flags.get("--algorithm") ?? "cfr-plus") as VectorTurnOptions["algorithm"],
    averagingDelay: Number(flags.get("--delay") ?? (flags.get("--algorithm") === "vanilla" ? 0 : 20)) };
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    const result = await runVectorTurnJob({ request, options, resume,
      maximumExploitability: Number(flags.get("--target-chips") ?? 0.0025 * 2 * request.committedPerPlayer),
      checkpointEvery: Number(flags.get("--checkpoint-every") ?? 256) }, {
      timeoutMs: Number(flags.get("--timeout-ms") ?? 600000), signal: controller.signal,
      checkpointPath: flags.get("--checkpoint"), onProgress: progress => process.stderr.write(`${JSON.stringify(progress)}\n`),
    });
    process.stderr.write(`${JSON.stringify({ elapsedMs: result.elapsedMs, sampledPeakWorkerRssBytes: result.sampledPeakWorkerRssBytes })}\n`);
    process.stdout.write(`${result.json}\n`);
    if (!JSON.parse(result.json).acceptance.passed) process.exitCode = 2;
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
