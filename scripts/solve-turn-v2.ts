import { readFileSync, statSync } from "node:fs";
import { TURN_V2_CORPUS } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { validateTurnV2Request } from "../src/lib/solver/postflop/configurable-turn/rules";
import { readVectorCheckpoint } from "../src/lib/solver/postflop/vector/artifact-node";
import type { VectorTurnOptions } from "../src/lib/solver/postflop/vector/session";
import { runTurnV2Job } from "./turn-v2-runner";

async function main() {
  const args = process.argv.slice(2), flags = new Map<string, string>();
  const allowed = ["--fixture", "--request", "--iterations", "--algorithm", "--delay", "--target-chips", "--timeout-ms", "--checkpoint", "--resume", "--checkpoint-every"];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw new Error("Usage: solve:turn:v2 -- [--fixture wide-64|dry-value|paired-short|two-tone|connected | --request file.json | --resume checkpoint.json] [--iterations N] [--algorithm vanilla|cfr-plus] [--delay N] [--target-chips N] [--timeout-ms N] [--checkpoint new-file.json] [--checkpoint-every N]");
    flags.set(args[i], args[i + 1]);
  }
  if (["--fixture", "--request", "--resume"].filter(flag => flags.has(flag)).length > 1) throw new Error("Choose one input source");
  const resume = flags.has("--resume") ? readVectorCheckpoint(flags.get("--resume")!) : undefined;
  const identity = resume ? JSON.parse(resume.gameIdentity) : undefined;
  if (identity && identity.rules !== "turn-v2") throw new Error("Resume requires turn-v2 rules, not a turn-v1 checkpoint");
  const fixture = TURN_V2_CORPUS.find(request => request.id === `turn-v2-${flags.get("--fixture") ?? "wide-64"}`);
  if (!fixture) throw new Error("Unknown turn v2 fixture");
  let input: unknown = identity?.request ?? fixture;
  if (flags.has("--request")) {
    const path = flags.get("--request")!, stat = statSync(path);
    if (!stat.isFile() || stat.size > 65536) throw new Error("Request must be a regular JSON file of at most 64 KiB");
    input = JSON.parse(readFileSync(path, "utf8"));
  }
  const request = validateTurnV2Request(input);
  if (resume && ["--iterations", "--algorithm", "--delay"].some(flag => flags.has(flag))) throw new Error("Resume preserves its original iteration/algorithm settings");
  const options: VectorTurnOptions = resume?.options ?? { iterations: Number(flags.get("--iterations") ?? 100000),
    algorithm: (flags.get("--algorithm") ?? "cfr-plus") as VectorTurnOptions["algorithm"],
    averagingDelay: Number(flags.get("--delay") ?? (flags.get("--algorithm") === "vanilla" ? 0 : 20)) };
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    const result = await runTurnV2Job({ request, options, resume, maximumExploitability: Number(flags.get("--target-chips") ?? 0.25),
      checkpointEvery: Number(flags.get("--checkpoint-every") ?? 256) }, {
      timeoutMs: Number(flags.get("--timeout-ms") ?? 600000), signal: controller.signal,
      checkpointPath: flags.get("--checkpoint"), onProgress: progress => process.stderr.write(`${JSON.stringify(progress)}\n`),
    });
    const { json, ...observations } = result;
    process.stderr.write(`${JSON.stringify(observations)}\n`); process.stdout.write(`${json}\n`);
    if (!JSON.parse(json).acceptance.passed) process.exitCode = 2;
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
