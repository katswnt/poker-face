import { test } from "node:test";
import assert from "node:assert/strict";
import { evalHand, bestHand, handScore, scoreCards, cmpK } from "../src/lib/poker/eval";
import { cards, deckStrings, card } from "./helpers";

test("classifies every hand category", () => {
  assert.equal(evalHand(cards("As", "Ks", "Qs", "Js", "Ts")).name, "Royal Flush");
  assert.equal(evalHand(cards("9s", "8s", "7s", "6s", "5s")).name, "Straight Flush");
  assert.equal(evalHand(cards("Ac", "Ad", "Ah", "As", "Kd")).name, "Four of a Kind");
  assert.equal(evalHand(cards("Ac", "Ad", "Ah", "Kd", "Ks")).name, "Full House");
  assert.equal(evalHand(cards("As", "Js", "9s", "6s", "3s")).name, "Flush");
  assert.equal(evalHand(cards("9c", "8d", "7h", "6s", "5d")).name, "Straight");
  assert.equal(evalHand(cards("Ac", "Ad", "Ah", "Kd", "Qs")).name, "Three of a Kind");
  assert.equal(evalHand(cards("Ac", "Ad", "Kh", "Kd", "Qs")).name, "Two Pair");
  assert.equal(evalHand(cards("Ac", "Ad", "Kh", "Qd", "Js")).name, "Pair");
  assert.equal(evalHand(cards("Ac", "Jd", "9h", "6d", "3s")).name, "High Card");
});

test("wheel (A-2-3-4-5) is the lowest straight, ranked below 6-high", () => {
  const wheel = evalHand(cards("As", "2d", "3c", "4h", "5s"));
  const sixHigh = evalHand(cards("2s", "3d", "4c", "5h", "6s"));
  assert.equal(wheel.name, "Straight");
  assert.equal(sixHigh.name, "Straight");
  // Wheel's top card is 5, six-high's is 6 → six-high wins.
  assert.ok(cmpK(sixHigh.kickers, wheel.kickers) > 0);
  assert.ok(scoreCards(cards("2s", "3d", "4c", "5h", "6s")) > scoreCards(cards("As", "2d", "3c", "4h", "5s")));
});

test("kickers break ties within a category", () => {
  const aceKing = evalHand(cards("Ac", "Ad", "Kh", "Qd", "Js"));
  const aceQueen = evalHand(cards("Ac", "Ad", "Qh", "Jd", "9s"));
  assert.ok(cmpK(aceKing.kickers, aceQueen.kickers) > 0); // pair of aces, K kicker beats Q kicker
});

test("bestHand picks the best 5 of 7", () => {
  // Board makes a flush; hole adds nothing better.
  const best = bestHand(cards("As", "2c"), cards("Ks", "Qs", "Js", "Ts", "3d"));
  assert.equal(best.name, "Royal Flush");
});

test("evalHand ordering and handScore ordering never disagree (property test)", () => {
  // The two evaluators used to be separate encodings that drifted. They now share a
  // core; this asserts they induce the identical ordering on random hands.
  const deck = deckStrings();
  let checks = 0;
  // Deterministic-ish sweep: many random 7-card hands per shared 5-card board.
  for (let iter = 0; iter < 400; iter++) {
    const shuffled = [...deck].sort(() => Math.random() - 0.5);
    const board = shuffled.slice(0, 5).map(card);
    const holeA = shuffled.slice(5, 7).map(card);
    const holeB = shuffled.slice(7, 9).map(card);
    const a = bestHand(holeA, board), b = bestHand(holeB, board);
    const evalCmp = a.rank !== b.rank ? Math.sign(a.rank - b.rank) : Math.sign(cmpK(a.kickers, b.kickers));
    const scoreCmp = Math.sign(handScore(holeA, board) - handScore(holeB, board));
    assert.equal(scoreCmp, evalCmp, `mismatch: board ${board.map(c => c.rank + c.suit).join(" ")}`);
    checks++;
  }
  assert.ok(checks > 0);
});
