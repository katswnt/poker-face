import { test } from "node:test";
import assert from "node:assert/strict";
import equityData from "../src/lib/solver/equity-matrix.json" with { type: "json" };
import { HANDS, handIndex, TOTAL_COMBOS } from "../src/lib/solver/hands";
import { headsUpEquity } from "../src/lib/solver/equityMatrix";
import { score7 } from "../src/lib/poker/score7";
import { solvePushFold, sbPayoff } from "../src/lib/solver/pushfold";
import { COMBOS, DISJOINT, ORDERED_DISJOINT_PAIRS } from "../src/lib/solver/comboCounts";
import hrc from "./fixtures/hu-pushfold-nash-hrc.json" with { type: "json" };
import solutionData from "../src/lib/solver/pushfold-solutions.json" with { type: "json" };
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
  for (let n = 0; n < 100_000; n++) {
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

test("equity matrix: every off-diagonal pair is an exact zero-sum complement", () => {
  for (let i = 0; i < EQ.length; i++) {
    for (let j = i + 1; j < EQ.length; j++) {
      assert.ok(Math.abs(EQ[i][j] + EQ[j][i] - 1) < 1e-12, `${HANDS[i].label}/${HANDS[j].label}`);
    }
  }
});

test("equity matrix: every hand class against itself is exactly 0.5", () => {
  for (let i = 0; i < EQ.length; i++) {
    assert.equal(EQ[i][i], 0.5, `${HANDS[i].label} vs itself`);
  }
});

// Exact cells from full enumeration (scripts/build-equity-matrix.ts), each averaged over every
// card-disjoint combo pair and all C(48,5) boards. `npm run audit:equity-matrix` recomputes the
// first four by an independent direct enumeration. Published class-vs-class references:
// AA vs KK ≈ 81.9–82.0% (suit-specific combos range 81.3–82.6%), AKs vs QQ ≈ 46%, AA vs 72o ≈ 88%.
test("equity matrix: known cells match the exact enumeration", () => {
  const cell = (a: string, b: string) => EQ[handIndex(a)][handIndex(b)];
  const exact: [string, string, number][] = [
    ["AA", "KK", 0.819461], ["AKs", "QQ", 0.460485], ["72o", "AA", 0.118004], ["T9s", "76s", 0.63648],
    ["AKo", "AKo", 0.5], ["AKs", "AKs", 0.5],
  ];
  for (const [a, b, value] of exact) {
    assert.ok(Math.abs(cell(a, b) - value) < 1e-6, `${a} vs ${b}: ${cell(a, b)} ≠ ${value}`);
    assert.ok(Math.abs(cell(a, b) + cell(b, a) - 1) < 1e-12);
  }
  assert.ok(cell("AA", "KK") > 0.819 && cell("AA", "KK") < 0.820);
  assert.ok(cell("AKs", "QQ") > 0.455 && cell("AKs", "QQ") < 0.465);
});

test("headsUpEquity live agrees with the committed matrix (± Monte-Carlo noise)", () => {
  const aa = HANDS[handIndex("AA")], kk = HANDS[handIndex("KK")];
  const live = headsUpEquity(aa.combo, kk.combo, 4000, mulberry32(42));
  assert.ok(Math.abs(live - EQ[handIndex("AA")][handIndex("KK")]) < 0.03, `AA vs KK live=${live} matrix=${EQ[handIndex("AA")][handIndex("KK")]}`);
  assert.ok(live > 0.79 && live < 0.85, `AA vs KK should be ~0.82, got ${live}`);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Simplified push/fold model properties
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
  // At 2bb this saved model should shove very widely, while some bottom offsuit hands may
  // remain folds. This broad guard catches an inverted chart without claiming agreement
  // with a published boundary hand by hand.
  assert.ok(SOL[2].sbShovePct > 85, `2bb SB jam should be very wide, got ${SOL[2].sbShovePct}%`);
});

test("every displayed depth meets the fixed-matrix convergence target", () => {
  for (const depth of DEPTHS) {
    assert.equal(SOL[depth].converged, true, `${depth}bb gap ${SOL[depth].nashGap} exceeds ${SOL[depth].tolerance}`);
    assert.ok(SOL[depth].nashGap <= SOL[depth].tolerance);
  }
});

test("at 10bb the simplified model stays inside a broad sanity band", () => {
  const { sbShovePct, bbCallPct } = SOL[10];
  assert.ok(sbShovePct > 50 && sbShovePct < 75, `SB shove% at 10bb = ${sbShovePct.toFixed(1)}`);
  assert.ok(bbCallPct > 30 && bbCallPct < 50, `BB call% at 10bb = ${bbCallPct.toFixed(1)}`);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Card removal: ordered card-disjoint combo pairs between classes
// ─────────────────────────────────────────────────────────────────────────────────────────
test("disjoint-pair count matrix: total, symmetry, row sums", () => {
  let total = 0;
  for (let a = 0; a < 169; a++) {
    let row = 0;
    for (let b = 0; b < 169; b++) {
      assert.equal(DISJOINT[a][b], DISJOINT[b][a], `${HANDS[a].label}/${HANDS[b].label}`);
      row += DISJOINT[a][b];
    }
    assert.equal(row, HANDS[a].weight * 1225, `${HANDS[a].label} row`);
    total += row;
  }
  assert.equal(ORDERED_DISJOINT_PAIRS, 1326 * 1225);
  assert.equal(total, 1_624_350);
});

test("disjoint-pair counts match closed forms and an independent string-deck brute force", () => {
  const closed: [string, string, number][] = [
    ["AA", "AA", 6],      // 6 ways × the 1 remaining pair of aces
    ["AA", "KK", 36],     // no shared rank
    ["AA", "AKs", 12],    // 6 × 2 AKs whose ace is not in the pair
    ["AA", "AKo", 36],    // 6 × (2 aces × 3 off-suit kings)
    ["AKs", "AKs", 12],   // 4 × 3
    ["AKo", "AKs", 24],   // 12 × 2 suits used by neither card
    ["AKo", "AKo", 84],   // 12 × (3·3 − 2)
    ["72o", "AA", 72],
  ];
  for (const [a, b, n] of closed) assert.equal(DISJOINT[handIndex(a)][handIndex(b)], n, `${a}/${b}`);
  // Independent brute force over the display deck (string cards, label-based classing).
  const deck = deckStrings();
  const cls = (x: string, y: string) => {
    const order = "23456789TJQKA", r = (c: string) => (c.startsWith("10") ? "T" : c[0]);
    const s = (c: string) => c.slice(-1);
    const [hi, lo] = order.indexOf(r(x)) >= order.indexOf(r(y)) ? [r(x), r(y)] : [r(y), r(x)];
    return handIndex(hi === lo ? hi + lo : hi + lo + (s(x) === s(y) ? "s" : "o"));
  };
  const combos: [string, string, number][] = [];
  for (let i = 0; i < 52; i++) for (let j = i + 1; j < 52; j++) combos.push([deck[i], deck[j], cls(deck[i], deck[j])]);
  assert.equal(combos.length, COMBOS.length);
  const brute = Array.from({ length: 169 }, () => new Array(169).fill(0));
  for (const [x1, x2, a] of combos) for (const [y1, y2, b] of combos) {
    if (x1 !== y1 && x1 !== y2 && x2 !== y1 && x2 !== y2) brute[a][b]++;
  }
  assert.deepEqual(brute, DISJOINT);
});

test("push/fold payoff weights every concrete disjoint deal equally (card removal)", () => {
  // Brute force over all 1,624,350 ordered concrete deals must equal the class-level payoff.
  const sol = SOL[10], S = 10;
  let total = 0;
  for (const x of COMBOS) {
    const h = x.cls, s = sol.sbShove[h];
    for (const y of COMBOS) {
      if (x.c1 === y.c1 || x.c1 === y.c2 || x.c2 === y.c1 || x.c2 === y.c2) continue;
      const k = y.cls, c = sol.bbCall[k];
      total += (1 - s) * (S - 0.5) + s * (c * 2 * S * EQ[h][k] + (1 - c) * (S + 1));
    }
  }
  const brute = total / ORDERED_DISJOINT_PAIRS;
  assert.ok(Math.abs(brute - sbPayoff(sol.sbShove, sol.bbCall, S, 0.5, 1)) < 1e-9, `${brute}`);
});

// HoldemResources.net's heads-up no-ante Nash push/fold tables (card removal included) give,
// combo-weighted, 58.4% SB shoves / 37.3% BB calls at 10bb and 40.3% / 21.7% at 20bb.
const hrcActs = (cell: string, stack: number) => {
  const intervals = (hrc.intervals as Record<string, number[][]>)[cell];
  if (intervals) return intervals.some(([lo, hi]) => lo <= stack && stack <= hi);
  return cell === "20+" || Number(cell) >= stack;
};

test("saved push/fold charts match the published Nash tables (card removal)", () => {
  const solutions = solutionData.solutions as Record<string, { sbShove: number[]; bbCall: number[]; sbShovePct: number; bbCallPct: number }>;
  let mismatches = 0;
  for (const [key, sol] of Object.entries(solutions)) {
    const stack = Number(key);
    HANDS.forEach((h, i) => {
      if (Math.abs(sol.sbShove[i] - (hrcActs(hrc.push[h.row][h.col], stack) ? 1 : 0)) > 0.5) mismatches++;
      if (Math.abs(sol.bbCall[i] - (hrcActs(hrc.call[h.row][h.col], stack) ? 1 : 0)) > 0.5) mismatches++;
    });
  }
  // 37 depths × 2 charts × 169 hands = 12,506 decisions. The published thresholds are rounded
  // to 0.1bb, so a few boundary hands can legitimately land on the other side.
  assert.ok(mismatches <= 20, `${mismatches} hand decisions disagree with the published Nash tables`);
  const ten = solutions["10.0"];
  assert.ok(Math.abs(ten.sbShovePct - 58.4) < 0.6, `10bb shove ${ten.sbShovePct}`);
  assert.ok(Math.abs(ten.bbCallPct - 37.3) < 0.6, `10bb call ${ten.bbCallPct}`);
});

test("live solver matches the saved chart at 10bb", () => {
  const saved = (solutionData.solutions as Record<string, { sbShovePct: number; bbCallPct: number }>)["10.0"];
  assert.ok(Math.abs(SOL[10].sbShovePct - saved.sbShovePct) < 1e-4);
  assert.ok(Math.abs(SOL[10].bbCallPct - saved.bbCallPct) < 1e-4);
  assert.equal(SOL[10].cardRemoval, true);
});
