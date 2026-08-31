// Decision engine — board/holding analysis and the full per-spot decision.
//
// Extracted from the component so the actual DECISIONS (not just their primitives) are
// unit-testable. The whole module is pure and UI-free: given a spot it returns a Decision
// with dialogue, reasoning, thoughts, and the math trail. It reasons with a hand-tier
// preflop model and Monte Carlo equity postflop — a disciplined heuristic baseline, not a
// GTO solver (see README "Is this GTO?").
import type { CardObj, BoardAnalysis, CallQuote, HoldingResult, Decision } from "./types";
import { SUITS, SUIT_NAMES, RS, BB, cv, ck, cardStr, makeDeck, valName, valNameL, valShort } from "./cards";
import { bestHand } from "./eval";
import { score7 } from "./score7";
import { preflopHandTier, preflopRangePercent, preflopThresholds } from "./ranges";
import { monteCarloCallEstimate, monteCarloEquityEstimate } from "./equity";

// Position name → short label. Lives here because the decision engine maps it; the UI
// imports it too.
export const POS_SHORT: Record<string, string> = { "Small Blind": "SB", "Big Blind": "BB", "UTG": "UTG", "Dealer": "BTN" };

// ═══════════════════════════════════════════
// BOARD ANALYSIS
// ═══════════════════════════════════════════
export function analyzeBoard(board: CardObj[]): BoardAnalysis | null {
  if (!board.length) return null;
  const vals = board.map(cv);
  const suits = board.map(c => c.suit);
  const valCounts: Record<number, number> = {};
  vals.forEach(v => { valCounts[v] = (valCounts[v] || 0) + 1; });
  const pairs = Object.entries(valCounts).filter(([, c]) => c >= 2).map(([v]) => +v);
  const trips = Object.entries(valCounts).filter(([, c]) => c >= 3).map(([v]) => +v);
  const suitCounts: Record<string, number> = {};
  suits.forEach(s => { suitCounts[s] = (suitCounts[s] || 0) + 1; });
  const maxSuit = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0];
  const isMonotone = board.length >= 3 && maxSuit[1] === board.length;
  const twoTone = board.length >= 3 && maxSuit[1] >= 2 && !isMonotone;
  const flushSuit = maxSuit[1] >= 2 ? maxSuit[0] : null;
  const flushCount = maxSuit[1];
  const isRainbow = board.length >= 3 && maxSuit[1] === 1;
  const cardsToCome = Math.max(0, 5 - board.length);
  const madeFlushPossible = maxSuit[1] >= 3;
  const flushDrawPossible = cardsToCome > 0 && maxSuit[1] === 2;
  const uniqueValues = new Set(vals);
  if (uniqueValues.has(14)) uniqueValues.add(1); // an ace can be low in A-2-3-4-5
  let maxRun = 1;
  for (let low = 1; low <= 10; low++) {
    const cardsInWindow = [low, low + 1, low + 2, low + 3, low + 4]
      .filter(value => uniqueValues.has(value)).length;
    maxRun = Math.max(maxRun, cardsInWindow);
  }
  const connected = maxRun >= 2;
  const highCard = Math.max(...vals);
  const lowCard = Math.min(...vals);
  const straightDanger = maxRun >= 3;
  return { vals, suits, pairs, trips, isMonotone, twoTone, flushSuit, flushCount, isRainbow, connected, straightDanger, highCard, lowCard, maxRun, cardsToCome, madeFlushPossible, flushDrawPossible };
}

// ═══════════════════════════════════════════
// HAND-vs-BOARD ANALYSIS
// ═══════════════════════════════════════════
export function analyzeHolding(hole: CardObj[], board: CardObj[], ba: BoardAnalysis): HoldingResult {
  const hand = bestHand(hole, board);
  const hv = hole.map(cv);
  const bv = board.map(cv);
  const hs = hole.map(c => c.suit);
  const result: HoldingResult = { hand, draws: [], pairSource: null, realStrength: "weak", details: "" };

  if (hand.rank === 1) {
    const pairVal = hand.kickers[0];
    const boardCount = bv.filter(v => v === pairVal).length;
    const holeCount = hv.filter(v => v === pairVal).length;
    if (boardCount >= 2) {
      result.pairSource = "board"; result.realStrength = "weak";
      const bestKicker = Math.max(...hv);
      result.details = `The pair of ${valNameL(pairVal)}s is on the board — everyone has it. Really just playing ${valShort(bestKicker)}-high.`;
    } else if (holeCount >= 1 && boardCount >= 1) {
      const sortedBV = [...bv].sort((a, b) => b - a);
      if (pairVal === sortedBV[0]) { result.pairSource = "top"; const kicker = hv.find(v => v !== pairVal) || hv[0]; result.realStrength = "good"; result.details = `Top pair, ${valNameL(pairVal)}s, with ${valShort(kicker)} kicker.`; }
      else if (pairVal === sortedBV[sortedBV.length - 1]) { result.pairSource = "bottom"; result.realStrength = "weak"; result.details = `Bottom pair, ${valNameL(pairVal)}s. Vulnerable — any higher pair beats it.`; }
      else { result.pairSource = "middle"; result.realStrength = "decent"; result.details = `Middle pair, ${valNameL(pairVal)}s.`; }
    } else if (holeCount === 2) {
      result.pairSource = "pocket"; result.realStrength = pairVal > ba.highCard ? "good" : "decent";
      result.details = `Pocket ${valNameL(pairVal)}s — ${pairVal > ba.highCard ? "overpair to the board" : "underpair to the board's highest card. A higher pair beats it; pairing a lower board card may not"}.`;
    }
  }
  if (hand.rank === 2) {
    const p1 = hand.kickers[0], p2 = hand.kickers[1];
    const holeContrib1 = hv.includes(p1), holeContrib2 = hv.includes(p2);
    const boardPaired = ba.pairs.length > 0;
    if (!holeContrib1 && !holeContrib2) { result.realStrength = "weak"; result.details = `Two pair is entirely on the board. Everyone has it. Playing kicker only.`; }
    else if (boardPaired && (holeContrib1 || holeContrib2)) {
      const contributed = holeContrib1 ? p1 : p2;
      result.realStrength = contributed >= ba.highCard ? "good" : "decent";
      result.details = `Two pair: ${valNameL(p1)}s and ${valNameL(p2)}s. One pair is the board pair (everyone has it) — the real value is the ${valNameL(contributed)}s from the hole card.`;
    } else { result.realStrength = "good"; result.details = `Two pair: ${valNameL(p1)}s and ${valNameL(p2)}s using hole cards. Solid hand.`; }
  }
  if (hand.rank === 3) {
    const tripVal = hand.kickers[0]; const holeCount = hv.filter(v => v === tripVal).length;
    if (holeCount === 2) { result.realStrength = "monster"; result.details = `Set of ${valNameL(tripVal)}s (pocket pair hit the board). Hidden and strong — opponents can't easily see this.`; }
    else if (holeCount === 1) {
      const boardPairCount = bv.filter(v => v === tripVal).length;
      if (boardPairCount >= 2) { result.realStrength = "strong"; result.details = `Trips — ${valNameL(tripVal)}s using the board pair + hole card. Visible to opponents since the pair is on board.`; }
      else { result.realStrength = "strong"; result.details = `Three of a kind, ${valNameL(tripVal)}s.`; }
    } else { result.realStrength = "decent"; result.details = `Trips are on the board. Everyone has them. Playing kicker.`; }
  }
  if (hand.rank === 4) { result.realStrength = "monster"; result.details = `Straight: ${hand.kickers.map(valShort).join("-")}.`; }
  if (hand.rank === 5) {
    const madeSuit = hand.cards?.[0]?.suit;
    result.realStrength = "monster";
    result.details = madeSuit ? `Flush in ${SUIT_NAMES[madeSuit]}.` : "Flush.";
  }
  if (hand.rank === 6) { result.realStrength = "monster"; result.details = `Full house: ${valNameL(hand.kickers[0])}s full of ${valNameL(hand.kickers[1])}s.`; }
  if (hand.rank >= 7) { result.realStrength = "monster"; result.details = `${hand.name}!`; }
  if (hand.rank === 0) {
    const hi = Math.max(...hv); result.realStrength = "weak";
    result.details = hi === 14
      ? ba.cardsToCome > 0 ? `Ace-high. No pair yet; another ace could make a pair.` : `Ace-high. No pair, and no cards remain.`
      : `${valName(hi)}-high. No pair${ba.cardsToCome > 0 ? " yet." : ", and no cards remain."}`;
  }

  const allSuits = [...hs, ...board.map(c => c.suit)];
  const suitBuckets: Record<string, number> = {};
  allSuits.forEach(s => { suitBuckets[s] = (suitBuckets[s] || 0) + 1; });
  for (const [suit, count] of Object.entries(suitBuckets)) {
    const holeInSuit = hole.filter(c => c.suit === suit);
    const boardInSuit = board.filter(c => c.suit === suit);
    if (ba.cardsToCome > 0 && count === 4 && holeInSuit.length >= 1) {
      const highFlushCard = Math.max(...holeInSuit.map(cv));
      const isNut = highFlushCard === 14;
      result.draws.push({ type: "flush", suit, outs: 13 - count, holeCards: holeInSuit, highCard: highFlushCard, isNut, dirty: highFlushCard <= 8, desc: `Flush draw in ${SUIT_NAMES[suit]} (${holeInSuit.map(cardStr).join("+")} from hand, ${boardInSuit.map(cardStr).join("+")} on board). ${isNut ? "Nut flush draw — best possible." : highFlushCard <= 8 ? "Low flush draw — could lose to a higher flush." : "Decent flush card."}` });
    }
    if (count === 3 && holeInSuit.length >= 1 && board.length === 3) {
      result.draws.push({ type: "backdoor_flush", suit, outs: 0, desc: `Backdoor flush draw in ${SUIT_NAMES[suit]} (need runner-runner — unlikely, don't count these outs).` });
    }
  }

  const allVals = [...new Set([...hv, ...bv])];
  if (allVals.includes(14)) allVals.push(1);
  const completionRanks = new Map<number, number[][]>();
  for (let low = 1; low <= 10; low++) {
    const window = [low, low + 1, low + 2, low + 3, low + 4];
    const have = window.filter(r => allVals.includes(r));
    const missing = window.filter(r => !allVals.includes(r));
    if (have.length === 4 && missing.length === 1) {
      const holeInWindow = window.filter(r => hv.includes(r) || (r === 1 && hv.includes(14)) || (r === 14 && hv.includes(14)));
      if (holeInWindow.length >= 1) {
        const missRank = missing[0] === 1 ? 14 : missing[0];
        if (!completionRanks.has(missRank)) completionRanks.set(missRank, []);
        completionRanks.get(missRank)!.push(window.map(v => v === 1 ? 14 : v));
      }
    }
  }
  if (ba.cardsToCome > 0 && completionRanks.size > 0 && hand.rank < 4) {
    const ranks = [...completionRanks.keys()];
    const knownKeys = new Set([...hole, ...board].map(ck));
    let actualOuts = 0;
    for (const r of ranks) { const rStr = RS[r]; for (const s of SUITS) { if (!knownKeys.has(rStr + s)) actualOuts++; } }
    let drawType = "gutshot";
    if (ranks.length >= 2) {
      const sortedHave = [...new Set([...hv, ...bv])].filter(v => v >= 2).sort((a, b) => a - b);
      const consecutive: number[][] = []; let run = [sortedHave[0]];
      for (let i = 1; i < sortedHave.length; i++) { if (sortedHave[i] - sortedHave[i - 1] === 1) run.push(sortedHave[i]); else { if (run.length >= 4) consecutive.push([...run]); run = [sortedHave[i]]; } }
      if (run.length >= 4) consecutive.push(run);
      drawType = consecutive.some(r => r.length >= 4) ? "open-ended straight" : "double gutshot straight";
    }
    result.draws.push({ type: "straight", drawType, completionRanks: ranks, outs: actualOuts, desc: `${drawType.charAt(0).toUpperCase() + drawType.slice(1)} draw — need a ${ranks.map(r => valName(r)).join(" or ")} to complete. That's ${ranks.length} rank${ranks.length > 1 ? "s" : ""} × 4 suits = ${actualOuts} outs.` });
  }
  return result;
}

// ═══════════════════════════════════════════
// THREAT ASSESSMENT
// ═══════════════════════════════════════════
export function assessThreats(ba: BoardAnalysis | null): string[] {
  if (!ba) return [];
  const threats: string[] = [];
  for (const p of ba.trips) {
    const count = ba.vals.filter(v => v === p).length;
    threats.push(count === 4
      ? `Four ${valNameL(p)}s are on board — everyone has quads, so the highest kicker plays.`
      : `Three ${valNameL(p)}s are on board — a pocket pair makes a full house, and the remaining ${valShort(p)} makes quads.`);
  }
  for (const p of ba.pairs.filter(p => !ba.trips.includes(p))) {
    threats.push(`Board is paired (${valNameL(p)}s) — anyone holding a ${valShort(p)} has trips.`);
  }
  if (ba.madeFlushPossible) threats.push(`${ba.flushCount} ${SUIT_NAMES[ba.flushSuit!]} on board — a flush is already possible.`);
  else if (ba.flushDrawPossible) threats.push(`Two ${SUIT_NAMES[ba.flushSuit!]} on board — flush draws are possible for players holding two ${SUIT_NAMES[ba.flushSuit!]}.`);
  if (ba.straightDanger) {
    const sorted = [...new Set(ba.vals)].sort((a, b) => a - b);
    threats.push(ba.cardsToCome > 0
      ? `Connected board (${sorted.map(valShort).join("-")}) — straight draws are possible.`
      : `Connected river (${sorted.map(valShort).join("-")}) — a straight is possible.`);
  }
  if (ba.highCard === 14) threats.push(`Ace on board — anyone holding an ace has at least a pair of aces.`);
  return threats;
}

// ═══════════════════════════════════════════
// DECISION ENGINE
// ═══════════════════════════════════════════
export function potOddsNote(pot: number, toCall: number): string {
  const potAfter = pot + toCall;
  const pct = Math.round((toCall / potAfter) * 100);
  return `Calling ${toCall} creates a final pot of ${potAfter}, so the call needs an average share of at least ${pct}% over many deals.`;
}

export function snapToBB(amount: number, max: number): number {
  return Math.min(Math.max(Math.round(amount / BB) * BB, BB), Math.max(max, 0));
}

export function potFractionLabel(bet: number, pot: number): string {
  const r = bet / pot;
  if (r < 0.28) return "¼-pot";
  if (r < 0.42) return "⅓-pot";
  if (r < 0.58) return "½-pot";
  if (r < 0.72) return "⅔-pot";
  if (r < 0.92) return "¾-pot";
  if (r < 1.2) return "pot-sized";
  return `${Math.round(r * 100)}%-pot`;
}

export interface CallEvaluation {
  requiredEquity: number;
  expectedValue: number;
  profitable: boolean;
}

// A caller pays `bet` to contest the pot that exists after matching it. If the
// pot was P before the bet, a call creates a final pot of P + 2B.
export function requiredEquityFacingBet(potBeforeBet: number, bet: number): number {
  const p = Math.max(0, potBeforeBet);
  const b = Math.max(0, bet);
  return b === 0 ? 0 : b / (p + 2 * b);
}

// This is the exact fold rate a hand with no chance of winning when called
// needs for a bluff to break even. A semi-bluff needs less because it can also
// win at showdown, but that requires a model of the opponent's calling hands.
export function pureBluffFoldThreshold(potBeforeBet: number, bet: number): number {
  const p = Math.max(0, potBeforeBet);
  const b = Math.max(0, bet);
  return b === 0 ? 0 : b / (p + b);
}

// Pure call/fold rule. Strategy presentation may round these numbers, but decisions and
// profitability claims always use the unrounded values from this result.
export function evaluateCall(equity: number, pot: number, toCall: number): CallEvaluation {
  const cost = Math.max(0, toCall);
  const contestablePot = Math.max(0, pot);
  const requiredEquity = cost === 0 ? 0 : cost / (contestablePot + cost);
  const expectedValue = equity * (contestablePot + cost) - cost;
  return { requiredEquity, expectedValue, profitable: expectedValue >= 0 };
}

export function evaluateCallQuote(equity: number, quote: CallQuote): CallEvaluation {
  const expectedValue = equity * quote.contestablePot - quote.callCost;
  return {
    requiredEquity: quote.requiredEquity,
    expectedValue,
    profitable: expectedValue >= 0,
  };
}

// Exact on the river: try every legal opposing two-card hand. A hand is the unique nuts
// only when every one of those hands loses; a board-only tie does not count.
export function isUniqueRiverNuts(hole: CardObj[], board: CardObj[]): boolean {
  if (board.length !== 5) return false;
  const known = new Set([...hole, ...board].map(ck));
  const remaining = makeDeck().filter(card => !known.has(ck(card)));
  const heroScore = score7([...hole, ...board]);
  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      if (score7([remaining[i], remaining[j], ...board]) >= heroScore) return false;
    }
  }
  return true;
}

export function generateFullDecision(
  playerIdx: number,
  hole: CardObj[],
  board: CardObj[],
  pot: number,
  currentBet: number,
  playerBet: number,
  street: string,
  folded: boolean,
  playerName: string,
  playerPos: string,
  playerStack: number,
  numActive = 3,
  style: "gto" | "loose" | "wild" = "gto",
  numRaisesAhead = 0,
  dealSeed = 0,
  minRaiseTo?: number,
  canRaise = true,
  callQuote?: CallQuote,
): Decision {
  if (folded) return { action: "already_folded", dialogue: "", reasoning: "", thoughts: [], math: [] };
  const fallbackCallCost = Math.min(Math.max(0, currentBet - playerBet), Math.max(0, playerStack));
  const quote = callQuote ?? {
    callCost: fallbackCallCost,
    allIn: fallbackCallCost > 0 && fallbackCallCost === playerStack,
    contestablePot: Math.max(0, pot) + fallbackCallCost,
    requiredEquity: fallbackCallCost === 0 ? 0 : fallbackCallCost / (Math.max(0, pot) + fallbackCallCost),
    layers: [],
  };
  const toCall = quote.callCost;
  const maxBetGlobal = playerStack;
  const hv = hole.map(cv);
  const highHole = Math.max(...hv), lowHole = Math.min(...hv);
  const suited = hole[0].suit === hole[1].suit;
  const pocket = hole[0].rank === hole[1].rank;
  const posShort = POS_SHORT[playerPos] ?? "UTG";
  const numOpponents = Math.max(1, numActive - 1);

  if (street === "preflop") {
    const tier = preflopHandTier(highHole, lowHole, suited);
    const [raiseThr, callThr] = preflopThresholds(posShort, numRaisesAhead, style);
    const maxCommit = playerStack + playerBet;
    const minimumTarget = minRaiseTo ?? (currentBet > 0 ? currentBet + BB : BB);
    const raiseAmt = snapToBB(Math.max(currentBet * 2.5, BB * 2.5, minimumTarget), maxCommit);
    const handLabel = pocket
      ? `pocket ${valNameL(highHole)}s`
      : `${valShort(highHole)}${valShort(lowHole)}${suited ? "s" : "o"}`;
    // Call gate: a hand in the calling range calls if the PRICE is right, rather than
    // being capped at a flat 3bb (which folded strong hands to any larger 3-bet regardless
    // of odds). The pot odds we're asked to lay (toCall / (pot + toCall)) must be within a
    // ceiling that scales with hand strength — stronger groups tolerate worse
    // prices. Still a heuristic (no true preflop equity), but odds-aware, not a magic cap.
    const priceNeeded = quote.requiredEquity;
    const priceCeiling = 0.30 + Math.max(0, callThr - tier) * 0.06;
    const raisePct = Math.round(preflopRangePercent(raiseThr));
    const continuePct = Math.round(preflopRangePercent(callThr));
    let pfAction = tier <= raiseThr ? "raise"
      : (tier <= callThr && (toCall === 0 || priceNeeded <= priceCeiling)) ? (toCall === 0 ? "check" : "call")
      : (toCall === 0 && posShort === "BB") ? "check"
      : "fold";
    if (pfAction === "raise" && (!canRaise || maxCommit <= currentBet)) pfAction = toCall > 0 ? "call" : "check";
    const gap = highHole - lowHole;
    const connStr = gap <= 1 ? "connected" : gap <= 2 ? "one-gap" : gap <= 3 ? "two-gap" : "disconnected";
    const handQuality = pocket
      ? `${cardStr(hole[0])} ${cardStr(hole[1])} — pocket ${valNameL(highHole)}s. A made pair preflop.`
      : `${cardStr(hole[0])} ${cardStr(hole[1])} — ${valNameL(highHole)}-${valNameL(lowHole)} ${suited ? "suited" : "offsuit"}, ${connStr}.${tier === 1 ? " Top group in this trainer's chart." : tier === 2 ? " Strong group in this trainer's chart." : tier <= 4 ? " Playable in some spots in this trainer's chart." : tier === 5 ? " Near the edge of this trainer's chart." : " Weakest group in this trainer's chart."}`;
    const rangeDesc = (() => {
      if (numRaisesAhead >= 2) {
        return `After two raises, this model continues with only its strongest ${continuePct}% of starting-card combinations.`;
      }
      if (numRaisesAhead === 1) {
        return `Facing one raise, this model re-raises its strongest ${raisePct}% of starting-card combinations. It may call with hands through its strongest ${continuePct}% when the current price passes its simple price check.`;
      }
      if (posShort === "BB" && toCall === 0) return "No one raised the big blind, so checking costs nothing.";
      if (raiseThr === callThr) {
        return `In an unopened pot, this model raises its strongest ${raisePct}% of starting-card combinations and folds the rest from ${posShort}.`;
      }
      return `In an unopened pot, this model raises its strongest ${raisePct}% of starting-card combinations and may call with hands through its strongest ${continuePct}% from ${posShort}.`;
    })();
    const decisionLine = pfAction === "fold"
      ? numRaisesAhead >= 2
        ? `${handLabel} is outside this model's strongest ${continuePct}% after two raises. Fold.`
        : numRaisesAhead === 1
        ? `${handLabel} is outside this model's re-raise and call groups from ${posShort}. Fold.`
        : `${handLabel} is outside this model's playing group from ${posShort}. Fold.`
      : pfAction === "raise"
        ? `${handLabel} is inside this model's strongest ${raisePct}% raise group. Raise.`
      : pfAction === "call" ? `${handLabel} passes this model's hand-group and price checks. Call.`
      : `Checking costs nothing, so take the free flop.`;
    const math = [handQuality, rangeDesc, decisionLine];
    const thoughts = [`Holding ${cardStr(hole[0])} ${cardStr(hole[1])}.`];
    if (pocket) {
      if (pfAction === "raise") { thoughts.push(`Pocket ${valNameL(highHole)}s — ${tier === 1 ? "premium pair" : "strong pair"}${numRaisesAhead >= 2 ? ", 4-betting" : numRaisesAhead === 1 ? ", 3-betting" : ", raising"}.`); return { action: "raise", amount: raiseAmt, dialogue: `${playerName} sees the pocket pair and sits up straighter. "Raise to ${raiseAmt}."`, reasoning: `Pocket ${valShort(highHole)}s — raise.`, thoughts, math }; }
      if (pfAction === "call") { thoughts.push(`Pocket ${valNameL(highHole)}s — hoping to flop a set. That happens about 12% of the time (roughly 1 in 8.5).`); math.push(`The raw odds against flopping a set are about 7.5 to 1. Real break-even odds must be better because a set will not always win or earn more chips.`); return { action: "call", dialogue: `${playerName} peeks at the pocket pair and quietly calls. "Call."`, reasoning: `Pocket ${valShort(highHole)}s — call and look for a set.`, thoughts, math }; }
      thoughts.push(`Pocket ${valNameL(highHole)}s — too small to play at this price from ${posShort}.`);
      return { action: "fold", dialogue: `${playerName} glances at the cards and folds. "Fold."`, reasoning: `Pocket ${valShort(highHole)}s too weak here.`, thoughts, math };
    }
    if (pfAction === "raise") { thoughts.push(`${handLabel} — ${numRaisesAhead >= 2 ? "strong enough to 4-bet" : numRaisesAhead === 1 ? `in ${posShort}'s 3-bet range` : `within ${posShort}'s opening range`}.`); return { action: "raise", amount: raiseAmt, dialogue: `${playerName} slides chips forward. "Raise to ${raiseAmt}."`, reasoning: `${handLabel} — raise from ${posShort}.`, thoughts, math }; }
    if (pfAction === "call") {
      thoughts.push(`${handLabel} — playable from ${posShort} at this price.`);
      if (toCall > 0) {
        const pfPotOddsPct = Math.round(quote.requiredEquity * 100);
        math.push(`Calling costs ${toCall}. If there were no later betting, receiving about ${pfPotOddsPct}% of the pot on average would cover that price. Later choices can change the result.`);
        if (highHole === 14) {
          math.push(`An ace can make top pair, but a stronger ace can also have this hand in bad shape. The model treats this hand as playable at the current price; it does not measure a guaranteed profit.`);
        } else if (suited) {
          math.push(`Matching suits creates more ways to make a flush. How much that helps depends on the other player's actual hands and on later betting.`);
        } else if (highHole >= 12) {
          math.push(`High cards can make strong top pairs, but this is still a hand-group rule rather than a measured win-rate result.`);
        } else {
          math.push(`This model keeps the hand because it passes both its starting-hand group and current-price checks. Real opponents and later betting can change whether the call wins money.`);
        }
        if (posShort === "SB") math.push(`Calling from the Small Blind means acting first after the flop. That makes later choices harder because the other players see your choice before making theirs.`);
      }
      return { action: "call", dialogue: `${playerName} considers, then calls. "Call."`, reasoning: `${handLabel} — call from ${posShort}.`, thoughts, math };
    }
    if (pfAction === "check") { thoughts.push(`BB gets a free look — always take it.`); return { action: "check", dialogue: `${playerName} taps the table. "Check."`, reasoning: `BB takes a free flop.`, thoughts, math }; }
    thoughts.push(`${handLabel} — outside range${numRaisesAhead >= 2 ? " vs two re-raises" : numRaisesAhead === 1 ? " facing a raise" : ""} from ${posShort}. Fold.`);
    return { action: "fold", dialogue: `${playerName} glances at the cards and slides them away. "Fold."`, reasoning: `${handLabel} — outside range. Fold.`, thoughts, math };
  }

  // ── POSTFLOP ─────────────────────────────────────────────────────────────
  const SIMS = 1000;
  const callEstimate = toCall > 0
    ? monteCarloCallEstimate(hole, board, quote, numOpponents, SIMS, style, dealSeed)
    : undefined;
  const estimate = callEstimate
    ? { equity: callEstimate.combinedShare, standardError: callEstimate.shareStandardError, samples: callEstimate.samples }
    : monteCarloEquityEstimate(hole, board, numOpponents, SIMS, style, dealSeed);
  const equity = estimate.equity;
  const estimateFields = {
    equity,
    equityStandardError: estimate.standardError,
    equitySamples: estimate.samples,
    ...(callEstimate ? { callEstimate } : {}),
  };
  const equityPct = Math.round(equity * 100);
  const sePct = (estimate.standardError * 100).toFixed(1);
  // Value bets get sized thinner as the pot goes multiway — more players to get through.
  const mwFactor = Math.max(0.4, 1 - 0.18 * (numOpponents - 1));
  const isRiver = street === "river";
  const callEvaluation = callEstimate
    ? {
        requiredEquity: quote.requiredEquity,
        expectedValue: callEstimate.expectedValue,
        profitable: callEstimate.expectedValue >= 0,
      }
    : evaluateCallQuote(equity, quote);
  const potOddsPctPost = (callEvaluation.requiredEquity * 100).toFixed(1);
  const thoughts: string[] = [`Holding ${cardStr(hole[0])} ${cardStr(hole[1])}.`];
  const rangeLabel = style === "wild" ? "any two" : style === "loose" ? "semi-loose range" : "tight range";
  const differentLayerFields = callEstimate
    ? new Set(callEstimate.layers.map(layer => layer.eligibleOpponents.length)).size > 1
    : false;
  const math: string[] = [
    differentLayerFields
      ? `Random-deal estimate: about ${equityPct}% combined share of the pots this hand can win after ${estimate.samples.toLocaleString()} deals. Different pot layers have different numbers of opponents. Random sampling adds about ±${sePct} percentage points of error.`
      : `Random-deal estimate: about ${equityPct}% of the pot against ${numOpponents} opponent${numOpponents > 1 ? "s" : ""} after ${estimate.samples.toLocaleString()} deals. Random sampling adds about ±${sePct} percentage points of error.`,
    `This estimate assumes each opponent uses the app's ${rangeLabel}. It does not use their earlier actions to narrow those possible hands, and different real players can produce a different answer.`,
  ];
  if (callEstimate && callEstimate.layers.length > 1) {
    math.push(...callEstimate.layers.map((layer, index) => {
      const label = index === 0 ? "Main pot" : `Side pot ${index}`;
      const opponents = layer.eligibleOpponents.length;
      return `${label}: ${layer.amount} chips against ${opponents} opponent${opponents === 1 ? "" : "s"}; estimated share about ${Math.round(layer.meanShare * 100)}%, returning about ${layer.expectedReturn.toFixed(2)} chips on average.`;
    }));
  }

  // Position note
  if (playerPos === "Dealer") thoughts.push("In position (BTN) — acting last this round. Major structural advantage.");
  else if (playerPos === "Small Blind") thoughts.push("Out of position (SB) — first to act postflop. Harder to play without reads.");
  else if (playerPos === "Big Blind") thoughts.push("Out of position (BB) — acting early postflop.");
  else thoughts.push("UTG postflop — acting after the blinds, before the button. Some positional disadvantage.");

  if (toCall > 0) {
    const ev = callEvaluation.expectedValue;
    const evText = `${ev >= 0 ? "+" : ""}${ev.toFixed(2)}`;
    const returnErrorText = callEstimate ? callEstimate.returnStandardError.toFixed(2) : "0.00";
    const closeCopy = callEstimate?.isClose
      ? ` Random sampling may move the estimated return by about ±${returnErrorText} chips, so this is a close decision.`
      : "";
    math.push(`Calling costs ${toCall} toward a final pot of ${quote.contestablePot}, so the call needs about ${potOddsPctPost}% of that pot over many deals.`);
    if (callEvaluation.profitable) {
      const uniqueRiverNuts = isRiver && isUniqueRiverNuts(hole, board);
      const valueRaise = canRaise && playerStack + playerBet > currentBet && (uniqueRiverNuts || equity >= 0.72);
      if (valueRaise) {
        const minimumTarget = minRaiseTo ?? currentBet + BB;
        const raiseTarget = snapToBB(
          Math.max(minimumTarget, currentBet + pot * (uniqueRiverNuts ? 0.75 : 0.5) * mwFactor),
          playerStack + playerBet,
        );
        if (raiseTarget > currentBet) {
          math.push(`The showdown-share estimate clears the current call price by ${evText} chips in the trainer's simplified check. This hand also passes the trainer's rule for a value raise${uniqueRiverNuts ? "; no possible river hand can beat it" : ""}.`);
          math.push(`The trainer does not model a separate set of hands that will call the raise.`);
          thoughts.push(uniqueRiverNuts ? `No possible river hand can beat this one — raise.` : `Strong edge while facing a bet — raise for value.`);
          return { action: "raise", amount: raiseTarget, ...estimateFields, dialogue: `${playerName} raises to ${raiseTarget}.`, reasoning: `Raise to ${raiseTarget} for value.`, thoughts, math };
        }
      }
      math.push(`Current-price check: ${equity.toFixed(4)} combined showdown share × ${quote.contestablePot} − ${toCall} = ${evText} chips of modeled room.${closeCopy || " The estimate clears this call's current price."}`);
      math.push(quote.allIn
        ? `No more chips can be asked of this player after the all-in call. Opponent hands and later folds are still modeled only approximately.`
        : `Later bets and folds are not simulated, so this current-price check is not the call's full long-run profit.`);
      thoughts.push(callEstimate?.isClose ? `The estimate slightly clears the current call price, but this is close.` : `The estimated showdown share covers the current price — call.`);
      return { action: "call", ...estimateFields, dialogue: `${playerName} recounts the pot. "Call."`, reasoning: callEstimate?.isClose ? `The estimate slightly clears the current call price, but this is close.` : `The cards' estimated showdown share clears the current call price.`, thoughts, math };
    } else {
      math.push(`Current-price check: ${equity.toFixed(4)} combined showdown share × ${quote.contestablePot} − ${toCall} = ${evText} chips.${closeCopy || ` The estimate misses this call's current price.${isRiver ? " No cards remain to improve the hand." : ""}`}`);
      math.push(quote.allIn
        ? `No more chips can be asked of this player after an all-in call. Opponent hands and later folds are still modeled only approximately.`
        : `Later bets and folds are not simulated, so this current-price check is not the call's full long-run profit.`);
      thoughts.push(callEstimate?.isClose ? `The estimate slightly misses the current call price, but this is close.` : `The estimated showdown share does not cover the current price — fold.`);
      return { action: "fold", ...estimateFields, dialogue: `${playerName} considers the pot, then folds. "Fold."`, reasoning: callEstimate?.isClose ? `The estimate slightly misses the current call price, but this is close.` : `The cards' estimated showdown share misses the current call price.`, thoughts, math };
    }
  }
  if (equity >= 0.65) {
    const betSize = snapToBB(pot * Math.min(equity - 0.20, 0.85) * mwFactor, maxBetGlobal);
    const frac = potFractionLabel(betSize, pot);
    const callerEquityPct = Math.round(requiredEquityFacingBet(pot, betSize) * 100);
    const finalPotIfCalled = pot + 2 * betSize;
    math.push(`About ${equityPct}% estimated pot share passes this trainer's value-bet rule.`);
    if (numOpponents > 1) math.push(`Sized ×${mwFactor.toFixed(2)} for ${numOpponents}-way — thinner value with more players left to beat.`);
    math.push(`${frac} bet (${betSize}). If one opponent calls ${betSize}, the final pot is ${finalPotIfCalled}; that caller needs about ${callerEquityPct}% of the pot to cover the call.`);
    math.push(`The trainer uses the estimate to choose a bet size. It does not model a separate set of hands that will call.`);
    thoughts.push(`Strong estimate — the trainer bets for value.`);
    return { action: "bet", amount: betSize, ...estimateFields, dialogue: `"${betSize}." ${playerName} bets confidently.`, reasoning: `About ${equityPct}% estimated pot share — the trainer makes a ${frac} value bet.`, thoughts, math };
  }
  if (equity >= 0.52) {
    const betSize = snapToBB(pot * 0.33 * mwFactor, maxBetGlobal);
    const frac = potFractionLabel(betSize, pot);
    const callerEquityPct = Math.round(requiredEquityFacingBet(pot, betSize) * 100);
    const finalPotIfCalled = pot + 2 * betSize;
    math.push(`About ${equityPct}% estimated pot share passes this trainer's thin-value rule.`);
    math.push(`${frac} bet (${betSize}). If one opponent calls ${betSize}, the final pot is ${finalPotIfCalled}; that caller needs about ${callerEquityPct}% of the pot to cover the call.`);
    math.push(`The trainer assumes a small bet may be called by weaker hands. It does not model a separate set of hands that will call.`);
    thoughts.push(`Small estimated edge — the trainer makes a small value bet.`);
    return { action: "bet", amount: betSize, ...estimateFields, dialogue: `"${betSize}." ${playerName} puts out a bet.`, reasoning: `About ${equityPct}% estimated pot share — the trainer makes a small ${frac} value bet.`, thoughts, math };
  }
  // Semi-bluff: no bets in front, and a hand that still has real equity to improve
  // (~30–52% plus a real draw or overcards, never pure air). Fire at a fixed frequency. This is a
  // simple heuristic, NOT a solver-derived mixed strategy: real GTO would balance bluffs
  // against a value range so the two are indifferent. The hash keeps the choice
  // deterministic across the useMemo re-runs (see equity.ts) without a stateful RNG.
  const BLUFF_FREQUENCY = 0.3;
  const boardAnalysis = analyzeBoard(board);
  const holdingAnalysis = boardAnalysis ? analyzeHolding(hole, board, boardAnalysis) : null;
  const hasLiveDraw = !!holdingAnalysis?.draws.some(draw => draw.type === "flush" || draw.type === "straight");
  const hasOvercards = !!boardAnalysis && holdingAnalysis?.hand.rank === 0 && hv.some(v => v > boardAnalysis.highCard);
  let bluffHash = (dealSeed ^ Math.imul(playerIdx + 1, 2654435761) ^ Math.imul(Math.round(pot), 40503)) >>> 0;
  for (const card of [...hole, ...board]) bluffHash = Math.imul(bluffHash ^ ck(card).split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0), 2246822519) >>> 0;
  const bluffRoll = bluffHash / 4294967296;
  if (!isRiver && equity >= 0.3 && (hasLiveDraw || hasOvercards) && bluffRoll < BLUFF_FREQUENCY && maxBetGlobal >= BB) {
    const betSize = snapToBB(pot * 0.55, maxBetGlobal);
    const pureBluffFoldPct = Math.round(pureBluffFoldThreshold(pot, betSize) * 100);
    math.push(`About ${equityPct}% estimated pot share with room to improve. The trainer sometimes bets this kind of hand (${Math.round(BLUFF_FREQUENCY * 100)}% of matching spots); that is a simple rule, not a solved strategy.`);
    math.push(`Pure-bluff reference: risking ${betSize} to win ${pot} would need everyone to fold about ${pureBluffFoldPct}% of the time to cover the risk.`);
    math.push(`This hand can also win when called, so its true break-even fold rate would be lower than ${pureBluffFoldPct}%. The app does not model which hands call, so it does not claim an exact result for this bet.`);
    thoughts.push(`Weak-ish but live hand, nobody has bet — mix in a semi-bluff.`);
    return { action: "bet", amount: betSize, ...estimateFields, dialogue: `"${betSize}." ${playerName} bets.`, reasoning: `Semi-bluff — about ${equityPct}% estimated pot share with room to improve.`, thoughts, math };
  }
  math.push(`About ${equityPct}% estimated pot share is below this trainer's betting rules, so it checks.`);
  thoughts.push(`Estimate is below the trainer's betting rules — check.`);
  return { action: "check", ...estimateFields, dialogue: `"Check." ${playerName} taps the table.`, reasoning: `About ${equityPct}% estimated pot share — the trainer checks.`, thoughts, math };
}
