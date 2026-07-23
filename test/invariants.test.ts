// Property / fuzz tests: invariants that must hold for ALL inputs.
//
// Unlike the example-based tests elsewhere in test/, these use fast-check to generate
// thousands of random-but-VALID poker scenarios (distinct cards dealt from one 52-card
// deck) and assert structural invariants the engine can never violate — chip conservation
// above all. A failing property here prints a concrete counterexample; if that
// counterexample is a real library bug it is reported, NOT hacked around.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { evalHand, bestHand, handScore, cmpK } from "../src/lib/poker/eval";
import { distributePots } from "../src/lib/poker/pots";
import { runBettingRound, type DecideArgs } from "../src/lib/poker/engine";
import { mulberry32 } from "../src/lib/poker/equity";
import type { CardObj, Decision, PlayerInfo } from "../src/lib/poker/types";
import { deckStrings, card } from "./helpers";

// The full 52-card deck as CardObj[], indexed 0..51.
const DECK: CardObj[] = deckStrings().map(card);

// Arbitrary that deals exactly `k` DISTINCT cards from the deck (no duplicates possible,
// since we draw k unique indices in [0,51]). This is the backbone of every scenario below:
// it guarantees the generated inputs are legal deals, never a card appearing twice.
const deal = (k: number) =>
  fc.uniqueArray(fc.nat({ max: 51 }), { minLength: k, maxLength: k }).map(idxs => idxs.map(i => DECK[i]));

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

// ── 1. Evaluator invariants ─────────────────────────────────────────────────────────────

test("evalHand.rank is always in [0,9] for any random 5-card hand", () => {
  fc.assert(
    fc.property(deal(5), (hand) => {
      const r = evalHand(hand).rank;
      assert.ok(Number.isInteger(r) && r >= 0 && r <= 9, `rank out of range: ${r}`);
    }),
    { numRuns: 500 },
  );
});

test("bestHand never throws and rank ∈ [0,9] for any random 7-card holding", () => {
  fc.assert(
    fc.property(deal(7), (seven) => {
      const hole = seven.slice(0, 2);
      const board = seven.slice(2, 7);
      const best = bestHand(hole, board); // must not throw
      assert.ok(best.rank >= 0 && best.rank <= 9, `rank out of range: ${best.rank}`);
      assert.ok(Array.isArray(best.kickers));
    }),
    { numRuns: 500 },
  );
});

test("evalHand ordering === handScore ordering for any two holdings on a shared board", () => {
  // The two evaluators derive from one core; this reinforces the existing example sweep
  // with fast-check-generated inputs. They must induce the SAME strict ordering.
  fc.assert(
    fc.property(deal(9), (nine) => {
      const board = nine.slice(0, 5);
      const holeA = nine.slice(5, 7);
      const holeB = nine.slice(7, 9);
      const a = bestHand(holeA, board);
      const b = bestHand(holeB, board);
      const evalCmp = a.rank !== b.rank ? Math.sign(a.rank - b.rank) : Math.sign(cmpK(a.kickers, b.kickers));
      const scoreCmp = Math.sign(handScore(holeA, board) - handScore(holeB, board));
      assert.equal(scoreCmp, evalCmp, `evaluators disagree on board ${board.map(c => c.rank + c.suit).join(" ")}`);
    }),
    { numRuns: 800 },
  );
});

// ── 2. distributePots CHIP CONSERVATION (the key invariant) ─────────────────────────────

// One scenario: distinct hole cards for 4 seats + a 5-card board, plus contributions and
// folded flags (guaranteed at least one live seat).
const potScenario = fc
  .tuple(
    deal(13), // 8 hole cards (4×2) + 5 board = 13 distinct cards
    fc.array(fc.nat({ max: 300 }), { minLength: 4, maxLength: 4 }),
    fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
  )
  .map(([thirteen, contributions, rawFolded]) => {
    const hands = [thirteen.slice(0, 2), thirteen.slice(2, 4), thirteen.slice(4, 6), thirteen.slice(6, 8)];
    const board = thirteen.slice(8, 13);
    // Guarantee at least one non-folded seat (a showdown needs a live player).
    const folded = rawFolded.every(x => x) ? rawFolded.map((x, i) => (i === 0 ? false : x)) : rawFolded;
    return { hands, board, contributions, folded };
  });

test("distributePots conserves chips exactly: sum(payouts) === sum(contributions)", () => {
  fc.assert(
    fc.property(potScenario, ({ hands, board, contributions, folded }) => {
      const { payouts } = distributePots(contributions, folded, hands, board);
      assert.equal(sum(payouts), sum(contributions), "chips created or destroyed");
      for (const p of payouts) assert.ok(p >= 0, `negative payout: ${p}`);
      folded.forEach((f, i) => {
        if (f) assert.equal(payouts[i], 0, `folded seat ${i} was paid ${payouts[i]}`);
      });
    }),
    { numRuns: 1000 },
  );
});

// ── 3. Side-pot eligibility ─────────────────────────────────────────────────────────────

test("no seat wins a pot layer it didn't match (short stack can't scoop a side pot)", () => {
  fc.assert(
    fc.property(potScenario, ({ hands, board, contributions, folded }) => {
      const { pots } = distributePots(contributions, folded, hands, board);
      // Recompute the layer levels exactly as distributePots does (distinct positive
      // contributions, ascending). Each level defines one non-empty pot layer, in order —
      // no layer is skipped because every level has ≥1 exact contributor (layer size ≥ 1).
      const levels = [...new Set(contributions.filter(c => c > 0))].sort((a, b) => a - b);
      assert.equal(pots.length, levels.length, "pot-layer count must match distinct contribution levels");

      pots.forEach((layer, li) => {
        const level = levels[li];
        // Players who actually matched this layer (contributed at least `level`).
        const matchers = contributions.map((c, i) => (c >= level ? i : -1)).filter(i => i >= 0);
        const anyMatcherLive = matchers.some(i => !folded[i]);
        for (const w of layer.winners) {
          if (anyMatcherLive) {
            // Normal contested layer: every winner must have matched it.
            assert.ok(
              contributions[w] >= level,
              `seat ${w} won layer ${li} (level ${level}) contributing only ${contributions[w]}`,
            );
          }
          // else: the documented fallback — every matcher folded, so the chips (dead money
          // from folded matchers) legitimately go to a remaining live seat. Correct poker.
          assert.ok(!folded[w], `folded seat ${w} listed as winner of layer ${li}`);
        }
      });
    }),
    { numRuns: 1000 },
  );
});

// ── 4. runBettingRound conservation ─────────────────────────────────────────────────────

const players: PlayerInfo[] = [
  { name: "A", pos: "BTN", posShort: "BTN" },
  { name: "B", pos: "SB", posShort: "SB" },
  { name: "C", pos: "BB", posShort: "BB" },
  { name: "D", pos: "UTG", posShort: "UTG" },
];
const dummyHands: CardObj[][] = [[], [], [], []];
const D = (action: string, amount?: number): Decision => ({ action, amount, dialogue: "", reasoning: "", thoughts: [], math: [] });

// A random scripted action for one seat: fold / check / call / bet(random amount).
const actionArb: fc.Arbitrary<Decision> = fc.oneof(
  fc.constant(D("fold")),
  fc.constant(D("check")),
  fc.constant(D("call")),
  fc.integer({ min: 1, max: 400 }).map(amt => D("bet", amt)),
);

const bettingScenario = fc
  .record({
    order: fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
    stacks: fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 4, maxLength: 4 }),
    bets: fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 4, maxLength: 4 }),
    pot: fc.integer({ min: 0, max: 200 }),
    folded: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    // One scripted decision per seat (indexed by seat).
    decisions: fc.array(actionArb, { minLength: 4, maxLength: 4 }),
  })
  .map((s) => ({
    ...s,
    // currentBet must be ≥ every posted bet so a call cost is never negative.
    currentBet: Math.max(0, ...s.bets),
  }));

test("runBettingRound conserves chips, never negatives a stack, keeps folds folded", () => {
  fc.assert(
    fc.property(bettingScenario, (s) => {
      const startTotal = sum(s.stacks) + s.pot;
      const startFolded = [...s.folded];
      const decide = (a: DecideArgs): Decision => s.decisions[a.pi];

      const r = runBettingRound({
        order: s.order,
        hands: dummyHands,
        board: [],
        street: "flop",
        players,
        pot: s.pot,
        folded: [...s.folded],
        stacks: [...s.stacks],
        bets: [...s.bets],
        currentBet: s.currentBet,
        raiseCount: 0,
        countRaises: false,
        heroIdx: null,
        heroChoices: [],
        heroActionStart: 0,
        decide,
      });

      // (a) Chip conservation: no money created or destroyed.
      assert.equal(sum(r.stacks) + r.pot, startTotal, "chips not conserved across the betting round");
      // (b) No stack goes negative.
      r.stacks.forEach((v, i) => assert.ok(v >= 0, `stack ${i} went negative: ${v}`));
      // (c) A seat that started folded stays folded (folds are monotonic).
      startFolded.forEach((wasFolded, i) => {
        if (wasFolded) assert.equal(r.folded[i], true, `folded seat ${i} became un-folded`);
      });
      // The pot never shrinks (chips only flow in during a betting round).
      assert.ok(r.pot >= s.pot, `pot decreased from ${s.pot} to ${r.pot}`);
    }),
    { numRuns: 1000 },
  );
});

// ── 5. mulberry32 PRNG ──────────────────────────────────────────────────────────────────

test("mulberry32 is deterministic per seed: same seed → identical sequence", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
      const a = mulberry32(seed);
      const b = mulberry32(seed);
      for (let i = 0; i < 50; i++) {
        const x = a();
        const y = b();
        assert.equal(x, y, `divergence at draw ${i} for seed ${seed}`);
        assert.ok(x >= 0 && x < 1, `draw out of [0,1): ${x}`);
      }
    }),
    { numRuns: 300 },
  );
});

test("mulberry32 draws are ~uniform: mean of many draws ≈ 0.5 (±0.02)", () => {
  const rng = mulberry32(0xC0FFEE);
  const N = 200_000;
  let total = 0;
  for (let i = 0; i < N; i++) total += rng();
  const mean = total / N;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `mean ${mean.toFixed(5)} not within 0.02 of 0.5`);
});
