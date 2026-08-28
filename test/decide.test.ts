import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateFullDecision,
  analyzeBoard,
  analyzeHolding,
  assessThreats,
  evaluateCall,
  isUniqueRiverNuts,
  pureBluffFoldThreshold,
  requiredEquityFacingBet,
} from "../src/lib/poker/decide";
import { cards } from "./helpers";

// generateFullDecision(playerIdx, hole, board, pot, currentBet, playerBet, street,
//   folded, playerName, playerPos, playerStack, numActive, style, numRaisesAhead, dealSeed)
const decide = (hole: ReturnType<typeof cards>, board: ReturnType<typeof cards>, over: Partial<{
  pot: number; currentBet: number; playerBet: number; street: string; pos: string; raises: number; seed: number;
}> = {}) => generateFullDecision(
  0, hole, board, over.pot ?? 30, over.currentBet ?? 0, over.playerBet ?? 0, over.street ?? "flop",
  false, "Hero", over.pos ?? "UTG", 200, 3, "gto", over.raises ?? 0, over.seed ?? 42,
);

test("preflop: strongest hand group raises, weakest hand group folds", () => {
  const aa = decide(cards("As", "Ah"), [], { street: "preflop", currentBet: 10, pos: "UTG" });
  assert.equal(aa.action, "raise", "AA raises from UTG");
  const trash = decide(cards("7s", "2d"), [], { street: "preflop", currentBet: 10, pos: "UTG" });
  assert.equal(trash.action, "fold", "72o folds from UTG");
});

test("preflop labels describe trainer groups instead of declaring ATo premium", () => {
  const aceTen = decide(cards("As", "10d"), [], { street: "preflop", currentBet: 10, pos: "BTN" });
  assert.match(aceTen.math[0], /Strong group in this trainer's chart/);
  assert.doesNotMatch(aceTen.math[0], /Premium/);
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
  assert.equal(air.action, "check", "pure air is never mislabeled as a semi-bluff");
});

test("postflop: facing a bet, fold when equity is below pot odds", () => {
  const d = decide(cards("7s", "2d"), cards("As", "Kh", "Qc"), { pot: 40, currentBet: 40, playerBet: 0 });
  assert.equal(d.action, "fold", "air folds facing a big bet");
  assert.ok(d.math.some(m => m.includes("needs about") && m.includes("final pot")), "explains the call price in plain language");
});

test("postflop: the unique river nuts raise instead of only calling", () => {
  const hole = cards("As", "Ks");
  const board = cards("Qs", "Js", "10s", "2d", "3c");
  assert.equal(isUniqueRiverNuts(hole, board), true);
  assert.equal(isUniqueRiverNuts(cards("2c", "3d"), cards("As", "Ks", "Qs", "Js", "10s")), false, "playing an unbeatable board is a tie, not the unique nuts");
  const decision = decide(hole, board, { street: "river", pot: 100, currentBet: 20 });
  assert.equal(decision.action, "raise");
});

test("call profitability uses actual pot odds, independent of table personality", () => {
  const evaluation = evaluateCall(0.45, 100, 100);
  assert.equal(evaluation.requiredEquity, 0.5);
  assert.equal(evaluation.expectedValue, -10);
  assert.equal(evaluation.profitable, false);

  const wildDecision = generateFullDecision(
    0,
    cards("Ah", "2d"),
    cards("Kc", "7s", "7d", "4h", "9c"),
    100,
    100,
    0,
    "river",
    false,
    "Hero",
    "Dealer",
    200,
    2,
    "wild",
    0,
    100,
  );
  assert.equal(wildDecision.action, "fold", "a wild table does not turn a negative-EV call into a recommendation");
  assert.ok(!wildDecision.math.some(line => line.includes("call is +EV")));
});

test("caller pot odds and pure-bluff fold odds use different denominators", () => {
  assert.equal(requiredEquityFacingBet(100, 50), 0.25, "a half-pot bet gives a caller 25% pot odds");
  assert.equal(pureBluffFoldThreshold(100, 50), 1 / 3, "a half-pot pure bluff needs one-third folds");
  assert.ok(Math.abs(requiredEquityFacingBet(100, 80) - 80 / 260) < 1e-12);
  assert.ok(Math.abs(pureBluffFoldThreshold(100, 80) - 80 / 180) < 1e-12);
});

test("value-bet explanation includes both matching chips in the caller's final pot", () => {
  const decision = generateFullDecision(
    0,
    cards("As", "Ah"),
    cards("Ad", "7c", "2s"),
    100,
    0,
    0,
    "flop",
    false,
    "Hero",
    "Dealer",
    200,
    2,
    "gto",
    0,
    42,
  );

  assert.equal(decision.action, "bet");
  assert.equal(decision.amount, 80);
  assert.ok(decision.math.some(line => line.includes("final pot is 260") && line.includes("31%")));
  assert.ok(!decision.math.some(line => line.includes("44%")), "80 into 100 is not a 44% call price");
});

test("semi-bluff copy uses pure-bluff odds only as a reference", () => {
  const decision = generateFullDecision(
    0,
    cards("7s", "6s"),
    cards("Ks", "9s", "2d"),
    100,
    0,
    0,
    "flop",
    false,
    "Hero",
    "Dealer",
    200,
    2,
    "gto",
    0,
    5,
  );

  assert.equal(decision.action, "bet");
  assert.match(decision.reasoning, /Semi-bluff/);
  assert.ok(decision.math.some(line => line.startsWith("Pure-bluff reference:")));
  assert.ok(decision.math.some(line => line.includes("true break-even fold rate would be lower")));
  assert.doesNotMatch(decision.reasoning, /needs .* folds to break even/);
  assert.ok(!decision.math.some(line => line.includes("mirrors by design")));
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
  assert.equal(analyzeBoard(cards("Ah", "2d", "3c"))!.straightDanger, true, "A-2-3 can grow into a wheel straight");
  assert.equal(analyzeBoard(cards("9h", "7d", "5c"))!.straightDanger, true, "gapped ranks in one five-card window are straight-dangerous");

  const threeSpadeTurn = analyzeBoard(cards("As", "7s", "2s", "Kd"))!;
  assert.equal(threeSpadeTurn.madeFlushPossible, true, "three suited board cards mean a flush is already possible");
  assert.equal(threeSpadeTurn.flushDrawPossible, false);

  const twoSpadeRiver = analyzeBoard(cards("As", "7s", "2d", "Kc", "9h"))!;
  assert.equal(twoSpadeRiver.cardsToCome, 0);
  assert.equal(twoSpadeRiver.flushDrawPossible, false, "the river never has a live flush draw");
});

test("analyzeHolding recognizes made hands and draws", () => {
  const ba = analyzeBoard(cards("Ad", "7c", "2s"))!;
  const set = analyzeHolding(cards("As", "Ah"), cards("Ad", "7c", "2s"), ba);
  assert.equal(set.hand.name, "Three of a Kind");
  assert.equal(set.realStrength, "monster");

  const fdBa = analyzeBoard(cards("Ks", "9s", "2d"))!;
  const flushDraw = analyzeHolding(cards("As", "5s"), cards("Ks", "9s", "2d"), fdBa);
  assert.ok(flushDraw.draws.some(d => d.type === "flush"), "spots the nut flush draw");

  const riverBoard = cards("Ks", "9s", "2d", "4c", "7h");
  const riverHolding = analyzeHolding(cards("As", "5s"), riverBoard, analyzeBoard(riverBoard)!);
  assert.equal(riverHolding.draws.length, 0, "the river cannot contain a live draw");
  assert.ok(!riverHolding.details.includes("potential out"), "a river ace is not described as a future out");

  const boardFlush = cards("As", "Ks", "9s", "5s", "2s");
  const boardFlushHolding = analyzeHolding(cards("Qh", "Jd"), boardFlush, analyzeBoard(boardFlush)!);
  assert.equal(boardFlushHolding.details, "Flush in spades.");

  const underpairBoard = cards("Ks", "7d", "2c");
  const underpair = analyzeHolding(cards("8s", "8d"), underpairBoard, analyzeBoard(underpairBoard)!);
  assert.match(underpair.details, /A higher pair beats it/);
  assert.match(underpair.details, /pairing a lower board card may not/);
  assert.doesNotMatch(underpair.details, /any board card pairing/);

  const openEndBoard = cards("9c", "6d", "2s");
  const openEnd = analyzeHolding(cards("8h", "7h"), openEndBoard, analyzeBoard(openEndBoard)!);
  assert.ok(openEnd.draws.some(draw => draw.type === "straight"));
  assert.doesNotMatch(openEnd.details, /no draw|Nothing connects/);
});

test("assessThreats warns about scary boards", () => {
  const threats = assessThreats(analyzeBoard(cards("As", "Ks", "Qs")));
  assert.ok(threats.length > 0, "monotone broadway board has threats");

  const tripBoard = assessThreats(analyzeBoard(cards("As", "Ah", "Ad", "7c")));
  assert.ok(tripBoard.some(threat => threat.includes("pocket pair makes a full house")));
  assert.ok(!tripBoard.some(threat => threat.includes("holding a A has trips")), "made board trips are not described as merely possible");
});
