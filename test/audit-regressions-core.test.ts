// Regression tests for two audited money/legality bugs in the core trainer engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateTrainerHand } from "../src/lib/poker/trainer-hand";
import { distributePots } from "../src/lib/poker/pots";
import { generateFullDecision } from "../src/lib/poker/decide";
import { runBettingRound } from "../src/lib/poker/engine";
import type { Decision, PlayerInfo } from "../src/lib/poker/types";
import { cards } from "./helpers";

const players: PlayerInfo[] = [
  { name: "BTN", pos: "Dealer", posShort: "BTN" },
  { name: "SB", pos: "Small Blind", posShort: "SB" },
  { name: "BB", pos: "Big Blind", posShort: "BB" },
  { name: "UTG", pos: "UTG", posShort: "UTG" },
];

// Bug 1: a fold-win paid the whole pot to the survivor, including blind chips the
// survivor never matched. BB is all-in for 3, SB posted 5, everyone folds to BB.
test("fold-win to a short all-in BB returns the SB's unmatched blind chips", () => {
  const start = [200, 200, 3, 200];
  const stages = calculateTrainerHand({
    gs: {
      hands: [cards("7c", "2d"), cards("7h", "2s"), cards("3c", "8d"), cards("7d", "2c")],
      board: cards("Ks", "Qs", "Js", "4h", "9d"),
      seed: 1,
      style: "gto",
    },
    dealerIdx: 0, startingStacks: start, players, heroIdx: null, heroChoices: [],
  });
  const last = stages[stages.length - 1];
  assert.equal(last.type, "showdown");
  assert.equal(last.foldWin, true);
  assert.equal(last.winner, 2);
  const delta = last.stacks!.map((s, i) => s - start[i]);
  assert.deepEqual(delta, [0, -3, 3, 0], "BB wins only the 3 it matched; SB gets 2 back");
  assert.deepEqual(last.payouts, [0, 2, 6, 0], "payouts reflect the refund and the won pot");
  assert.equal(delta.reduce((a, b) => a + b, 0), 0, "chips are conserved");
});

test("distributePots returns a folded seat's uncalled excess instead of awarding it", () => {
  const hands = [cards("7c", "2d"), cards("7h", "2s"), cards("3c", "8d"), cards("7d", "2c")];
  const { payouts, pots } = distributePots([0, 5, 3, 0], [true, true, false, true], hands, cards("Ks", "Qs", "Js", "4h", "9d"));
  assert.deepEqual(payouts, [0, 2, 6, 0]);
  const top = pots[pots.length - 1];
  assert.deepEqual(top.contributors, [1]);
  assert.deepEqual(top.awards, [{ idx: 1, amount: 2 }]);
});

// Bug 2: snapToBB used Math.round, so a value raise to the 114 minimum became 110,
// and the engine silently converted the illegal raise into a call.
test("AI value raise is never snapped below the legal minimum raise-to", () => {
  const d = generateFullDecision(
    1, cards("As", "Ks"), cards("Qs", "Js", "Ts", "2h", "3d"),
    20, 57, 0, "river", false, "P1", "UTG", 1000, 2, "gto", 0, 1, 114, true,
  );
  assert.equal(d.action, "raise");
  assert.ok((d.amount ?? 0) >= 114, `raise target ${d.amount} is below minRaiseTo 114`);
  assert.ok((d.amount ?? 0) <= 1000);
});

test("engine keeps a legal AI raise as a raise after a short all-in bet", () => {
  const D = (action: string, amount?: number): Decision => ({ action, amount, dialogue: "", reasoning: "", thoughts: [], math: [] });
  const three = players.slice(0, 3);
  let seen: Decision | undefined;
  const r = runBettingRound({
    order: [0, 1, 2], hands: [cards("2c", "3d"), cards("As", "Ks"), cards("4c", "5d")],
    board: cards("Qs", "Js", "Ts", "2h", "3d"), street: "river", players: three,
    pot: 20, contributions: [7, 7, 6], folded: [false, false, false], stacks: [57, 1000, 1000],
    bets: [0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
    heroIdx: null, heroChoices: [], heroActionStart: 0,
    decide: a => {
      if (a.pi === 0) return D("bet", 57);
      if (a.pi === 1 && !seen) {
        seen = generateFullDecision(1, cards("As", "Ks"), cards("Qs", "Js", "Ts", "2h", "3d"), a.pot, a.currentBet, a.playerBet, "river", false, "P1", "UTG", a.stack, a.numActive, "gto", 0, 1, a.minRaiseTo, a.canRaise, a.callQuote);
        return seen;
      }
      return D("call");
    },
  });
  const p1 = r.stages.find(s => s.playerIdx === 1)!;
  assert.equal(p1.decision!.action, "raise", `expected raise, got ${p1.decision!.action}: ${p1.decision!.reasoning}`);
  assert.ok(p1.decision!.amount! >= p1.minRaiseTo!);
});
