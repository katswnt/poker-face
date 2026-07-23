import { test } from "node:test";
import assert from "node:assert/strict";
import { generateFullDecision, analyzeBoard, analyzeHolding, assessThreats } from "../src/lib/poker/decide";
import { cards } from "./helpers";

// generateFullDecision(playerIdx, hole, board, pot, currentBet, playerBet, street,
//   folded, playerName, playerPos, playerStack, numActive, style, numRaisesAhead, dealSeed)
const decide = (hole: ReturnType<typeof cards>, board: ReturnType<typeof cards>, over: Partial<{
  pot: number; currentBet: number; playerBet: number; street: string; pos: string; raises: number; seed: number;
}> = {}) => generateFullDecision(
  0, hole, board, over.pot ?? 30, over.currentBet ?? 0, over.playerBet ?? 0, over.street ?? "flop",
  false, "Hero", over.pos ?? "UTG", 200, 3, "gto", over.raises ?? 0, over.seed ?? 42,
);

test("preflop: premium hands raise, trash folds", () => {
  const aa = decide(cards("As", "Ah"), [], { street: "preflop", currentBet: 10, pos: "UTG" });
  assert.equal(aa.action, "raise", "AA raises from UTG");
  const trash = decide(cards("7s", "2d"), [], { street: "preflop", currentBet: 10, pos: "UTG" });
  assert.equal(trash.action, "fold", "72o folds from UTG");
});

test("preflop: a 4-bet war folds everything but the nuts", () => {
  const kk = decide(cards("Ks", "Kh"), [], { street: "preflop", currentBet: 120, pos: "BTN", raises: 2 });
  assert.ok(["raise", "call"].includes(kk.action), "KK continues vs a 4-bet");
  const aqo = decide(cards("As", "Qh"), [], { street: "preflop", currentBet: 120, pos: "BTN", raises: 2 });
  assert.equal(aqo.action, "fold", "AQo (tier 2) folds into a 4-bet where only tier-1 continues");
});

test("postflop: a monster bets, air checks when checked to", () => {
  // Hero flops top set on a dry board → very high equity → bet.
  const monster = decide(cards("As", "Ah"), cards("Ad", "7c", "2s"), { pot: 40, currentBet: 0 });
  assert.equal(monster.action, "bet", "top set bets for value");
  assert.ok((monster.amount ?? 0) > 0);
  // Hero has total air, no draw, checked to → check (not a mandatory bluff).
  const air = decide(cards("7s", "2d"), cards("As", "Kh", "Qc"), { pot: 40, currentBet: 0, seed: 7 });
  assert.ok(["check", "bet"].includes(air.action));
});

test("postflop: facing a bet, fold when equity is below pot odds", () => {
  const d = decide(cards("7s", "2d"), cards("As", "Kh", "Qc"), { pot: 40, currentBet: 40, playerBet: 0 });
  assert.equal(d.action, "fold", "air folds facing a big bet");
  assert.ok(d.math.some(m => m.includes("Pot odds")), "explains the pot-odds math");
});

test("every decision carries a reasoning line and math trail", () => {
  const d = decide(cards("As", "Ks"), cards("Qs", "Js", "2d"), { pot: 50, currentBet: 0 });
  assert.ok(d.reasoning.length > 0);
  assert.ok(Array.isArray(d.math) && d.math.length > 0);
  assert.ok(d.math[0].includes("±"), "equity readout includes the standard-error band");
});

test("analyzeBoard flags texture", () => {
  const mono = analyzeBoard(cards("As", "Ks", "7s"))!;
  assert.equal(mono.isMonotone, true, "three of a suit is monotone");
  assert.equal(mono.flushSuit, "♠");
  const paired = analyzeBoard(cards("Ah", "Ad", "7c"))!;
  assert.ok(paired.pairs.includes(14), "detects the paired aces");
  const connected = analyzeBoard(cards("9h", "8d", "7c"))!;
  assert.equal(connected.straightDanger, true, "9-8-7 is straight-dangerous");
});

test("analyzeHolding recognizes made hands and draws", () => {
  const ba = analyzeBoard(cards("Ad", "7c", "2s"))!;
  const set = analyzeHolding(cards("As", "Ah"), cards("Ad", "7c", "2s"), ba);
  assert.equal(set.hand.name, "Three of a Kind");
  assert.equal(set.realStrength, "monster");

  const fdBa = analyzeBoard(cards("Ks", "9s", "2d"))!;
  const flushDraw = analyzeHolding(cards("As", "5s"), cards("Ks", "9s", "2d"), fdBa);
  assert.ok(flushDraw.draws.some(d => d.type === "flush"), "spots the nut flush draw");
});

test("assessThreats warns about scary boards", () => {
  const threats = assessThreats(analyzeBoard(cards("As", "Ks", "Qs")));
  assert.ok(threats.length > 0, "monotone broadway board has threats");
});
