// Reproduce: node --import tsx bench/trainer-equity-accuracy.ts
// Fixed budgets, cold cache, deterministic seeds. Timings are local measurements.
import { performance } from "node:perf_hooks";
import { platform, arch, cpus } from "node:os";
import { clearEquityCache, estimateEquity, monteCarloEquityEstimate, exactEquity } from "../src/lib/poker/equity";
import type { CardObj } from "../src/lib/poker/types";

const parse = (words: string): CardObj[] => words.split(" ").map(word => ({ rank: word[0] === "T" ? "10" : word[0], suit: ({ s: "♠", h: "♥", d: "♦", c: "♣" } as Record<string, string>)[word[1]] }));
const hole = parse("Tc 9c"), board = parse("Ks 9d 3h 6d 2s");
const runs = 20;
const rows = [];
for (const cardsOnBoard of [3, 4, 5]) {
  for (const opponents of [1, 3, 5]) {
    for (const samples of [1000, 10_000]) {
      monteCarloEquityEstimate(hole, board.slice(0, cardsOnBoard), opponents, samples, "wild", 0);
      clearEquityCache();
      const start = performance.now();
      for (let seed = 1; seed <= runs; seed++) monteCarloEquityEstimate(hole, board.slice(0, cardsOnBoard), opponents, samples, "wild", seed);
      rows.push({ boardCards: cardsOnBoard, opponents, method: "sampled", budget: samples, meanMs: +(performance.now() - start).toFixed(3) / runs });
    }
  }
}
const start = performance.now();
for (let seed = 1; seed <= runs; seed++) estimateEquity(hole, board, 1, 10_000, "wild", seed);
rows.push({ boardCards: 5, opponents: 1, method: "enumerated", budget: 990, meanMs: +(performance.now() - start).toFixed(3) / runs });

const exact = exactEquity(hole, board, "wild");
const errors = [1000, 10_000].map(samples => {
  let squaredError = 0, seTotal = 0, covered = 0;
  for (let seed = 200; seed < 220; seed++) {
    const estimate = monteCarloEquityEstimate(hole, board, 1, samples, "wild", seed);
    squaredError += (estimate.equity - exact) ** 2;
    seTotal += estimate.standardError;
    if (Math.abs(estimate.equity - exact) <= 1.96 * estimate.standardError) covered++;
  }
  return { samples, rmsErrorPoints: 100 * Math.sqrt(squaredError / runs), meanStandardErrorPoints: 100 * seTotal / runs, approximate95Coverage: `${covered}/${runs}` };
});
console.log(JSON.stringify({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, runs, rows, exactEquity: exact, errors, caveat: "A deterministic regression sample, not proof of universal error coverage or cross-device speed." }, null, 2));
