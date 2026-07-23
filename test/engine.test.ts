import { test } from "node:test";
import assert from "node:assert/strict";
import { runBettingRound, type DecideArgs } from "../src/lib/poker/engine";
import type { Decision, PlayerInfo } from "../src/lib/poker/types";
import { cards } from "./helpers";

const players: PlayerInfo[] = [
  { name: "Alice", pos: "Dealer", posShort: "BTN" },
  { name: "Bob", pos: "Small Blind", posShort: "SB" },
  { name: "Carol", pos: "Big Blind", posShort: "BB" },
  { name: "Dan", pos: "UTG", posShort: "UTG" },
];
const hands = [cards("As", "Ah"), cards("Ks", "Kh"), cards("Qs", "Qh"), cards("Js", "Jh")];
const D = (action: string, amount?: number): Decision => ({ action, amount, dialogue: "", reasoning: "", thoughts: [], math: [] });

// Build a `decide` that plays a scripted action per seat (by pi), defaulting to fold.
const scripted = (bySeat: Record<number, Decision>) => (a: DecideArgs) => bySeat[a.pi] ?? D("fold");

const base = {
  hands, players, heroIdx: null, heroChoices: [] as Decision[], heroActionStart: 0,
};

test("postflop: everyone checks → no chips move, one stage per active seat", () => {
  const r = runBettingRound({
    ...base, order: [1, 2, 3, 0], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 40, folded: [false, false, false, false], stacks: [100, 100, 100, 100],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    decide: scripted({ 0: D("check"), 1: D("check"), 2: D("check"), 3: D("check") }),
  });
  assert.equal(r.pot, 40, "checks don't change the pot");
  assert.deepEqual(r.stacks, [100, 100, 100, 100]);
  assert.equal(r.stages.length, 4);
});

test("postflop: a bet re-opens action and everyone must respond", () => {
  const r = runBettingRound({
    ...base, order: [1, 2, 3, 0], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 40, folded: [false, false, false, false], stacks: [100, 100, 100, 100],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    // Seat 1 bets 20; the rest call.
    decide: scripted({ 1: D("bet", 20), 2: D("call"), 3: D("call"), 0: D("call") }),
  });
  assert.equal(r.pot, 40 + 80, "20 from each of 4 seats added to the pot");
  assert.deepEqual(r.stacks, [80, 80, 80, 80]);
});

test("fold removes a seat from contention", () => {
  const r = runBettingRound({
    ...base, order: [1, 2, 3, 0], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 40, folded: [false, false, false, false], stacks: [100, 100, 100, 100],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    decide: scripted({ 1: D("bet", 20), 2: D("fold"), 3: D("call"), 0: D("fold") }),
  });
  assert.equal(r.folded[2], true);
  assert.equal(r.folded[0], true);
  assert.equal(r.pot, 40 + 40, "only seats 1 and 3 put in 20 each");
});

test("a bet larger than the stack is capped at all-in", () => {
  const r = runBettingRound({
    ...base, order: [0, 1], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 40, folded: [false, false, true, true], stacks: [100, 30, 0, 0],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    // Seat 0 (deep) shoves 500 → capped to its 100; seat 1 (short) calls what it can (30).
    decide: scripted({ 0: D("bet", 500), 1: D("call") }),
  });
  assert.equal(r.stacks[0], 0, "deep seat is all-in for 100");
  assert.equal(r.stacks[1], 0, "short seat is all-in for 30");
  assert.equal(r.pot, 40 + 100 + 30);
});

test("preflop: blinds carry in, raise counter advances, hero-index accounting", () => {
  const heroChoices = [D("raise", 25)]; // hero (seat 3, UTG) 3-bets... here just raises
  const r = runBettingRound({
    ...base, heroIdx: 3, heroChoices,
    order: [3, 0, 1, 2], board: [], street: "preflop",
    pot: 15, folded: [false, false, false, false], stacks: [100, 95, 90, 100],
    bets: [0, 0, 5, 10], currentBet: 10, raiseCount: 0, countRaises: true,
    // AI would fold everyone; hero's scripted raise is injected for seat 3.
    decide: scripted({ 0: D("fold"), 1: D("fold"), 2: D("fold") }),
  });
  assert.equal(r.heroActionsConsumed, 1, "hero acted exactly once");
  assert.ok(r.raiseCount >= 1, "the hero's raise advanced the raise counter");
  assert.equal(r.currentBet, 25, "current bet reflects the hero's raise");
});

test("raiseCount stays put postflop (countRaises=false)", () => {
  const r = runBettingRound({
    ...base, order: [1, 2], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 40, folded: [false, false, true, true], stacks: [100, 100, 0, 0],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    decide: scripted({ 1: D("bet", 20), 2: D("call") }),
  });
  assert.equal(r.raiseCount, 0, "postflop bets do not feed a preflop-style raise counter");
});
