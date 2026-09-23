import { closeSync, constants, fstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { RIVER_BENCHMARKS, riverBenchmark } from "../src/lib/solver/river/exchange/catalog";
import {
  exportRiverPolicy, gradeRiverPolicy, prepareRiverExchange, stringifyRiverExchange,
} from "../src/lib/solver/river/exchange/exchange-node";
import { RIVER_EXCHANGE_MAX_FILE_BYTES } from "../src/lib/solver/river/exchange/types";
import { solveCompiledFactorizedRiverCfr } from "../src/lib/solver/river/factorized/cfr";

const HELP = `River benchmark exchange (v1; bounded two-player river games)

  npm run solver:river -- list
  npm run solver:river -- export <benchmark> [--out new-game.json]
  npm run solver:river -- solve <benchmark> [--iterations 1000] [--out new-policy.json]
  npm run solver:river -- grade <benchmark> --strategy policy.json [--out new-grade.json]

Without --out, commands print only JSON to stdout (use npm --silent for machine pipelines).
Output files must not already exist. Policy files are limited to 8 MiB.
Solve uses CFR+ with averaging delay 20; iterations must be 21–20000.
Grading recomputes quality using trusted local rules, never an imported payoff table.
Strategies are approximations for the named finite game, not universal or exact GTO.
`;

function readPolicy(path: string): unknown {
  // Check the opened descriptor, rather than following a separate stat/read race.
  // Nonblocking open also lets us reject a FIFO without waiting for a writer.
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > RIVER_EXCHANGE_MAX_FILE_BYTES) {
      throw new Error("Policy input must be a regular JSON file of at most 8 MiB");
    }
    // Bound the read itself if another process grows the file after fstat.
    const buffer = Buffer.alloc(RIVER_EXCHANGE_MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > RIVER_EXCHANGE_MAX_FILE_BYTES) throw new Error("Policy input exceeds 8 MiB");
    const text = buffer.toString("utf8", 0, length);
    try { return JSON.parse(text); }
    catch { throw new Error("Policy input is not valid JSON"); }
  } finally { closeSync(descriptor); }
}

function main(args: readonly string[]): void {
  if (args.length === 0 || (args.length === 1 && ["--help", "help"].includes(args[0]))) {
    process.stdout.write(HELP);
    return;
  }
  const [command, ...rest] = args;
  if (command === "list") {
    if (rest.length) throw new Error("list does not accept arguments");
    process.stdout.write(stringifyRiverExchange(RIVER_BENCHMARKS.map(benchmark => ({
      id: benchmark.id, description: benchmark.description, solver: benchmark.solver,
      ...prepareRiverExchange(benchmark.request).exported.counts,
    }))));
    return;
  }
  if (!["export", "solve", "grade"].includes(command)) throw new Error(`Unknown command ${command}; use --help`);
  const [id, ...flags] = rest;
  if (!id || id.startsWith("--")) throw new Error(`${command} requires a benchmark ID`);
  const benchmark = riverBenchmark(id);
  const allowed = command === "solve" ? ["--out", "--iterations"]
    : command === "grade" ? ["--out", "--strategy"] : ["--out"];
  const options = new Map<string, string>();
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (!allowed.includes(flag) || options.has(flag) || !value || value.startsWith("--")) {
      throw new Error(`Unknown, duplicate, or incomplete option ${flag}`);
    }
    options.set(flag, value);
  }
  if (command === "grade" && !options.has("--strategy")) throw new Error("grade requires --strategy policy.json");
  const iterationText = options.get("--iterations") ?? String(benchmark.solver.iterations);
  const iterations = /^\d+$/.test(iterationText) ? Number(iterationText) : NaN;
  if (!Number.isSafeInteger(iterations) || iterations < 21 || iterations > 20_000) {
    throw new Error("Iterations must be a whole number from 21 to 20000");
  }
  const prepared = prepareRiverExchange(benchmark.request);
  const result = command === "export" ? prepared.exported : command === "solve"
    ? exportRiverPolicy(prepared, solveCompiledFactorizedRiverCfr(prepared.compiled, {
      ...benchmark.solver, iterations,
    }).averageStrategy)
    : gradeRiverPolicy(prepared, readPolicy(options.get("--strategy")!));
  const output = stringifyRiverExchange(result);
  const destination = options.get("--out");
  if (destination) writeFileSync(destination, output, { encoding: "utf8", flag: "wx" });
  else process.stdout.write(output);
}

try { main(process.argv.slice(2)); }
catch (error) {
  process.stderr.write(`River exchange: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}
