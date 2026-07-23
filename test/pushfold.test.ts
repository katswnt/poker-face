import { test } from "node:test";
import assert from "node:assert/strict";
import equityData from "../src/lib/solver/equity-matrix.json" with { type: "json" };
import { HANDS, handIndex, TOTAL_COMBOS } from "../src/lib/solver/hands";
import { score7, headsUpEquity } from "../src/lib/solver/equityMatrix";
import { solvePushFold } from "../src/lib/solver/pushfold";
import { handScore } from "../src/lib/poker/eval";
import { mulberry32 } from "../src/lib/poker/equity";
import { deckStrings, card } from "./helpers";

const EQ: number[][] = equityData.equity;

// ─────────────────────────────────────────────────────────────────────────────────────────
// Hands table
// ─────────────────────────────────────────────────────────────────────────────────────────
test("169 canonical hands with correct combo weights (Σ = 1326)", () => {
  assert.equal(HANDS.length, 169);
  assert.equal(HANDS.filter(h => h.type === "pair").length, 13);
  assert.equal(HANDS.filter(h => h.type === "suited").length, 78);
  assert.equal(HANDS.filter(h => h.type === "offsuit").length, 78);
  assert.equal(TOTAL_COMBOS, 1326); // 13·6 + 78·4 + 78·12
  assert.equal(handIndex("AA") >= 0 && handIndex("72o") >= 0 && handIndex("AKs") >= 0, true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// score7 is a faithful, non-allocating stand-in for eval.ts handScore (the reuse guarantee)
// ─────────────────────────────────────────────────────────────────────────────────────────
test("score7 === handScore on random 7-card hands (evaluators cannot drift)", () => {
  const rng = mulberry32(1234);
  const deck = deckStrings().map(card);
  for (let n = 0; n < 5000; n++) {
    const d = [...deck];
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    const seven = d.slice(0, 7);
    const a = score7(seven);
    const b = handScore([seven[0], seven[1]], [seven[2], seven[3], seven[4], seven[5], seven[6]]);
    assert.equal(a, b, `score7/handScore disagree on ${seven.map(c => c.rank + c.suit).join(" ")}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Equity matrix sanity
// ─────────────────────────────────────────────────────────────────────────────────────────
test("equity matrix: AA crushes 72o (≥ 0.85)", () => {
  const eq = EQ[handIndex("AA")][handIndex("72o")];
  assert.ok(eq >= 0.85, `AA vs 72o should be ~0.87, got ${eq}`);
});

test("equity matrix: zero-sum, eq(i,j) + eq(j,i) ≈ 1 (±0.03)", () => {
  const pairs: [string, string][] = [["AA", "72o"], ["AKs", "22"], ["QJs", "T9o"], ["KK", "AKo"], ["55", "A5s"]];
  for (const [x, y] of pairs) {
    const i = handIndex(x), j = handIndex(y);
    assert.ok(Math.abs(EQ[i][j] + EQ[j][i] - 1) <= 0.03, `${x}/${y}: ${EQ[i][j]} + ${EQ[j][i]}`);
  }
});

test("equity matrix: a hand vs. its own class is a coin flip (~0.5)", () => {
  for (const lbl of ["AA", "KK", "AKs", "72o", "T9s"]) {
    const i = handIndex(lbl);
    assert.ok(Math.abs(EQ[i][i] - 0.5) <= 0.03, `${lbl} vs ${lbl} should be ~0.5, got ${EQ[i][i]}`);
  }
});

test("headsUpEquity live agrees with the committed matrix (± Monte-Carlo noise)", () => {
  const aa = HANDS[handIndex("AA")], kk = HANDS[handIndex("KK")];
  const live = headsUpEquity(aa.combo, kk.combo, 4000, mulberry32(42));
  assert.ok(Math.abs(live - EQ[handIndex("AA")][handIndex("KK")]) < 0.03, `AA vs KK live=${live} matrix=${EQ[handIndex("AA")][handIndex("KK")]}`);
  assert.ok(live > 0.79 && live < 0.85, `AA vs KK should be ~0.82, got ${live}`);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Nash push/fold properties
// ─────────────────────────────────────────────────────────────────────────────────────────
const DEPTHS = [2, 5, 10, 15, 20];
const SOL = Object.fromEntries(DEPTHS.map(d => [d, solvePushFold(d)]));

test("AA is always shoved by SB and called by BB, at every depth", () => {
  const aa = handIndex("AA");
  for (const d of DEPTHS) {
    assert.equal(SOL[d].sbShove[aa], 1, `SB should shove AA at ${d}bb`);
    assert.equal(SOL[d].bbCall[aa], 1, `BB should call AA at ${d}bb`);
  }
});

test("72o is NOT in BB's calling range at 15bb", () => {
  assert.equal(SOL[15].bbCall[handIndex("72o")], 0);
});

test("SB shove range widens monotonically as the stack shrinks", () => {
  // shove% at 5bb > shove% at 15bb (and strictly monotone across all tested depths).
  assert.ok(SOL[5].sbShovePct > SOL[15].sbShovePct, `5bb ${SOL[5].sbShovePct}% should exceed 15bb ${SOL[15].sbShovePct}%`);
  for (let i = 1; i < DEPTHS.length; i++) {
    const shallower = SOL[DEPTHS[i - 1]].sbShovePct, deeper = SOL[DEPTHS[i]].sbShovePct;
    assert.ok(shallower > deeper, `shove% must fall as stack grows: ${DEPTHS[i - 1]}bb=${shallower}% vs ${DEPTHS[i]}bb=${deeper}%`);
  }
});

test("at ~2bb SB shoves almost everything (very wide jam)", () => {
  // The true HU Nash jam at 2bb is ~90% — the bottom offsuit hands (72o, 82o, 32o, …) are
  // marginal folds even here because the BB is calling ~100%. So "≈100%" means "nearly the
  // whole grid", not literally every hand.
  assert.ok(SOL[2].sbShovePct > 85, `2bb SB jam should be very wide, got ${SOL[2].sbShovePct}%`);
});

test("at 10bb the ranges match published Nash (SB ~60–70%, BB ~35–45%)", () => {
  const { sbShovePct, bbCallPct } = SOL[10];
  assert.ok(sbShovePct > 52 && sbShovePct < 72, `SB shove% at 10bb = ${sbShovePct.toFixed(1)} (expected ~60–70)`);
  assert.ok(bbCallPct > 33 && bbCallPct < 47, `BB call% at 10bb = ${bbCallPct.toFixed(1)} (expected ~35–45)`);
});
