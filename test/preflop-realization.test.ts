// Preflop solver v1, PF3: texture classifier, RealizationSample adapter, ratio estimator,
// shrinkage and the fit step (synthetic libraries with known R, then the real B4 roots).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NUM_CLASSES } from "../src/lib/solver/comboCounts";
import { HANDS, handIndex } from "../src/lib/solver/hands";
import { mulberry32 } from "../src/lib/poker/equity";
import { hashRealizationTable } from "../src/lib/solver/preflop/hash";
import { loadLibraryRoots } from "../src/lib/solver/preflop/library-inputs";
import { CLASS_BUCKETS, HAND_BUCKETS, type HandBucket } from "../src/lib/solver/preflop/realization";
import {
  DEFAULT_FIT_OPTIONS, fitRealization, matrixEquityVsRange, measureLibrary, modelShare, realizationSamples,
  type ClassMeasurement, type PositionMeasurement, type RealizationSample,
} from "../src/lib/solver/preflop/realization-fit";
import { ALL_FLOPS, classifyFlopTexture, parseCard, stratumWeights, TEXTURE_STRATA } from "../src/lib/solver/preflop/texture";

test("texture classifier: 22,100 flops, weights sum to 1, every library flop is its own stratum", () => {
  assert.equal(ALL_FLOPS.length, 22100);
  const w = stratumWeights();
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  for (const id of TEXTURE_STRATA) {
    assert.ok(w[id] > 0, id);
    const [a, b, c] = id.replace("srp-btn-bb-", "").match(/../g)!.map(s => parseCard(s[0].toUpperCase() + s[1]));
    assert.equal(classifyFlopTexture([a, b, c]), id);
  }
  // Classification is suit-permutation invariant (texture, not suits).
  const f = [parseCard("Kh"), parseCard("Qh"), parseCard("4c")] as [number, number, number];
  const g = [parseCard("Ks"), parseCard("Qs"), parseCard("4d")] as [number, number, number];
  assert.equal(classifyFlopTexture(f), classifyFlopTexture(g));
});

const zeroMeasurement = (): ClassMeasurement => ({ mass: 0, share: 0, equity: 0, kish: 0 });

/** Synthetic library whose shares come from the terminal model itself with known R. */
function syntheticMeasurement(rTrue: { ip: number[]; oop: number[] }, kish: number) {
  const rng = mulberry32(7);
  const range = { ip: HANDS.map(() => (rng() < 0.6 ? 1 : 0.5)), oop: HANDS.map(() => (rng() < 0.7 ? 1 : 0.5)) };
  const out = {} as Record<"ip" | "oop", PositionMeasurement>;
  for (const p of ["ip", "oop"] as const) {
    const opp = p === "ip" ? range.oop : range.ip;
    const classes = HANDS.map((_, c) => ({
      mass: 1, kish, share: modelShare(p, c, opp, rTrue.ip, rTrue.oop), equity: matrixEquityVsRange(c, opp),
    }));
    const buckets = Object.fromEntries(HAND_BUCKETS.map(b => {
      const members = classes.filter((_, c) => CLASS_BUCKETS[c] === b);
      const share = members.reduce((s, m) => s + m.share, 0) / members.length, equity = members.reduce((s, m) => s + m.equity, 0) / members.length;
      return [b, { mass: members.length, share, equity, kish }];
    })) as Record<HandBucket, ClassMeasurement>;
    out[p] = { classes, buckets, range: range[p] };
  }
  return out;
}

test("fit step recovers a known R (up to the form's free scale) within 0.01 on a synthetic library", () => {
  const rng = mulberry32(11);
  const rTrue = { ip: HANDS.map(() => 0.8 + 0.6 * rng()), oop: HANDS.map(() => 0.6 + 0.6 * rng()) };
  const fit = fitRealization(syntheticMeasurement(rTrue, 1e9), { ...DEFAULT_FIT_OPTIONS, clamp: [0.05, 5], tolerance: 1e-5, maxSteps: 500 });
  assert.ok(fit.converged, `max share error ${fit.maxShareError}`);
  assert.ok(Math.abs(fit.conservationShift) < 1e-6, `consistent targets need no shift (δ = ${fit.conservationShift})`);
  // Shares depend only on R_IP/R_OOP, so compare after matching the overall scale.
  let num = 0, den = 0;
  for (const p of ["ip", "oop"] as const) for (let c = 0; c < NUM_CLASSES; c++) { num += rTrue[p][c]; den += fit.table[p].srp[c]; }
  const scale = num / den;
  for (const p of ["ip", "oop"] as const) for (let c = 0; c < NUM_CLASSES; c++) {
    assert.ok(Math.abs(fit.table[p].srp[c] * scale - rTrue[p][c]) < 0.01, `${p} ${HANDS[c].label}: ${fit.table[p].srp[c] * scale} vs ${rTrue[p][c]}`);
  }
  // 3BP / 4BP are not measured: defaults.
  assert.ok(fit.table.ip["3bp"].every(v => v === 1) && fit.table.oop["3bp"].every(v => v === 0.9));
});

test("default fit options converge (max share error < 0.005) on a synthetic library with the spec clamp", () => {
  const rng = mulberry32(3);
  const rTrue = { ip: HANDS.map(() => 0.9 + 0.3 * rng()), oop: HANDS.map(() => 0.7 + 0.3 * rng()) };
  const fit = fitRealization(syntheticMeasurement(rTrue, 50));
  assert.ok(fit.converged && fit.maxShareError < 0.005 && fit.steps <= 50, `${fit.maxShareError} after ${fit.steps}`);
});

test("shrinkage: a low-sample class is pulled to its bucket; an unseen class takes the bucket, an empty bucket the default", () => {
  const rTrue = { ip: HANDS.map(() => 1), oop: HANDS.map(() => 1) };
  const m = syntheticMeasurement(rTrue, 1e9);
  const t9s = handIndex("T9s"), q5s = handIndex("Q5s");
  const bucket = m.ip.buckets["suited-connectors"];
  const bucketR = bucket.share / bucket.equity;
  const classes = [...m.ip.classes];
  classes[t9s] = { mass: 1, kish: 0.01, share: 0.9, equity: 0.45 }; // R̂ = 2 on almost no data
  classes[q5s] = zeroMeasurement();
  classes[handIndex("72o")] = zeroMeasurement();
  const buckets = { ...m.ip.buckets, "offsuit-other": zeroMeasurement() };
  const fit = fitRealization({ ...m, ip: { ...m.ip, classes, buckets } }, { ...DEFAULT_FIT_OPTIONS, maxSteps: 0 });
  const row = (label: string) => fit.rows.ip[handIndex(label)];
  assert.ok(Math.abs(row("T9s").shrunk - (0.01 * 2 + 4 * bucketR) / 4.01) < 1e-12);
  assert.ok(Math.abs(row("T9s").shrunk - bucketR) < 0.01, "pulled to the bucket");
  assert.equal(row("Q5s").source, "bucket");
  assert.equal(row("72o").source, "default");
  assert.equal(row("72o").shrunk, 1.05);
});

test("ratio estimator on combo-level samples: share = R·equity per combo recovers R exactly per class", () => {
  // Two synthetic spots; each combo's share is R(class) × its (random) equity.
  const rng = mulberry32(5);
  const rClass = new Map<number, number>();
  const hands = ["AsKs", "AhKh", "Td9d", "Tc9c", "7s2h", "7d2c", "QhQd"];
  const player = () => {
    const equity = hands.map(() => 0.2 + 0.6 * rng());
    const rootEv = hands.map((h, i) => {
      const cls = handIndex(label(h));
      if (!rClass.has(cls)) rClass.set(cls, 0.7 + 0.5 * rng());
      return (rClass.get(cls)! * equity[i] - 0.5) * 550; // s = (ev + P/2)/P
    });
    return { hands, weight: hands.map(() => 1), normalizedWeight: hands.map(() => 100 + 50 * rng()), rootEv, rootEquity: equity };
  };
  const spots: RealizationSample[] = ["srp-btn-bb-5h4c2d", "srp-btn-bb-jcjd4s"].map(spotId => ({
    spotId: spotId as RealizationSample["spotId"], spotHash: "x", potType: "srp", startingPot: 550, rangesHash: "x", exploitabilityPctPot: 0,
    flop: ["2c", "3c", "4c"], flopWeight: 0.1, perCombo: { ip: player(), oop: player() },
  }));
  // Same class R for ip and oop players of one spot is fine: R depends only on class here.
  const m = measureLibrary(spots);
  for (const [cls, r] of rClass) {
    for (const p of ["ip", "oop"] as const) {
      const cm = m[p].classes[cls];
      assert.ok(cm.mass > 0);
      assert.ok(Math.abs(cm.share / cm.equity - r) < 1e-9, `${HANDS[cls].label} ${p}`);
    }
  }
});

function label(hand: string): string {
  const R = "AKQJT98765432";
  const [a, b] = [hand.slice(0, 2), hand.slice(2, 4)].sort((x, y) => R.indexOf(x[0]) - R.indexOf(y[0]));
  if (a[0] === b[0]) return a[0] + b[0];
  return a[0] + b[0] + (a[1] === b[1] ? "s" : "o");
}

test("B4 adapter + fit on the 12 real root.json files: converges and matches the saved artifact", () => {
  const { roots, inputs } = loadLibraryRoots(process.cwd());
  assert.equal(roots.length, 12);
  const samples = realizationSamples(roots);
  assert.ok(Math.abs(samples.reduce((s, x) => s + x.flopWeight, 0) - 1) < 1e-12, "stratum weights sum to 1");
  const fit = fitRealization(measureLibrary(samples));
  assert.ok(fit.converged && fit.maxShareError < 0.005, `${fit.maxShareError}`);
  for (const p of ["ip", "oop"] as const) for (const v of fit.table[p].srp) assert.ok(v >= 0.3 && v <= 1.6);
  const saved = JSON.parse(readFileSync("src/lib/solver/preflop/artifacts/pf3-realization-fit.json", "utf8"));
  assert.equal(hashRealizationTable(fit.table), saved.tableHash);
  assert.deepEqual(saved.inputs.roots.map((r: { sha256: string }) => r.sha256), inputs.map(r => r.sha256));
});
