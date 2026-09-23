import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRiverBenchmarkManifest } from "../src/lib/solver/river/exchange/benchmarks-node";
import { stringifyRiverExchange } from "../src/lib/solver/river/exchange/exchange-node";

const args = process.argv.slice(2);
if (args.length !== 1 || !["--check", "--write"].includes(args[0])) {
  throw new Error("Use --check to reproduce the manifest or --write to intentionally regenerate it");
}
const path = join(process.cwd(), "src/lib/solver/river/exchange/artifacts/benchmarks-v1.json");
const manifest = createRiverBenchmarkManifest();
const serialized = stringifyRiverExchange(manifest);
if (args[0] === "--check") {
  if (readFileSync(path, "utf8") !== serialized) throw new Error("River benchmark manifest is stale");
} else writeFileSync(path, serialized, "utf8");
for (const benchmark of manifest.benchmarks) {
  console.log(`${benchmark.id}: ${benchmark.counts.compatibleDeals} deals, ` +
    `${benchmark.counts.equivalentRepeatedStates} states, ` +
    `exploitability ${benchmark.report.exploitability.toFixed(9)} chips/hand`);
}
console.log(args[0] === "--check" ? "River benchmark manifest: reproducible" : `Wrote ${path}`);
