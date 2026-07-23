// Equity engine microbenchmark.
//
// Run:  node --import tsx bench/equity-bench.ts
//
// Two things are measured:
//   (a) Throughput — time a batch of N DISTINCT Monte Carlo equity computations (distinct
//       spots so the cache never short-circuits the work) and report sims/sec + ms/equity.
//   (b) The memoization win — compute one spot cold, then again warm (served from the
//       per-session cache) and show the warm call is effectively free.
import { performance } from "node:perf_hooks";
import { monteCarloEquity, clearEquityCache } from "../src/lib/poker/equity";
import { makeDeck } from "../src/lib/poker/cards";
import type { CardObj } from "../src/lib/poker/types";

const deck = makeDeck();

// Deterministic distinct spots: each takes 2 hole cards + a 3-card flop from a fixed deck
// offset, so no two batch spots are identical (cache stays cold across the batch).
function spotAt(offset: number): { hole: CardObj[]; board: CardObj[] } {
  const pick = (k: number) => deck[(offset + k) % deck.length];
  return { hole: [pick(0), pick(1)], board: [pick(2), pick(3), pick(4)] };
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function row(label: string, value: string): string {
  return "  " + label.padEnd(26) + value;
}

const SIMS = 1000;       // sims per equity call
const N = 200;           // distinct equity computations in the throughput batch
const OPPONENTS = 2;

console.log("\n=== monteCarloEquity benchmark ===");
console.log(`  sims/equity=${SIMS}  opponents=${OPPONENTS}  Node ${process.version}\n`);

// ── (a) Throughput ──────────────────────────────────────────────────────────────────────
// Warm up the JIT on a throwaway spot, then time N distinct (uncached) computations.
clearEquityCache();
monteCarloEquity(spotAt(7).hole, spotAt(7).board, OPPONENTS, SIMS, "gto", 1);
clearEquityCache();

const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const { hole, board } = spotAt(i);
  // Distinct dealSeed per i as well → guaranteed distinct cache keys, real work each time.
  monteCarloEquity(hole, board, OPPONENTS, SIMS, "gto", i + 1);
}
const t1 = performance.now();

const totalMs = t1 - t0;
const msPerEquity = totalMs / N;
const totalSims = N * SIMS;
const simsPerSec = totalSims / (totalMs / 1000);

console.log("(a) Throughput — " + N + " distinct equity computations (cold, uncached)");
console.log(row("total time", fmt(totalMs) + " ms"));
console.log(row("ms / equity", fmt(msPerEquity) + " ms"));
console.log(row("equities / sec", fmt(1000 / msPerEquity, 1)));
console.log(row("sims / sec", fmt(simsPerSec, 0)));
console.log("");

// ── (b) Memoization win ─────────────────────────────────────────────────────────────────
// Same spot twice: first is real work, second is a Map lookup.
clearEquityCache();
const memoSpot = spotAt(42);

const c0 = performance.now();
const cold = monteCarloEquity(memoSpot.hole, memoSpot.board, OPPONENTS, SIMS, "gto", 12345);
const c1 = performance.now();
const coldMs = c1 - c0;

const w0 = performance.now();
const warm = monteCarloEquity(memoSpot.hole, memoSpot.board, OPPONENTS, SIMS, "gto", 12345);
const w1 = performance.now();
const warmMs = w1 - w0;

const speedup = warmMs > 0 ? coldMs / warmMs : Infinity;

console.log("(b) Memoization — identical spot computed twice");
console.log(row("cold (cache miss)", fmt(coldMs, 3) + " ms"));
console.log(row("warm (cache hit)", fmt(warmMs, 4) + " ms"));
console.log(row("speedup", (Number.isFinite(speedup) ? fmt(speedup, 0) + "×" : "∞ (warm ~0 ms)")));
console.log(row("same value", cold === warm ? `yes (${fmt(cold, 4)})` : `NO — cold ${cold} vs warm ${warm}`));
console.log("");

// ── Summary table ───────────────────────────────────────────────────────────────────────
console.log("=== summary ===");
console.log("  metric                     value");
console.log("  " + "-".repeat(40));
console.log(row("ms / equity (cold)", fmt(msPerEquity)));
console.log(row("sims / sec", fmt(simsPerSec, 0)));
console.log(row("cold call", fmt(coldMs, 3) + " ms"));
console.log(row("warm/cached call", fmt(warmMs, 4) + " ms"));
console.log(row("cache speedup", Number.isFinite(speedup) ? fmt(speedup, 0) + "×" : "∞"));
console.log("");
