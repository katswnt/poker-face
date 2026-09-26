// Seeded deal/draw helpers and the deterministic replay contract: same seed + same human
// actions + same decision source → same AI actions and a byte-identical hand log.
import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { parseBridgeCombo, type BridgeRange } from "../src/lib/solver/bridge/contract";
import { LEAN_SRP_TREE } from "../src/lib/solver/bridge/fixtures";
import { replayHand } from "../src/lib/hu-play/hand";
import { hashHandLog } from "../src/lib/hu-play/log-node";
import { dealFromSeed, decisionDraw, sampleAction } from "../src/lib/hu-play/rng";
import { createStubSource } from "../src/lib/hu-play/stub-source";
import { flopRanges, initialRanges, playHand, testConfig } from "./hu-play-helpers";

const choice = fc.tuple(fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }));
const handArb = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }), aiSeat: fc.constantFrom(0 as const, 1 as const),
  flopIndex: fc.nat(2), choices: fc.array(choice, { minLength: 1, maxLength: 12 }),
});

test("replaying a logged hand reproduces every AI action and the same log hash", () => {
  fc.assert(fc.property(handArb, ({ seed, aiSeat, flopIndex, choices }) => {
    const config = testConfig(seed, aiSeat, flopIndex);
    const hand = playHand(config, choices);
    const deal = dealFromSeed(seed, config.flop, flopRanges(config.flop), aiSeat);
    assert.deepEqual(deal, hand.state.deal, "the deal is a function of the seed");
    const replay = replayHand(hand.log, deal, initialRanges(config.flop, aiSeat), createStubSource({ tree: LEAN_SRP_TREE }));
    assert.ok(replay.ok, JSON.stringify(replay.divergences));
    assert.equal(hashHandLog({ ...hand.log }), hashHandLog(playHand(config, [], undefined, hand.log.humanActions).log));
  }), { numRuns: 50 });
});

test("replay reports a divergence when the log was altered", () => {
  let found = false;
  for (let seed = 1; seed < 50 && !found; seed++) {
    const config = testConfig(seed, 0, seed);
    const hand = playHand(config, [[0.5, 0.2], [0.1, 0.9]]);
    const index = hand.log.decisions.findIndex(d => d.strategy.length > 1);
    if (index < 0) continue;
    const decision = hand.log.decisions[index];
    const other = decision.strategy.find(e => JSON.stringify(e.action) !== JSON.stringify(decision.action))!.action;
    const tampered = { ...hand.log, decisions: hand.log.decisions.map((d, i) => (i === index ? { ...d, action: other } : d)) };
    const replay = replayHand(tampered, hand.state.deal, initialRanges(config.flop, 0), createStubSource({ tree: LEAN_SRP_TREE }));
    assert.equal(replay.ok, false);
    assert.equal(replay.divergences[0].index, index);
    assert.ok(["action", "boundary"].includes(replay.divergences[0].kind));
    found = true;
  }
  assert.ok(found);
});

test("u_k depends only on (seed, k, node path)", () => {
  const a = decisionDraw(42, 3, ["x", "b363", "c", "Qh"]);
  assert.equal(decisionDraw(42, 3, ["x", "b363", "c", "Qh"]), a);
  assert.notEqual(decisionDraw(43, 3, ["x", "b363", "c", "Qh"]), a);
  assert.notEqual(decisionDraw(42, 4, ["x", "b363", "c", "Qh"]), a);
  assert.notEqual(decisionDraw(42, 3, ["x", "b363", "c", "Qd"]), a);
  assert.ok(a >= 0 && a < 1);
});

test("sampleAction inverts the CDF and reports the distance to the nearest boundary", () => {
  const strategy = [{ action: { type: "check" } as const, probability: 0.25 }, { action: { type: "bet", to: 363 } as const, probability: 0.75 }];
  assert.deepEqual(sampleAction(strategy, 0.1).action, { type: "check" });
  assert.deepEqual(sampleAction(strategy, 0.25).action, { type: "bet", to: 363 });
  assert.ok(Math.abs(sampleAction(strategy, 0.2500001).boundaryDistance - 1e-7) < 1e-12);
  assert.throws(() => sampleAction(strategy, 1), /outside/);
  assert.throws(() => sampleAction([{ action: { type: "check" }, probability: 0.5 }], 0.1), /distribution/);
  // Zero-probability actions are never drawn, even at a boundary.
  const pure = [{ action: { type: "check" } as const, probability: 1 }, { action: { type: "bet", to: 5 } as const, probability: 0 }];
  assert.deepEqual(sampleAction(pure, 0.999999).action, { type: "check" });
});

test("the joint deal is ∝ w_AI(h) · w_H(g) over non-conflicting pairs", () => {
  const range = (entries: [string, number][]): BridgeRange => ({ source: "test", combos: entries.map(([combo, weight]) => ({ combo, weight })) });
  // AsKs conflicts with AsQs; so P(AI=AsKs, H=QdQc) ∝ 1 · 1, P(AI=AdAc, H=AsQs) ∝ 0.5 · 1, etc.
  const ai = range([["AsKs", 1], ["AdAc", 0.5]]), human = range([["AsQs", 1], ["QdQc", 1]]);
  const expected: Record<string, number> = { "AsKs|QdQc": 1, "AdAc|AsQs": 0.5, "AdAc|QdQc": 0.5 };
  const total = 2, counts: Record<string, number> = {};
  const trials = 6000;
  for (let seed = 0; seed < trials; seed++) {
    const deal = dealFromSeed(seed, ["2c", "3d", "4h"], [ai, human], 0);
    const cards = [...parseBridgeCombo(deal.aiHand), ...parseBridgeCombo(deal.humanHand), ...deal.runout, "2c", "3d", "4h"];
    assert.equal(new Set(cards).size, cards.length, "no card dealt twice");
    const key = `${deal.aiHand}|${deal.humanHand}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  assert.deepEqual(Object.keys(counts).sort(), Object.keys(expected).sort());
  for (const [key, weight] of Object.entries(expected)) {
    assert.ok(Math.abs(counts[key] / trials - weight / total) < 0.03, `${key}: ${counts[key] / trials}`);
  }
});
