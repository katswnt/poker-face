import { test } from "node:test";
import assert from "node:assert/strict";
import { legalActionsForState, postBlinds, quoteCall, quoteCurrentPots, runBettingRound, type DecideArgs } from "../src/lib/poker/engine";
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
    pot: 40, contributions: [10, 10, 10, 10], folded: [false, false, false, false], stacks: [100, 100, 100, 100],
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
    pot: 40, contributions: [10, 10, 10, 10], folded: [false, false, false, false], stacks: [100, 100, 100, 100],
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
    pot: 40, contributions: [10, 10, 10, 10], folded: [false, false, false, false], stacks: [100, 100, 100, 100],
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
    pot: 40, contributions: [20, 20, 0, 0], folded: [false, false, true, true], stacks: [100, 30, 0, 0],
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
    pot: 15, contributions: [0, 0, 5, 10], folded: [false, false, false, false], stacks: [100, 95, 90, 100],
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
    pot: 40, contributions: [20, 20, 0, 0], folded: [false, false, true, true], stacks: [100, 100, 0, 0],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    decide: scripted({ 1: D("bet", 20), 2: D("call") }),
  });
  assert.equal(r.raiseCount, 0, "postflop bets do not feed a preflop-style raise counter");
});

test("short blinds post only the chips available and never make a stack negative", () => {
  const r = postBlinds([200, 4, 5, 200], 1, 2, 5, 10);
  assert.deepEqual(r.stacks, [200, 0, 0, 200]);
  assert.deepEqual(r.bets, [0, 4, 5, 0]);
  assert.deepEqual(r.contributions, [0, 4, 5, 0]);
  assert.equal(r.pot, 9);
  assert.equal(r.currentBet, 10, "the nominal preflop bring-in remains one full big blind");
  assert.equal(r.stacks.reduce((a, b) => a + b, 0) + r.pot, 409, "posting conserves chips");
});

test("a short all-in is priced only against chips the caller can win", () => {
  const quote = quoteCall({
    playerIdx: 0,
    currentBet: 100,
    playerBet: 40,
    stack: 20,
    contributions: [40, 100, 30],
    folded: [false, false, true],
  });

  assert.equal(quote.callCost, 20, "the caller can pay only the 20 chips left");
  assert.equal(quote.contestablePot, 150, "the opponent's unmatched 40-chip excess is excluded");
  assert.equal(quote.requiredEquity, 20 / 150);
  assert.equal(quote.allIn, true);
  assert.deepEqual(quote.layers.map(layer => layer.amount), [90, 60]);
});

test("current pot quote keeps main and side-pot fields separate", () => {
  const quote = quoteCurrentPots(0, [100, 100, 50], [false, false, false]);

  assert.equal(quote.callCost, 0);
  assert.equal(quote.contestablePot, 250);
  assert.deepEqual(quote.layers.map(layer => ({ amount: layer.amount, opponents: layer.eligibleOpponents })), [
    { amount: 150, opponents: [1, 2] },
    { amount: 100, opponents: [1] },
  ]);
});

test("current pot quote excludes the player's own uncalled excess", () => {
  const quote = quoteCurrentPots(0, [140, 100, 50], [false, false, false]);

  assert.equal(quote.contestablePot, 250);
  assert.deepEqual(quote.layers.map(layer => layer.amount), [150, 100]);
});

test("an undersized non-all-in raise is normalized to a call", () => {
  const r = runBettingRound({
    ...base, order: [0, 1], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 0, contributions: [0, 0, 0, 0], folded: [false, false, true, true], stacks: [300, 300, 0, 0],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    decide: scripted({ 0: D("bet", 100), 1: D("raise", 110) }),
  });

  assert.equal(r.currentBet, 100, "raise to 110 is illegal after a 100-chip bet");
  assert.deepEqual(r.bets, [100, 100, 0, 0]);
  assert.equal(r.stages[1].decision?.action, "call");
  assert.equal(r.stages[1].appliedAction?.requested.action, "raise");
});

test("a short all-in raise changes the price without reopening prior raise rights", () => {
  const actions = new Map<number, number>();
  const decide = ({ pi }: DecideArgs): Decision => {
    const count = actions.get(pi) ?? 0;
    actions.set(pi, count + 1);
    if (pi === 0) return count === 0 ? D("bet", 100) : D("raise", 200);
    if (pi === 1) return D("call");
    return D("raise", 110);
  };
  const r = runBettingRound({
    ...base, order: [0, 1, 2], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 0, contributions: [0, 0, 0, 0], folded: [false, false, false, true], stacks: [300, 300, 110, 0],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false, decide,
  });

  assert.equal(r.currentBet, 110);
  assert.deepEqual(r.bets, [110, 110, 110, 0]);
  const seat0SecondAction = r.stages.filter(s => s.playerIdx === 0)[1];
  assert.equal(seat0SecondAction.decision?.action, "call", "seat 0 may call the extra 10 but not reraise");
  assert.equal(seat0SecondAction.canRaise, false);
});

test("an all-in raise target includes chips already committed this street", () => {
  const r = runBettingRound({
    ...base, order: [0, 1], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 180, contributions: [50, 130, 0, 0], folded: [false, false, true, true], stacks: [150, 100, 0, 0],
    bets: [50, 130, 0, 0], currentBet: 130, raiseCount: 0, countRaises: false,
    lastFullRaiseSize: 80,
    decide: scripted({ 0: D("raise", 500), 1: D("call") }),
  });

  assert.equal(r.bets[0], 200, "50 committed + 150 behind gives a 200 total all-in target");
  assert.equal(r.stacks[0], 0);
  assert.equal(r.stages[0].decision?.amount, 200);
});

test("a short all-in opening bet can be completed to the table minimum", () => {
  const r = runBettingRound({
    ...base, order: [0, 1, 2], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 0, contributions: [0, 0, 0, 0], folded: [false, false, false, true], stacks: [5, 100, 100, 0],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    decide: scripted({ 0: D("bet", 5), 1: D("bet", 10), 2: D("call") }),
  });

  assert.equal(r.currentBet, 10);
  assert.deepEqual(r.bets, [5, 10, 10, 0]);
  assert.equal(r.stages[1].minRaiseTo, 10);
  assert.equal(r.stages[1].appliedAction?.fullRaise, true);
});

test("legal actions distinguish an opening bet from a raise after the blind", () => {
  const unopened = legalActionsForState({ currentBet: 0, playerBet: 0, stack: 100, raiseRightsOpen: true, opponentCanRespond: true });
  assert.deepEqual(unopened, { fold: false, check: true, call: false, bet: true, raise: false });

  const bigBlindOption = legalActionsForState({ currentBet: 10, playerBet: 10, stack: 90, raiseRightsOpen: true, opponentCanRespond: true });
  assert.deepEqual(bigBlindOption, { fold: false, check: true, call: false, bet: false, raise: true });
});

test("a fresh street has no betting when no opponent has chips to respond", () => {
  let decisions = 0;
  const r = runBettingRound({
    ...base, order: [0, 1], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 200, contributions: [100, 100, 0, 0], folded: [false, false, true, true], stacks: [100, 0, 0, 0],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    decide: () => { decisions++; return D("bet", 50); },
  });

  assert.equal(decisions, 0);
  assert.equal(r.stages.length, 0);
  assert.equal(r.pot, 200);
  assert.deepEqual(r.stacks, [100, 0, 0, 0]);
});

test("a sole live stack may answer an outstanding all-in but cannot raise it", () => {
  const r = runBettingRound({
    ...base, order: [0, 1], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 50, contributions: [0, 50, 0, 0], folded: [false, false, true, true], stacks: [100, 0, 0, 0],
    bets: [0, 50, 0, 0], currentBet: 50, raiseCount: 0, countRaises: false,
    decide: scripted({ 0: D("raise", 100) }),
  });

  assert.equal(r.stages.length, 1);
  assert.deepEqual(r.stages[0].legalActions, { fold: true, check: false, call: true, bet: false, raise: false });
  assert.equal(r.stages[0].decision?.action, "call");
  assert.equal(r.stages[0].appliedAction?.chipsAdded, 50);
});

test("cumulative short all-ins totaling a full raise reopen the original bettor", () => {
  const actions = new Map<number, number>();
  const decide = ({ pi }: DecideArgs): Decision => {
    const count = actions.get(pi) ?? 0;
    actions.set(pi, count + 1);
    if (pi === 0) return count === 0 ? D("bet", 100) : D("raise", 300);
    if (pi === 1) return D("raise", 125);
    if (pi === 2) return D("call");
    return D("raise", 200);
  };
  const r = runBettingRound({
    ...base, order: [0, 1, 2, 3], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 0, contributions: [0, 0, 0, 0], folded: [false, false, false, false], stacks: [500, 125, 500, 200],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false, decide,
  });

  const seat0SecondAction = r.stages.filter(stage => stage.playerIdx === 0)[1];
  assert.equal(seat0SecondAction.currentBet, 200);
  assert.equal(seat0SecondAction.canRaise, true);
  assert.equal(seat0SecondAction.decision?.action, "raise");
  assert.equal(seat0SecondAction.decision?.amount, 300);
});

test("a caller facing less than a cumulative full raise still cannot reraise", () => {
  const actions = new Map<number, number>();
  const decide = ({ pi }: DecideArgs): Decision => {
    const count = actions.get(pi) ?? 0;
    actions.set(pi, count + 1);
    if (pi === 0) return count === 0 ? D("bet", 100) : D("call");
    if (pi === 1) return D("raise", 125);
    if (pi === 2) return count === 0 ? D("call") : D("raise", 300);
    return D("raise", 200);
  };
  const r = runBettingRound({
    ...base, order: [0, 1, 2, 3], board: cards("2h", "7d", "9c"), street: "flop",
    pot: 0, contributions: [0, 0, 0, 0], folded: [false, false, false, false], stacks: [500, 125, 500, 200],
    bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false, decide,
  });

  const seat2SecondAction = r.stages.filter(stage => stage.playerIdx === 2)[1];
  assert.equal(seat2SecondAction.currentBet, 200);
  assert.equal(seat2SecondAction.canRaise, false, "seat 2 acted at 125 and now faces only 75 more");
  assert.equal(seat2SecondAction.decision?.action, "call");
});
