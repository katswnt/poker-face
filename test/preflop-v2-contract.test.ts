import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMBOS } from "../src/lib/solver/comboCounts";
import { HANDS } from "../src/lib/solver/hands";
import { parseCard, TEXTURE_STRATA } from "../src/lib/solver/preflop/texture";
import { bridgeToPreflopValues, continuationValues, settleContinuation } from "../src/lib/solver/preflop-v2/accounting";
import { jointMeasure, estimateJointNumerator, type WeightedHand } from "../src/lib/solver/preflop-v2/measure";
import { buildManifest, corpusSpot, flopPopulation, orbitKey, profileRange, validateSymmetricRange,
  verifyManifest, type SelectionTranscript } from "../src/lib/solver/preflop-v2/corpus";

const near = (a: number, b: number, tol = 1e-10) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const choose = (xs: number[], n: number): number[][] => n === 0 ? [[]] : xs.flatMap((x, i) => choose(xs.slice(i + 1), n - 1).map(t => [x, ...t]));
const file = (name: string) => JSON.parse(readFileSync(`src/lib/solver/preflop-v2/${name}.json`, "utf8"));

test("from-now chip accounting permits losses and receipts greater than the original pot", () => {
  assert.deepEqual(settleContinuation(10, 30, [20, 20], 0), { receipts: [50, 0], values: [30, -20] });
  // A 30-chip shove, a 10-chip call and a loss: return the uncalled 20 first.
  assert.deepEqual(settleContinuation(10, 30, [30, 10], 1), { receipts: [20, 30], values: [-10, 20] });
  assert.deepEqual(settleContinuation(10, 30, [30, 10], "split"), { receipts: [35, 15], values: [5, 5] });
  assert.deepEqual(settleContinuation(10, 30, [0, 0], 0).values, [10, 0]);
  assert.deepEqual(settleContinuation(10, 30, [30, 30], 1).values, [-30, 40]);
  const g = continuationValues(5.5, 97.5, [7, 7], [19.5, 0]);
  near(g[0] + g[1] - 2 * 2.5, 0.5); // full-hand utilities retain exactly the dead money.
  assert.deepEqual(bridgeToPreflopValues([-10, 10], 5.5), [12.75, -7.25]); // OOP/IP → IP/OOP, then origin.
  assert.throws(() => continuationValues(10, 30, [20, 20], [49, 0]), /conserv/);
  assert.throws(() => continuationValues(10, 30, [31, 31], [72, 0]), /stack/);
  assert.throws(() => bridgeToPreflopValues([1, 2], 10), /zero.sum/);
  for (const bad of [NaN, Infinity, -1]) assert.throws(() => settleContinuation(10, 30, [bad, 0], 0));
});

test("native float32 mapping preserves raw accounting residuals within the existing referee tolerance", () => {
  const ev: [number, number] = [48.014284, -48.014279];
  assert.throws(() => bridgeToPreflopValues(ev, 100), /zero.sum/, "exact callers must not inherit an engine tolerance");
  const values = bridgeToPreflopValues(ev, 100, 0.0002);
  assert.deepEqual(values, [ev[1] + 50, ev[0] + 50]);
  near(values[0] + values[1] - 100, ev[0] + ev[1]); // do not pin/shift original observations.
  assert.throws(() => bridgeToPreflopValues([48, -47.999], 100, 0.0002), /zero.sum/);
  for (const tolerance of [NaN, Infinity, -1, 0.000201]) assert.throws(() => bridgeToPreflopValues([0, 0], 100, tolerance), /tolerance/);
});

test("joint hand/board law agrees with an independent ordered-card deal enumeration", () => {
  const cards = Array.from({ length: 8 }, (_, i) => i), pairs = choose(cards, 2);
  const ranges: [WeightedHand[], WeightedHand[]] = [
    pairs.map(cards => ({ cards: cards as [number, number], weight: cards.includes(0) ? 1 : 0.5 })),
    pairs.map(cards => ({ cards: cards as [number, number], weight: cards.includes(1) ? 1 : 0.25 })),
  ];
  const m = jointMeasure(8, 2, ranges), index = new Map(pairs.map((p, i) => [p.join(","), i]));
  const actual = new Map<string, number>(); let normalizer = 0;
  // Enumerate ordered six-card deals, not the implementation's unordered-board formula.
  const deal = (used: number[]) => {
    if (used.length < 6) { for (const c of cards) if (!used.includes(c)) deal([...used, c]); return; }
    const h = index.get(used.slice(0, 2).sort((a, b) => a - b).join(","))!;
    const k = index.get(used.slice(2, 4).sort((a, b) => a - b).join(","))!;
    const board = used.slice(4).sort((a, b) => a - b), key = `${h}/${k}/${board}`;
    const w = ranges[0][h].weight * ranges[1][k].weight;
    actual.set(key, (actual.get(key) ?? 0) + w); normalizer += w;
  }; deal([]);
  let total = 0;
  for (const [key, raw] of actual) {
    const [h, k, board] = key.split("/"), probability = m.jointMass(Number(h), Number(k), board.split(",").map(Number));
    near(probability, raw / normalizer); total += probability;
  }
  near(total, 1); near(m.jointMass(0, 0, [6, 7]), 0); near(m.jointMass(0, 13, [0, 7]), 0);
  for (let h = 0; h < pairs.length; h++) {
    let handTotal = 0;
    for (const board of pairs) {
      const joint = ranges[1].reduce((n, _, k) => n + m.jointMass(h, k, board), 0);
      near(joint, m.handBoardMass(0, h, board)); handTotal += joint;
      if (m.boardMass(board) > 0) near(joint, m.boardMass(board) * m.handGivenBoard(0, h, board));
      near(joint, m.handMass(0, h) * m.boardGivenHand(0, h, board));
    }
    near(handTotal, m.handMass(0, h));
  }
  assert.ok(Math.abs(m.boardMass([0, 1]) - 1 / 28) > 0.001, "uniform boards followed by surviving ranges changes the deal");
  assert.ok(m.boardGivenHand(0, 0, [2, 3]) + m.boardGivenHand(0, 0, [4, 5]) < 0.5,
    "two sampled boards must not be renormalized to probability one");
});

test("joint measure rejects duplicate cards/ranges, impossible support and malformed boards", () => {
  const good: WeightedHand[] = [{ cards: [0, 1], weight: 1 }];
  assert.throws(() => jointMeasure(6, 3, [good, good]), /deck|board/);
  assert.throws(() => jointMeasure(8, 2, [good, good]), /compatible/);
  assert.throws(() => jointMeasure(8, 2, [[...good, ...good], [{ cards: [2, 3], weight: 1 }]]), /duplicate/);
  for (const weight of [0, -1, Infinity, NaN]) assert.throws(() => jointMeasure(8, 2, [good, [{ cards: [2, 3], weight }]]));
  const m = jointMeasure(8, 2, [good, [{ cards: [2, 3], weight: 1 }]]);
  for (const board of [[4, 4], [4], [4, 8], [4, 5.5]]) assert.throws(() => m.boardMass(board));
  assert.throws(() => m.handMass(0, 2));
});

test("inverse-inclusion weighting estimates joint numerators without sampled-board self-normalization", () => {
  const population = [2, 3, 7, 11, 17], samples = choose([0, 1, 2, 3, 4], 2), denominator = 80;
  const estimates = samples.map(s => estimateJointNumerator(denominator, [10], [{ populationSize: 5, values: s.map(i => population[i]) }]));
  near(estimates.reduce((a, b) => a + b, 0) / samples.length, 50 / 80);
  // Known calibration units are removed from the next holdout sampling population.
  near(estimateJointNumerator(80, [10, 2, 3], [{ populationSize: 3, values: [7, 11, 17] }]), 50 / 80);
  near(estimateJointNumerator(80, [-10], [{ populationSize: 5, values: [-2, -3] }]), -estimates[0]);
  assert.throws(() => estimateJointNumerator(80, [], [{ populationSize: 5, values: [] }]));
  assert.throws(() => estimateJointNumerator(0, [], []));
  assert.throws(() => estimateJointNumerator(80, [], [{ populationSize: 1, values: [1, 2] }]));
});

test("flop population is a complete suit quotient, with unchanged texture and physical counts", () => {
  const population = flopPopulation();
  assert.equal(population.length, 1755); assert.equal(population.reduce((n, o) => n + o.multiplicity, 0), 22100);
  assert.equal(new Set(population.map(o => o.key)).size, 1755);
  const key = (s: string) => orbitKey(s.match(/../g)!.map(parseCard));
  assert.equal(key("Ks7h2d"), key("Kc7d2h")); assert.notEqual(key("Ks7h2d"), key("Ks7s2d"));
  for (const [board, count] of [["AcKcQc", 4], ["AcAdAh", 4], ["AcKdQh", 24], ["AcAdKh", 12]] as const)
    assert.equal(population.find(o => o.key === key(board))!.multiplicity, count);
  assert.throws(() => orbitKey([0, 0, 1]));
});

test("both stress profiles cover every physical hand and reject suit-asymmetric substitutions", () => {
  for (const profile of ["A", "B"] as const) for (const player of [0, 1] as const) {
    const range = profileRange(profile, player); assert.equal(range.length, 1326); validateSymmetricRange(range);
    for (const [i, h] of HANDS.entries()) {
      const entries = range.filter(r => r.classIndex === i); assert.equal(entries.length, h.weight);
      const expected = profile === "A" ? (player === 0 || h.type === "pair" || h.hi === 14 || h.lo >= 10 ? 1 : 0.5)
        : player === 0 ? (h.type === "pair" || h.type === "suited" || h.lo >= 10 ? 1 : 0.5)
          : h.type === "pair" || (h.type === "suited" && h.hi === 14) ? 1 : 0.25;
      assert.ok(entries.every(e => e.weight === expected && Math.fround(e.weight) === e.weight));
    }
    const bad = range.map((r, i) => i === 0 ? { ...r, weight: 0.125 } : r);
    assert.throws(() => validateSymmetricRange(bad), /symmetr/);
    assert.throws(() => validateSymmetricRange(range.slice(1)), /complete/);
  }
  assert.equal(new Set(COMBOS.map(c => `${c.c1},${c.c2}`)).size, 1326);
});

test("orbit multiplicities preserve class-conditional joint mass, not a fixed physical hand's mass", () => {
  const representative = [parseCard("Ac"), parseCard("7d"), parseCard("2h")], key = orbitKey(representative);
  const orbit: number[][] = [];
  // Independent enumeration of every physical flop; match rank/suit pattern directly.
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++)
    if (a !== b && a !== c && b !== c) orbit.push([48 + a, 20 + b, c]);
  assert.equal(orbit.length, 24); assert.ok(orbit.every(b => orbitKey(b) === key));
  const oop = profileRange("B", 0), ip = profileRange("B", 1);
  const mass = (board: readonly number[], classIndex: number, physical = false) => {
    let sum = 0;
    const heroes = oop.filter(h => h.classIndex === classIndex);
    for (const h of physical ? heroes.slice(0, 1) : heroes) for (const k of ip) {
      if (new Set([...h.cards, ...k.cards, ...board]).size === 7) sum += h.weight * k.weight;
    }
    return sum;
  };
  for (const label of ["AA", "AKs", "72o"]) {
    const cls = HANDS.findIndex(h => h.label === label);
    near(orbit.reduce((s, b) => s + mass(b, cls), 0), 24 * mass(representative, cls));
  }
  const aa = HANDS.findIndex(h => h.label === "AA");
  assert.notEqual(orbit.reduce((s, b) => s + mass(b, aa, true), 0), 24 * mass(representative, aa, true));
});

test("frozen manifest replays every draw, has disjoint orbit holdouts and all 504 hashed roots", () => {
  const transcript = file("selection") as SelectionTranscript, saved = file("manifest"), m = buildManifest(transcript);
  assert.deepEqual(m, saved); verifyManifest(saved);
  assert.equal(m.boards.length, 84); assert.equal(new Set(m.boards.map(b => b.key)).size, 84);
  for (const stratum of TEXTURE_STRATA) {
    const b = m.boards.filter(b => b.stratum === stratum);
    assert.equal(b.filter(x => x.role === "legacy").length, 1);
    assert.equal(b.filter(x => x.role === "calibration").length, 3);
    assert.equal(b.filter(x => x.role === "holdout").length, 3);
  }
  assert.equal(m.roots.length, 504); assert.equal(new Set(m.roots.map(r => r.spotHash)).size, 504);
  for (const root of m.roots) {
    const spot = corpusSpot(root, m); assert.equal(spot.ranges[0].combos.length, 1176); assert.equal(spot.ranges[1].combos.length, 1176);
    assert.equal(root.removedCombosPerPlayer, 150); assert.equal(spot.rake, 0); assert.equal(spot.solve.compression, "off");
    assert.equal(spot.solve.targetExploitabilityPctPot, 0.001);
    const pair = root.potType === "srp" ? [550, 9750] : root.potType === "3bp" ? [2250, 8900] : [4850, 7600];
    assert.deepEqual([spot.startingPot, spot.effectiveStack], pair);
    assert.ok(spot.ranges.every(r => r.combos.every(c => !spot.board.flop.some(b => c.combo.includes(b)))));
  }
  const changed = { ...saved, roots: saved.roots.map((r, i) => i === 0 ? { ...r, spotHash: "0".repeat(64) } : r) };
  assert.throws(() => verifyManifest(changed), /manifest|hash/);
  const badDraw = structuredClone(transcript); badDraw.strata[0].draws[0] = 100000;
  assert.throws(() => buildManifest(badDraw), /draw/);
});
