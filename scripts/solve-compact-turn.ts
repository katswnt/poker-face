import { readFileSync, statSync } from "node:fs";
import { COMPACT_TURN_FIXTURES } from "../src/lib/solver/postflop/fixtures";
import type { TurnRequest } from "../src/lib/solver/turn/game";
import type { CompactTurnOptions } from "../src/lib/solver/postflop/session";
import { runCompactTurnJob } from "./compact-turn-runner";

async function main() {
  const args = process.argv.slice(2), flags = new Map<string, string>();
  const allowed = ["--fixture", "--request", "--iterations", "--algorithm", "--delay", "--timeout-ms"];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw new Error("Usage: solve:turn:compact -- [--fixture demo|boundary | --request file.json] [--iterations N] [--algorithm vanilla|cfr-plus] [--delay N] [--timeout-ms N]");
    flags.set(args[i], args[i + 1]);
  }
  if (flags.has("--fixture") && flags.has("--request")) throw new Error("Choose fixture or request, not both");
  const fixture = flags.get("--fixture") ?? "demo";
  if (fixture !== "demo" && fixture !== "boundary") throw new Error("Unknown fixture");
  let request: TurnRequest = COMPACT_TURN_FIXTURES[fixture === "demo" ? 0 : 1];
  if (flags.has("--request")) {
    const path = flags.get("--request")!;
    if (!statSync(path).isFile() || statSync(path).size > 65536) throw new Error("Request must be a regular JSON file of at most 64 KiB");
    request = JSON.parse(readFileSync(path, "utf8"));
  }
  const options: CompactTurnOptions = { iterations: Number(flags.get("--iterations") ?? 1000),
    algorithm: (flags.get("--algorithm") ?? "cfr-plus") as CompactTurnOptions["algorithm"],
    averagingDelay: Number(flags.get("--delay") ?? (flags.get("--algorithm") === "vanilla" ? 0 : 20)) };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    const result = await runCompactTurnJob({ request, options }, {
      timeoutMs: Number(flags.get("--timeout-ms") ?? 600000), signal: controller.signal,
      onProgress: progress => process.stderr.write(`${JSON.stringify(progress)}\n`),
    });
    process.stderr.write(`${JSON.stringify({ elapsedMs: result.elapsedMs, sampledPeakWorkerRssBytes: result.sampledPeakWorkerRssBytes,
      note: "Stage/chunk RSS samples, not an OS-enforced hard memory bound or exact peak." })}\n`);
    process.stdout.write(`${result.json}\n`);
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
