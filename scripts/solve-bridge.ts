import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runBridgeSpot } from "./bridge-runner";
import { validateBridgeSpot, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { buildBridgeFixture, bridgeFixtureIds, type BridgeFixtureId } from "../src/lib/solver/bridge/fixtures";

const USAGE = [
  "Usage: npm run solve:bridge -- (--fixture <id> | --spot spot.json) [--out result.json] [--threads N] [--timeout-ms N] [--write-spot spot.json]",
  `Fixtures: ${bridgeFixtureIds().join(", ")}`,
  "Solves one contract-v1 spot with the native postflop-solver bridge (npm run build:bridge first).",
  "Approximate finite-game strategy to the spot's exploitability target, not exact GTO. Existing files are never overwritten.",
].join("\n");

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { console.log(USAGE); return; }
  const allowed = new Set(["--fixture", "--spot", "--out", "--threads", "--timeout-ms", "--write-spot"]), values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown, duplicate or incomplete option; use --help\n${USAGE}`);
    values.set(args[i], args[i + 1]);
  }
  if (values.has("--fixture") === values.has("--spot")) throw new Error("Choose exactly one of --fixture or --spot");
  let spot: BridgeSpotV1;
  if (values.has("--fixture")) {
    const id = values.get("--fixture")!;
    if (!bridgeFixtureIds().includes(id as BridgeFixtureId)) throw new Error(`Unknown fixture ${id}`);
    spot = buildBridgeFixture(id as BridgeFixtureId);
  } else {
    const path = values.get("--spot")!;
    if (statSync(path).size > 64 * 1024 ** 2) throw new Error("Spot file exceeds 64 MiB");
    spot = validateBridgeSpot(JSON.parse(readFileSync(path, "utf8")));
  }
  const writeNew = (path: string, text: string) => {
    const target = resolve(path);
    if (existsSync(target)) throw new Error(`${target} exists; choose a new path`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.partial`, text, { flag: "wx" }); renameSync(`${target}.partial`, target);
  };
  if (values.has("--write-spot")) writeNew(values.get("--write-spot")!, `${JSON.stringify(spot, null, 2)}\n`);
  const out = values.get("--out");
  if (out && existsSync(resolve(out))) throw new Error(`${resolve(out)} exists; choose a new path`);
  const controller = new AbortController(), cancel = () => controller.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try {
    const run = await runBridgeSpot(spot, {
      signal: controller.signal, threads: values.has("--threads") ? Number(values.get("--threads")) : undefined,
      timeoutMs: values.has("--timeout-ms") ? Number(values.get("--timeout-ms")) : undefined,
      onProgress: progress => console.error(JSON.stringify(progress)),
    });
    if (out) writeNew(out, JSON.stringify(run.result));
    const { result } = run;
    console.log(JSON.stringify({
      spot: spot.id, spotHash: run.spotHash, reached: result.exploitability.reached, iterations: result.iterations,
      exploitabilityChips: result.exploitability.chips, exploitabilityPctPot: result.exploitability.pctPot,
      precision: result.engine.precision, threads: result.engine.threads, timings: result.timings, memory: result.memory,
      sampledPeakRssBytes: run.sampledPeakRssBytes, exportedNodes: result.counts.exportedNodes, out: out ? resolve(out) : null,
    }));
    if (!result.exploitability.reached) process.exitCode = 2;
  } finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
