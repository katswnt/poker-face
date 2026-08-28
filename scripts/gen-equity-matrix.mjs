// Generates the full 169×169 canonical heads-up equity matrix and writes it to
// src/lib/solver/equity-matrix.json.
//
// Run:  node --import tsx scripts/gen-equity-matrix.mjs   (one-time, ~1–2 min)
//
// Equity is zero-sum on a shared board, so only the upper triangle is Monte-Carlo'd and the
// lower triangle is set to its exact complement: eq(j,i) := 1 − eq(i,j). This halves the
// work AND makes eq(i,j)+eq(j,i) === 1 exactly. A hand class against itself is exactly 0.5
// by exchangeability, so the diagonal is asserted rather than needlessly simulated.
// Everything else is seeded (mulberry32) so the committed JSON is reproducible.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HANDS } from "../src/lib/solver/hands.ts";
import { headsUpEquity } from "../src/lib/solver/equityMatrix.ts";
import { mulberry32 } from "../src/lib/poker/equity.ts";

const SIMS = 2000;
const BASE_SEED = 20260723;

const n = HANDS.length; // 169
const M = Array.from({ length: n }, () => new Array(n).fill(0));

const start = Date.now();
let done = 0;
const totalMatchups = (n * (n - 1)) / 2;

for (let i = 0; i < n; i++) {
  M[i][i] = 0.5;
  for (let j = i + 1; j < n; j++) {
    const rng = mulberry32((BASE_SEED ^ (i * 131071 + j * 251)) >>> 0);
    const eq = headsUpEquity(HANDS[i].combo, HANDS[j].combo, SIMS, rng);
    M[i][j] = round(eq);
    // Derive the reverse direction from the value we actually save. Rounding both
    // directions independently can otherwise make a pair sum to 1.0001.
    M[j][i] = round(1 - M[i][j]);
    done++;
  }
  if (i % 20 === 0 || i === n - 1) {
    const pct = ((done / totalMatchups) * 100).toFixed(1);
    process.stdout.write(`\r  row ${i + 1}/${n}  (${pct}%  ${((Date.now() - start) / 1000).toFixed(0)}s)   `);
  }
}
process.stdout.write("\n");

function round(x) { return Math.round(x * 10000) / 10000; }

const out = {
  meta: {
    description: "Canonical 169×169 heads-up all-in preflop equity matrix (row hand's equity vs. col hand).",
    sims: SIMS,
    baseSeed: BASE_SEED,
    generatedBy: "scripts/gen-equity-matrix.mjs",
    diagonal: "Exact 0.5 by exchangeability; not simulated.",
    handOrder: "grid row-major (matches HANDS in src/lib/solver/hands.ts)",
  },
  hands: HANDS.map(h => h.label),
  equity: M,
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "src", "lib", "solver", "equity-matrix.json");
writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${outPath}  (${(JSON.stringify(out).length / 1024).toFixed(0)} KB, ${SIMS} sims, ${((Date.now() - start) / 1000).toFixed(0)}s)`);

// Quick sanity readout.
const idx = (lbl) => HANDS.findIndex(h => h.label === lbl);
const aa = idx("AA"), o72 = idx("72o"), kk = idx("KK");
console.log(`  AA vs 72o = ${M[aa][o72]}   AA vs AA = ${M[aa][aa]}   AA vs KK = ${M[aa][kk]}`);
