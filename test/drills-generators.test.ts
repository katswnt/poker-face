// Every drill answer is re-derived here by a computation that does not share code with the
// generator: EV-indifference identities for the price drills, explicit enumeration of run-outs
// for outs → equity, the repo's own hand evaluator for outs counting, and enumeration of every
// remaining two-card hand for combo counting.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { makeDeck, cv, ck } from "../src/lib/poker/cards";
import { bestHand, getCombos } from "../src/lib/poker/eval";
import type { CardObj } from "../src/lib/poker/types";
import {
  CALL_OR_FOLD_MARGIN, DRILL_SOURCES, DRILL_TYPES, PERCENT_TOLERANCE, SPEED_TARGET_MS,
  callEv, generateQuestion, hitProbability, minimumDefense, requiredEquity,
} from "../src/lib/drills/generators";
import { fmtPct } from "../src/lib/drills/format";
import type { ComboKind } from "../src/lib/drills/generators";
import { LEVELS, type Level, type Question } from "../src/lib/drills/types";

const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 1);
const each = (type: Parameters<typeof generateQuestion>[0], fn: (q: Question) => void, seeds = SEEDS) => {
  for (const level of LEVELS) for (const seed of seeds) fn(generateQuestion(type, seed, level));
};
const close = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const num = (q: Question, key: string) => q.params[key] as number;
/** Numeric exact answer (percent or integer questions). */
const exact = (q: Question): number => {
  assert.notEqual(q.answer.kind, "choice");
  return q.answer.value as number;
};

// ---------------------------------------------------------------------------------------------
// Price drills

test("pot odds: at the answer, calling is exactly break-even", () => {
  each("pot-odds", q => {
    const pot = num(q, "pot"), bet = num(q, "bet");
    assert.equal(q.answer.kind, "percent");
    const e = exact(q) / 100;
    // Win the pot before the call (pot + bet) with probability e, lose the call otherwise.
    close(e * (pot + bet) - (1 - e) * bet, 0, q.id);
    // The spec's form: call / (pot before call + call).
    close(q.answer.value, (bet / ((pot + bet) + bet)) * 100, q.id);
    assert.equal(q.explanation.result, fmtPct(q.answer.value));
  });
});

test("MDF: at the answer, a pure bluff breaks even", () => {
  each("mdf", q => {
    const pot = num(q, "pot"), bet = num(q, "bet");
    const defend = exact(q) / 100;
    // Bluff wins the pot when you fold, loses the bet when you continue.
    close((1 - defend) * pot - defend * bet, 0, q.id);
  });
});

test("bluff share: at the answer, a bluff-catcher is indifferent", () => {
  each("bluff-share", q => {
    const pot = num(q, "pot"), bet = num(q, "bet");
    const bluffs = exact(q) / 100;
    // Calling wins pot + bet against bluffs and loses bet against value.
    close(bluffs * (pot + bet) - (1 - bluffs) * bet, 0, q.id);
  });
});

test("price identities hold for arbitrary pot and bet sizes (property)", () => {
  fc.assert(fc.property(
    fc.double({ min: 0.5, max: 10_000, noNaN: true }),
    fc.double({ min: 0.5, max: 10_000, noNaN: true }),
    (pot, bet) => {
      const req = requiredEquity(pot, bet), mdf = minimumDefense(pot, bet);
      assert.ok(req > 0 && req < 50, "required equity is below 50% for any finite bet");
      assert.ok(mdf > 0 && mdf < 100);
      assert.ok(Math.abs(callEv(pot, bet, req)) < 1e-6 * (pot + bet));
      // Bigger bets demand more equity and less defence.
      assert.ok(requiredEquity(pot, bet * 1.1) > req);
      assert.ok(minimumDefense(pot, bet * 1.1) < mdf);
    },
  ));
});

test("level 1 uses round pots and standard fractions; levels 2–3 use half-bb steps", () => {
  const fractions = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];
  for (const type of ["pot-odds", "mdf", "bluff-share", "call-or-fold"] as const) {
    for (const seed of SEEDS) {
      const q1 = generateQuestion(type, seed, 1);
      const pot1 = num(q1, "pot"), bet1 = num(q1, "bet");
      assert.ok([12, 24, 36, 48, 60, 120].includes(pot1), `${q1.id} pot ${pot1}`);
      assert.ok(Number.isInteger(bet1), `${q1.id} bet ${bet1}`);
      assert.ok(fractions.some(f => Math.abs(bet1 / pot1 - f) < 1e-12), `${q1.id} fraction`);
      for (const level of [2, 3] as const) {
        const q = generateQuestion(type, seed, level);
        const pot = num(q, "pot"), bet = num(q, "bet");
        assert.ok(Number.isInteger(pot * 2) && Number.isInteger(bet * 2), q.id);
        assert.ok(bet >= 0.5 && pot >= 3, q.id);
        assert.ok(level === 2 ? pot <= 60 && bet <= pot * 1.5 + 0.25 : pot <= 150 && bet <= pot * 2.5 + 0.25, q.id);
      }
    }
  }
});

test("call or fold: the answer matches the sign of the call's EV, never near the edge", () => {
  each("call-or-fold", q => {
    const pot = num(q, "pot"), bet = num(q, "bet"), equity = num(q, "equity");
    assert.equal(q.answer.kind, "choice");
    assert.ok(Number.isInteger(equity) && equity >= 1 && equity <= 99, q.id);
    // Independent EV: final pot pot + 2·bet, cost bet.
    const ev = (equity / 100) * (pot + 2 * bet) - bet;
    assert.equal(q.answer.value, ev > 0 ? "call" : "fold", q.id);
    const required = (bet / (pot + 2 * bet)) * 100;
    assert.ok(Math.abs(equity - required) >= CALL_OR_FOLD_MARGIN, `${q.id} margin`);
  });
});

// ---------------------------------------------------------------------------------------------
// Outs → equity, by enumeration

function enumerateHit(outs: number, unseen: number, cardsToCome: 1 | 2): number {
  const cards = Array.from({ length: unseen }, (_, i) => i < outs);
  if (cardsToCome === 1) return (cards.filter(Boolean).length / unseen) * 100;
  let hit = 0, total = 0;
  for (let i = 0; i < unseen; i++) for (let j = i + 1; j < unseen; j++) {
    total++;
    if (cards[i] || cards[j]) hit++;
  }
  return (hit / total) * 100;
}

test("outs to equity: exact answer equals enumeration of every run-out", () => {
  each("outs-equity", q => {
    const outs = num(q, "outs"), unseen = num(q, "unseen"), k = num(q, "cardsToCome") as 1 | 2;
    close(exact(q), enumerateHit(outs, unseen, k), q.id);
    assert.ok(unseen === 47 || (unseen === 46 && k === 1), q.id);
    assert.equal(q.explanation.shortcutApproximate, true);
    assert.match(q.explanation.shortcut, /approximate/);
  });
  // Known values.
  close(hitProbability(9, 47, 2), (1 - (38 * 37) / (47 * 46)) * 100, "9 outs flop");
  assert.equal(hitProbability(9, 47, 2).toFixed(1), "35.0");
  assert.equal(hitProbability(8, 46, 1).toFixed(1), "17.4");
});

test("outs to equity: level ranges", () => {
  for (const seed of SEEDS) {
    assert.ok([4, 8, 9].includes(num(generateQuestion("outs-equity", seed, 1), "outs")));
    const o2 = num(generateQuestion("outs-equity", seed, 2), "outs");
    assert.ok(o2 >= 2 && o2 <= 15);
    const o3 = num(generateQuestion("outs-equity", seed, 3), "outs");
    assert.ok(o3 >= 2 && o3 <= 21);
  }
});

// ---------------------------------------------------------------------------------------------
// Outs counting, checked with the repo's hand evaluator

test("outs count: equals turn cards whose best hand is a straight or better (evaluator)", () => {
  const ranges: Record<Level, [number, number]> = { 1: [8, 9], 2: [4, 11], 3: [12, 21] };
  each("outs-count", q => {
    const hole = q.params.hole as CardObj[];
    const flop = q.params.flop as CardObj[];
    const seen = new Set([...hole, ...flop].map(ck));
    assert.equal(seen.size, 5, "five distinct cards");
    assert.ok(bestHand(hole, flop).rank < 4, `${q.id} already has a straight or better`);
    const unseen = makeDeck().filter(c => !seen.has(ck(c)));
    assert.equal(unseen.length, 47);
    const outs = unseen.filter(c => bestHand(hole, [...flop, c]).rank >= 4).length;
    assert.equal(q.answer.kind, "integer");
    assert.equal(q.answer.value, outs, q.id);
    const [lo, hi] = ranges[q.level];
    assert.ok(outs >= lo && outs <= hi, `${q.id} outs ${outs} in level range`);
  }, SEEDS.slice(0, 25));
});

// ---------------------------------------------------------------------------------------------
// Combo counting, by enumerating every remaining two-card hand

function enumerateCombos(kind: ComboKind, a: number, b: number, dead: CardObj[], board: CardObj[]): number {
  const deadKeys = new Set(dead.map(ck));
  const live = makeDeck().filter(c => !deadKeys.has(ck(c)));
  const boardRanks = new Set(board.map(cv));
  return getCombos(live, 2).filter(([x, y]) => {
    const rx = cv(x), ry = cv(y);
    const isAB = (rx === a && ry === b) || (rx === b && ry === a);
    switch (kind) {
      case "pair": return rx === a && ry === a;
      case "any": return isAB;
      case "suited": return isAB && x.suit === y.suit;
      case "offsuit": return isAB && x.suit !== y.suit;
      case "sets": return rx === ry && boardRanks.has(rx);
      case "either": return rx === a || ry === a || rx === b || ry === b;
    }
  }).length;
}

test("combos: every answer equals enumeration over the remaining deck", () => {
  const kinds = new Set<string>();
  each("combos", q => {
    const { kind, a, b } = q.params as { kind: ComboKind; a: number; b: number };
    const hole = (q.params.hole as CardObj[]) ?? [];
    const board = q.params.board as CardObj[];
    kinds.add(kind);
    assert.equal(q.answer.value, enumerateCombos(kind, a, b, [...hole, ...board], board), q.id);
    assert.equal(hole.length > 0, q.level === 3, `${q.id}: hero cards only at level 3`);
    if (q.level === 1) assert.equal(board.length, 3);
  }, Array.from({ length: 150 }, (_, i) => i * 104729 + 3));
  for (const k of ["pair", "any", "suited", "offsuit", "sets", "either"]) assert.ok(kinds.has(k), `kind ${k} generated`);
});

test("combos: textbook values", () => {
  // Hand-checked anchors through the same enumeration helper.
  const k = { rank: "K", suit: "♠" }, seven = { rank: "7", suit: "♦" }, two = { rank: "2", suit: "♣" };
  const board = [k, seven, two];
  assert.equal(enumerateCombos("pair", 13, 0, board, board), 3);
  assert.equal(enumerateCombos("any", 14, 13, board, board), 12);
  assert.equal(enumerateCombos("suited", 14, 13, board, board), 3);
  assert.equal(enumerateCombos("sets", 0, 0, board, board), 9);
  // Contains an ace or a king on K72: |A| + |K| − |A∩K| = (C(49,2) − C(45,2)) + (C(49,2) − C(46,2)) − 12.
  assert.equal(enumerateCombos("either", 14, 13, board, board), (1176 - 990) + (1176 - 1035) - 12);
});

// ---------------------------------------------------------------------------------------------
// Determinism and shape

test("generation is deterministic in (type, seed, level)", () => {
  for (const type of DRILL_TYPES) for (const level of LEVELS) for (const seed of [0, 1, 42, 0xffffffff]) {
    assert.deepEqual(generateQuestion(type, seed, level), generateQuestion(type, seed, level));
    assert.equal(generateQuestion(type, seed, level).id, `${type}:${level}:${seed}`);
  }
});

test("different seeds give varied questions", () => {
  for (const type of DRILL_TYPES) {
    const prompts = new Set(SEEDS.map(s => JSON.stringify(generateQuestion(type, s, 2).facts)));
    assert.ok(prompts.size >= 20, `${type}: ${prompts.size} distinct`);
  }
});

test("every question has a complete explanation, a speed target and a sane answer", () => {
  for (const type of DRILL_TYPES) {
    assert.equal(DRILL_SOURCES[type].type, type);
    each(type, q => {
      for (const field of ["formula", "plugged", "result", "shortcut"] as const) {
        assert.ok(q.explanation[field].length > 0, `${q.id} ${field}`);
      }
      assert.ok(q.speedTargetMs >= SPEED_TARGET_MS[type], q.id);
      assert.equal(q.answer.kind, DRILL_SOURCES[type].answerKind);
      if (q.answer.kind === "percent") {
        assert.ok(q.answer.value > 0 && q.answer.value < 100, q.id);
        assert.equal(q.answer.tolerance, PERCENT_TOLERANCE[type as keyof typeof PERCENT_TOLERANCE]);
      }
      if (q.answer.kind === "integer") assert.ok(Number.isInteger(q.answer.value) && q.answer.value >= 0, q.id);
      assert.ok(!/NaN|undefined|Infinity/.test(JSON.stringify([q.prompt, q.facts, q.explanation])), q.id);
    }, SEEDS.slice(0, 20));
  }
});
