"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  SUITS, SUIT_NAMES, RS, SB, BB,
  makeDeck, shuffle, ck, cv, cardStr, valName, valNameL, valShort,
} from "@/lib/poker/cards";
import { bestHand, cmpK } from "@/lib/poker/eval";
import { monteCarloEquity, equityStandardError } from "@/lib/poker/equity";
import { preflopHandTier, preflopThresholds } from "@/lib/poker/ranges";
import { distributePots } from "@/lib/poker/pots";
import { runBettingRound } from "@/lib/poker/engine";
import type { CardObj, HoldingResult, BoardAnalysis, Decision, PlayerInfo, Stage } from "@/lib/poker/types";

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
const POS_SHORT: Record<string, string> = { "Small Blind": "SB", "Big Blind": "BB", "UTG": "UTG", "Dealer": "BTN" };
const PLAYER_NAMES = ["Alice", "Bob", "Carol", "Dan"];
// Position assigned by offset from dealer index
const POSITIONS_ORDER = ["Dealer", "Small Blind", "Big Blind", "UTG"];

// ═══════════════════════════════════════════
// THEME (terminal only)
// ═══════════════════════════════════════════
const T = {
  bg: "#0d1014",
  panel: "#161a1f",
  panelAlt: "#1c2128",
  focus: "#1f2530",
  ink: "#d4d4cf",
  inkSoft: "#a8a8a0",
  dim: "#6a6a60",
  hair: "#2a2e34",
  hairSoft: "#1c2128",
  accent: "#7dd3a0",
  accentSoft: "#2a4a3a",
  mono: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  cardBg: "#1c2128",
  cardBorder: "#3a4048",
  suitColors: { "♠": "#d4d4cf", "♥": "#ff7a6e", "♦": "#ff7a6e", "♣": "#d4d4cf" } as Record<string, string>,
  radius: 0,
  badgeStyle: {
    fold:  { bg: "transparent", fg: "#6a6a60", border: "#3a3e44" },
    check: { bg: "transparent", fg: "#7dd3a0", border: "#3a5a48" },
    call:  { bg: "transparent", fg: "#6db4f0", border: "#36506a" },
    bet:   { bg: "transparent", fg: "#f0c060", border: "#604830" },
    raise: { bg: "transparent", fg: "#ff7a6e", border: "#6a3030" },
  } as Record<string, { bg: string; fg: string; border: string }>,
};

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════
interface SessionEntry { hand: number; street: string; position: string; heroAction: string; aiAction: string; wasMatch: boolean; aiReasoning: string; }

// ═══════════════════════════════════════════
// BOARD ANALYSIS
// ═══════════════════════════════════════════
function analyzeBoard(board: CardObj[]): BoardAnalysis | null {
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
  const sorted = [...new Set(vals)].sort((a, b) => a - b);
  let maxRun = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) { if (sorted[i] - sorted[i - 1] === 1) { run++; maxRun = Math.max(maxRun, run); } else { run = 1; } }
  const connected = maxRun >= 2;
  const highCard = Math.max(...vals);
  const lowCard = Math.min(...vals);
  const straightDanger = maxRun >= 3;
  return { vals, suits, pairs, trips, isMonotone, twoTone, flushSuit, flushCount, isRainbow, connected, straightDanger, highCard, lowCard, maxRun };
}

// ═══════════════════════════════════════════
// HAND-vs-BOARD ANALYSIS
// ═══════════════════════════════════════════
function analyzeHolding(hole: CardObj[], board: CardObj[], ba: BoardAnalysis): HoldingResult {
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
      result.details = `Pocket ${valNameL(pairVal)}s — ${pairVal > ba.highCard ? "overpair to the board" : "underpair, any board card pairing an opponent beats this"}.`;
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
  if (hand.rank === 5) { result.realStrength = "monster"; result.details = `Flush in ${SUIT_NAMES[hole.find(c => board.some(b => b.suit === c.suit))?.suit || hole[0].suit]}s.`; }
  if (hand.rank === 6) { result.realStrength = "monster"; result.details = `Full house: ${valNameL(hand.kickers[0])}s full of ${valNameL(hand.kickers[1])}s.`; }
  if (hand.rank >= 7) { result.realStrength = "monster"; result.details = `${hand.name}!`; }
  if (hand.rank === 0) {
    const hi = Math.max(...hv); result.realStrength = "weak";
    result.details = hi === 14 ? `Ace-high. No pair yet but the ace is a potential out.` : `${valName(hi)}-high. No pair, no draw. Nothing connects.`;
  }

  const allSuits = [...hs, ...board.map(c => c.suit)];
  const suitBuckets: Record<string, number> = {};
  allSuits.forEach(s => { suitBuckets[s] = (suitBuckets[s] || 0) + 1; });
  for (const [suit, count] of Object.entries(suitBuckets)) {
    const holeInSuit = hole.filter(c => c.suit === suit);
    const boardInSuit = board.filter(c => c.suit === suit);
    if (count === 4 && holeInSuit.length >= 1) {
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
  if (completionRanks.size > 0 && hand.rank < 4) {
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
function assessThreats(ba: BoardAnalysis | null): string[] {
  if (!ba) return [];
  const threats: string[] = [];
  if (ba.pairs.length > 0) for (const p of ba.pairs) threats.push(`Board is paired (${valNameL(p)}s) — anyone holding a ${valShort(p)} has trips.`);
  if (ba.isMonotone) threats.push(`All ${ba.suits.length} cards are ${SUIT_NAMES[ba.flushSuit!]} — anyone with one ${SUIT_NAMES[ba.flushSuit!]} has a flush draw, and two already has a flush.`);
  else if (ba.flushCount >= 3) threats.push(`Three ${SUIT_NAMES[ba.flushSuit!]} on board — anyone with two ${SUIT_NAMES[ba.flushSuit!]} has a flush.`);
  else if (ba.twoTone && ba.flushCount === 2) threats.push(`Two ${SUIT_NAMES[ba.flushSuit!]} on board — flush draw possible for anyone with two ${SUIT_NAMES[ba.flushSuit!]}.`);
  if (ba.straightDanger) { const sorted = [...new Set(ba.vals)].sort((a, b) => a - b); threats.push(`Connected board (${sorted.map(valShort).join("-")}) — straight draws are likely out there.`); }
  if (ba.highCard === 14) threats.push(`Ace on board — anyone holding an ace has at least a pair of aces.`);
  return threats;
}

// ═══════════════════════════════════════════
// DECISION ENGINE
// ═══════════════════════════════════════════
function potOddsNote(pot: number, toCall: number): string {
  const potAfter = pot + toCall;
  const pct = Math.round((toCall / potAfter) * 100);
  return `Pot odds: ${toCall} to call into ${potAfter} total pot → need ${pct}% equity to break even.`;
}

function snapToBB(amount: number, max: number): number {
  return Math.min(Math.max(Math.round(amount / BB) * BB, BB), Math.max(max, 0));
}

function potFractionLabel(bet: number, pot: number): string {
  const r = bet / pot;
  if (r < 0.28) return "¼-pot";
  if (r < 0.42) return "⅓-pot";
  if (r < 0.58) return "½-pot";
  if (r < 0.72) return "⅔-pot";
  if (r < 0.92) return "¾-pot";
  if (r < 1.2) return "pot-sized";
  return `${Math.round(r * 100)}%-pot`;
}

function generateFullDecision(
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
): Decision {
  if (folded) return { action: "already_folded", dialogue: "", reasoning: "", thoughts: [], math: [] };
  const toCall = Math.max(0, currentBet - playerBet);
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
    const raiseAmt = snapToBB(Math.max(currentBet * 2.5, BB * 2.5), playerStack + playerBet);
    const handLabel = pocket
      ? `pocket ${valNameL(highHole)}s`
      : `${valShort(highHole)}${valShort(lowHole)}${suited ? "s" : "o"}`;
    // Call gate: a hand in the calling range calls if the PRICE is right, rather than
    // being capped at a flat 3bb (which folded strong hands to any larger 3-bet regardless
    // of odds). The pot odds we're asked to lay (toCall / (pot + toCall)) must be within a
    // ceiling that scales with hand strength — premiums deeper in the range tolerate worse
    // prices. Still a heuristic (no true preflop equity), but odds-aware, not a magic cap.
    const priceNeeded = toCall > 0 ? toCall / (pot + toCall) : 0;
    const priceCeiling = 0.30 + Math.max(0, callThr - tier) * 0.06;
    const pfAction = tier <= raiseThr ? "raise"
      : (tier <= callThr && (toCall === 0 || priceNeeded <= priceCeiling)) ? (toCall === 0 ? "check" : "call")
      : (toCall === 0 && posShort === "BB") ? "check"
      : "fold";
    const gap = highHole - lowHole;
    const connStr = gap <= 1 ? "connected" : gap <= 2 ? "one-gap" : gap <= 3 ? "two-gap" : "disconnected";
    const handQuality = pocket
      ? `${cardStr(hole[0])} ${cardStr(hole[1])} — pocket ${valNameL(highHole)}s. A made pair preflop.`
      : `${cardStr(hole[0])} ${cardStr(hole[1])} — ${valNameL(highHole)}-${valNameL(lowHole)} ${suited ? "suited" : "offsuit"}, ${connStr}.${tier <= 2 ? " Premium." : tier <= 4 ? " Playable." : tier === 5 ? " Marginal." : " Weak — few strong hands it can make."}`;
    const rangeDesc = (() => {
      if (numRaisesAhead >= 2) {
        const range = style === "wild" ? "TT+, AK, AQs" : style === "loose" ? "JJ+, AK, AQs" : "QQ+, AK — premiums only";
        return `Two re-raises in — 4-bet territory. Only ${range} can continue. Anything else is a fold.`;
      }
      if (numRaisesAhead === 1) {
        const threeRange = style === "wild" ? "JJ+, AK, AQs, suited broadways" : style === "loose" ? "QQ+, AK, AJs+" : "QQ+, AK only";
        if (pfAction === "raise") return `Facing a raise — you 3-bet with premiums: ${threeRange}. Everything else folds or calls.`;
        if (pfAction === "call") return `Facing a raise — premiums 3-bet (${threeRange}), medium-strength hands call, the rest fold. ${handLabel} sits in the calling range from ${posShort}.`;
        return `Facing a raise — 3-bet premiums (${threeRange}) or fold. ${handLabel} falls below the calling threshold here.`;
      }
      if (posShort === "UTG") return style === "wild"
        ? "UTG opens ~top 45%: any pair, any ace, broadway, suited connectors."
        : style === "loose"
        ? "UTG opens ~top 35%: pairs 66+, any ace suited, AJ+/KQ+, suited connectors 87s+."
        : "UTG opens ~top 27%: pairs TT+, aces A8s+/AJo+, broadway KTs+/KQo, suited connectors 87s+. In 4-handed, UTG is CO-equivalent — wider than full-ring.";
      if (posShort === "BTN") return style === "wild"
        ? "BTN opens ~top 75%: almost any two cards with upside — only pure junk folds."
        : style === "loose"
        ? "BTN opens ~top 60%: any pair, any ace, broadway, suited connectors and gappers."
        : "BTN opens ~top 45%: any pair, aces, broadway, suited connectors, suited one-gappers.";
      if (posShort === "SB") return style === "wild"
        ? "SB plays ~top 65%: pairs, any ace, any broadway, suited anything."
        : style === "loose"
        ? "SB plays ~top 55%: pairs, any ace, broadway, suited connectors/gappers, offsuit broadways."
        : "SB plays ~top 45%: pairs, aces A2s+/A7o+, broadway KTo+/KTs+, suited connectors. In 4-handed, SB is nearly heads-up vs BB.";
      return toCall > 0
        ? style === "wild" ? "BB defends very wide vs a raise — only folds pure garbage."
          : style === "loose" ? "BB defends ~65% vs raise: pairs, aces, broadways, suited connectors/gappers, most suited hands."
          : "BB defends ~55% vs raise: pairs, aces A2s+/A7o+, broadway KTo+, suited connectors, suited gappers. Pot odds are good — defend wide."
        : "BB checks for free — always correct to see a flop.";
    })();
    const decisionLine = pfAction === "fold"
      ? numRaisesAhead >= 2
        ? `${handLabel} can't continue vs two re-raises. 4-bet range is KK+. Fold.`
        : numRaisesAhead === 1
        ? `${handLabel} doesn't qualify for ${posShort}'s 3-bet/call range. Fold.`
        : `${handLabel} outside ${posShort}'s opening range. Fold.`
      : pfAction === "raise"
        ? numRaisesAhead >= 2 ? `${handLabel} strong enough to 4-bet. Raise.`
          : numRaisesAhead === 1 ? `${handLabel} in ${posShort}'s 3-bet range. Raise.`
          : `${handLabel} in ${posShort}'s opening range. Raise.`
      : pfAction === "call" ? `${handLabel} worth calling at this price. Call.`
      : `BB takes a free flop. Always correct.`;
    const math = [handQuality, rangeDesc, decisionLine];
    const thoughts = [`Holding ${cardStr(hole[0])} ${cardStr(hole[1])}.`];
    if (pocket) {
      if (pfAction === "raise") { thoughts.push(`Pocket ${valNameL(highHole)}s — ${tier === 1 ? "premium pair" : "strong pair"}${numRaisesAhead >= 2 ? ", 4-betting" : numRaisesAhead === 1 ? ", 3-betting" : ", raising"}.`); return { action: "raise", amount: raiseAmt, dialogue: `${playerName} sees the pocket pair and sits up straighter. "Raise to ${raiseAmt}."`, reasoning: `Pocket ${valShort(highHole)}s — raise.`, thoughts, math }; }
      if (pfAction === "call") { thoughts.push(`Pocket ${valNameL(highHole)}s — set-mining. ~12% (1-in-8.5) to flop a set.`); math.push(`Set odds: ~12%. Need ~7.5:1 implied odds to break even vs small raises.`); return { action: "call", dialogue: `${playerName} peeks at the pocket pair and quietly calls. "Call."`, reasoning: `Pocket ${valShort(highHole)}s — set-mining.`, thoughts, math }; }
      thoughts.push(`Pocket ${valNameL(highHole)}s — too small to play at this price from ${posShort}.`);
      return { action: "fold", dialogue: `${playerName} glances at the cards and folds. "Fold."`, reasoning: `Pocket ${valShort(highHole)}s too weak here.`, thoughts, math };
    }
    if (pfAction === "raise") { thoughts.push(`${handLabel} — ${numRaisesAhead >= 2 ? "strong enough to 4-bet" : numRaisesAhead === 1 ? `in ${posShort}'s 3-bet range` : `within ${posShort}'s opening range`}.`); return { action: "raise", amount: raiseAmt, dialogue: `${playerName} slides chips forward. "Raise to ${raiseAmt}."`, reasoning: `${handLabel} — raise from ${posShort}.`, thoughts, math }; }
    if (pfAction === "call") {
      thoughts.push(`${handLabel} — playable from ${posShort} at this price.`);
      if (toCall > 0) {
        const pfPotOddsPct = Math.round(toCall / (pot + toCall) * 100);
        math.push(`Pot odds: ${toCall} to call into ${pot + toCall} total pot → need ~${pfPotOddsPct}% equity to break even.`);
        if (highHole === 14) {
          math.push(`Ace-high value: any ace on the flop gives top pair. You also "dominate" villains holding weaker aces (A2–A${valShort(lowHole - 1) ?? "x"}) — they need to hit the same pair but lose at showdown.`);
          math.push(`A-x hands run ~52–58% equity vs a typical opening range. At ${pfPotOddsPct}% pot odds, this is a clear +EV call.`);
        } else if (suited) {
          math.push(`Suited adds ~3–4% equity vs the offsuit equivalent — flush draw potential on wet boards and the occasional backdoor flush.`);
          math.push(`Running ~50–55% equity vs a typical opening range at ${pfPotOddsPct}% pot odds — profitable to call.`);
        } else if (highHole >= 12) {
          math.push(`Broadway high card: strong showdown value, top pair on many boards, good blocker equity. Running ~50–54% equity at ${pfPotOddsPct}% pot odds.`);
        } else {
          math.push(`At ${pfPotOddsPct}% pot odds needed, this hand has enough equity vs the opening range to call — particularly with implied odds if you hit the board hard.`);
        }
        if (posShort === "SB") math.push(`Note: calling from SB means you'll be out of position postflop — a real cost. Play straightforwardly on the flop; avoid fancy plays OOP.`);
      }
      return { action: "call", dialogue: `${playerName} considers, then calls. "Call."`, reasoning: `${handLabel} — call from ${posShort}.`, thoughts, math };
    }
    if (pfAction === "check") { thoughts.push(`BB gets a free look — always take it.`); return { action: "check", dialogue: `${playerName} taps the table. "Check."`, reasoning: `BB takes a free flop.`, thoughts, math }; }
    thoughts.push(`${handLabel} — outside range${numRaisesAhead >= 2 ? " vs two re-raises" : numRaisesAhead === 1 ? " facing a raise" : ""} from ${posShort}. Fold.`);
    return { action: "fold", dialogue: `${playerName} glances at the cards and slides them away. "Fold."`, reasoning: `${handLabel} — outside range. Fold.`, thoughts, math };
  }

  // ── POSTFLOP ─────────────────────────────────────────────────────────────
  const SIMS = 1000;
  const equity = monteCarloEquity(hole, board, numOpponents, SIMS, style, dealSeed);
  const equityPct = Math.round(equity * 100);
  const sePct = (equityStandardError(equity, SIMS) * 100).toFixed(1);
  // Value bets get sized thinner as the pot goes multiway — more players to get through.
  const mwFactor = Math.max(0.4, 1 - 0.18 * (numOpponents - 1));
  const isRiver = street === "river";
  const potOddsPctPost = toCall > 0 ? Math.round(toCall / (pot + toCall) * 100) : 0;
  const styleDiscount = style === "loose" ? 8 : style === "wild" ? 18 : 0;
  const callThreshold = potOddsPctPost - styleDiscount;
  const thoughts: string[] = [`Holding ${cardStr(hole[0])} ${cardStr(hole[1])}.`];
  const rangeLabel = style === "wild" ? "any two" : style === "loose" ? "semi-loose range" : "tight range";
  const math: string[] = [`Monte Carlo: ~${equityPct}% ± ${sePct}% equity vs ${numOpponents} opponent${numOpponents > 1 ? "s" : ""} (${SIMS.toLocaleString()} sims, SE = √(p(1−p)/n); opponents on ${rangeLabel}).`];

  // Position note
  if (playerPos === "Dealer") thoughts.push("In position (BTN) — acting last this round. Major structural advantage.");
  else if (playerPos === "Small Blind") thoughts.push("Out of position (SB) — first to act postflop. Harder to play without reads.");
  else if (playerPos === "Big Blind") thoughts.push("Out of position (BB) — acting early postflop.");
  else thoughts.push("UTG postflop — acting after the blinds, before the button. Some positional disadvantage.");

  if (toCall > 0) {
    const ev = Math.round(equity * pot - (1 - equity) * toCall);
    math.push(`Pot odds: ${toCall} to call ÷ (${pot} + ${toCall}) = ${potOddsPctPost}% needed equity.`);
    if (equityPct >= callThreshold) {
      math.push(`${equityPct}% ≥ ${callThreshold}% → call is +EV.`);
      math.push(`EV = ${equityPct}% × ${pot} − ${100 - equityPct}% × ${toCall} = ${ev >= 0 ? "+" : ""}${ev} chips.`);
      thoughts.push(`Equity beats pot odds — call.`);
      return { action: "call", equity, dialogue: `${playerName} recounts the pot. "Call."`, reasoning: `~${equityPct}% equity vs ${potOddsPctPost}% needed — call.`, thoughts, math };
    } else {
      math.push(`${equityPct}% < ${callThreshold}% → fold.${isRiver ? " (River: no implied odds — breakeven is exactly pot odds.)" : ""}`);
      math.push(`EV = ${equityPct}% × ${pot} − ${100 - equityPct}% × ${toCall} = ${ev >= 0 ? "+" : ""}${ev} chips.`);
      thoughts.push(`Not enough equity at this price — fold.`);
      return { action: "fold", equity, dialogue: `${playerName} considers the pot, then folds. "Fold."`, reasoning: `Only ~${equityPct}% equity vs ${potOddsPctPost}% needed — fold.`, thoughts, math };
    }
  }
  if (equity >= 0.65) {
    const betSize = snapToBB(pot * Math.min(equity - 0.20, 0.85) * mwFactor, maxBetGlobal);
    const frac = potFractionLabel(betSize, pot);
    const villainCallPct = Math.round(betSize / (pot + betSize) * 100);
    math.push(`${equityPct}% equity → value bet.`);
    if (numOpponents > 1) math.push(`Sized ×${mwFactor.toFixed(2)} for ${numOpponents}-way — thinner value with more players left to beat.`);
    math.push(`${frac} bet (${betSize}): villain needs ${betSize} ÷ (${pot} + ${betSize}) = ${villainCallPct}% equity to call profitably.`);
    thoughts.push(`Strong equity — bet for value.`);
    return { action: "bet", amount: betSize, equity, dialogue: `"${betSize}." ${playerName} bets confidently.`, reasoning: `~${equityPct}% equity — ${frac} value bet.`, thoughts, math };
  }
  if (equity >= 0.52) {
    const betSize = snapToBB(pot * 0.33 * mwFactor, maxBetGlobal);
    const frac = potFractionLabel(betSize, pot);
    const villainCallPct = Math.round(betSize / (pot + betSize) * 100);
    math.push(`${equityPct}% equity → thin value bet.`);
    math.push(`${frac} bet (${betSize}): villain needs ${villainCallPct}% equity to call — small enough to get calls from worse hands.`);
    thoughts.push(`Slight edge — thin value bet to extract from marginal hands.`);
    return { action: "bet", amount: betSize, equity, dialogue: `"${betSize}." ${playerName} puts out a bet.`, reasoning: `~${equityPct}% equity — ${frac} thin value.`, thoughts, math };
  }
  // Semi-bluff: no bets in front, and a hand that still has real equity to improve
  // (~30–52% — a draw or overcards, not pure air). Fire at a fixed frequency. This is a
  // simple heuristic, NOT a solver-derived mixed strategy: real GTO would balance bluffs
  // against a value range so the two are indifferent. The hash keeps the choice
  // deterministic across the useMemo re-runs (see equity.ts) without a stateful RNG.
  const BLUFF_FREQUENCY = 0.3;
  const bluffRoll = ((playerIdx * 2654435761 + Math.round(pot) * 40503 + board.length * 92821) >>> 0) / 4294967296;
  if (!isRiver && equity >= 0.3 && bluffRoll < BLUFF_FREQUENCY && maxBetGlobal >= BB) {
    const betSize = snapToBB(pot * 0.55, maxBetGlobal);
    const frac = potFractionLabel(betSize, pot);
    const foldPct = Math.round(betSize / (pot + betSize) * 100);
    math.push(`~${equityPct}% equity with room to improve — semi-bluffing for fold equity (fixed ${Math.round(BLUFF_FREQUENCY * 100)}% frequency, a heuristic, not a balanced range).`);
    math.push(`${frac} bluff (${betSize}): breakeven fold% = ${betSize} ÷ (${pot} + ${betSize}) = ${foldPct}%.`);
    math.push(`Proof: EV = fold% × ${pot} − (1−fold%) × ${betSize} = 0 → fold% = ${foldPct}%.`);
    math.push(`Breakeven fold% = pot odds villain faces — mirrors by design. Villain folding > ${foldPct}% → bluff is +EV even before our equity when called.`);
    thoughts.push(`Weak-ish but live hand, nobody has bet — mix in a semi-bluff.`);
    return { action: "bet", amount: betSize, equity, dialogue: `"${betSize}." ${playerName} bets.`, reasoning: `Semi-bluff — ~${equityPct}% equity, ${frac} bet needs ${foldPct}% folds to break even.`, thoughts, math };
  }
  math.push(`${equityPct}% equity — not enough to bet for value. Check.`);
  thoughts.push(`Not strong enough to bet. Check.`);
  return { action: "check", equity, dialogue: `"Check." ${playerName} taps the table.`, reasoning: `~${equityPct}% equity — check.`, thoughts, math };
}


// ═══════════════════════════════════════════
// BETTING ROUND
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// RULES
// ═══════════════════════════════════════════
const RULES = [
  { t: "Small Blind", d: "Forced bet by the player left of dealer. Half the big blind." },
  { t: "Big Blind", d: "Forced bet two left of dealer. Sets the minimum bet for round one." },
  { t: "Check", d: "Pass without betting. Only when nobody has bet this round." },
  { t: "Bet", d: "Put chips in when nobody else has bet this round." },
  { t: "Call", d: "Match someone else's bet to stay in." },
  { t: "Raise", d: "Increase someone else's bet. Action goes back around to all players." },
  { t: "Fold", d: "Give up your hand. Lose what you've put in, risk nothing more." },
  { t: "Position", d: "Where you sit relative to the dealer. Acting later (closer to BTN) is a structural advantage — you see more information before committing chips." },
  { t: "BTN / Button", d: "Best seat. Acts last postflop, seeing every opponent's action first. Rotates clockwise each hand." },
  { t: "UTG", d: "Under the Gun — first to act preflop, worst position. No information before committing chips." },
  { t: "SB", d: "Small Blind — posts half the BB, acts second-to-last preflop, first postflop. Worst postflop position." },
  { t: "BB", d: "Big Blind — posts the full BB, acts last preflop (gets to raise or defend). Still out of position postflop." },
  { t: "In Position", d: "Acting after your opponent. You commit chips after seeing what they do — a major information edge." },
  { t: "Out of Position", d: "Acting before your opponent (SB/BB/UTG). You fly blind — they get to react to your action." },
  { t: "Flop", d: "First 3 community cards, dealt together." },
  { t: "Turn", d: "4th community card. Outs now multiply by 2, not 4." },
  { t: "River", d: "5th and final card. You have it or you don't." },
  { t: "Pot", d: "All chips bet this hand. Winner takes it." },
  { t: "Outs", d: "Cards left in the deck that improve your hand." },
  { t: "Rule of 2 & 4", d: "Outs × 4 on flop, × 2 on turn. Gives your hit %." },
  { t: "Pot Odds", d: "Cost to call ÷ (pot + cost) = % equity you need to break even." },
  { t: "Kicker", d: "Side card that breaks ties between equal pairs." },
  { t: "Top/Mid/Bot Pair", d: "Which board card your hole card matches." },
  { t: "Set", d: "Trips using a pocket pair + board card. Hidden and powerful." },
  { t: "Trips", d: "Three of a kind using a board pair + your card." },
  { t: "Board Pair", d: "When the board pairs, EVERYONE has it." },
  { t: "Flush Draw", d: "4 cards of one suit, need the 5th." },
  { t: "OESD", d: "Open-ended straight draw — 4 in a row, 8 outs." },
  { t: "Gutshot", d: "Need one rank in the middle for a straight. 4 outs." },
  { t: "Dirty Outs", d: "Cards that help you but might help someone else more." },
  { t: "C-bet", d: "Continuation bet — preflop raiser bets the flop." },
  { t: "Bluff", d: "Betting weak to make opponents fold." },
  { t: "Showdown", d: "Everyone remaining shows. Best 5-card hand wins." },
];

// ═══════════════════════════════════════════
// UI: Playing Card
// ═══════════════════════════════════════════
function PlayingCard({ card, dimmed, size = "sm", placeholder, faceDown }: { card?: CardObj; dimmed?: boolean; size?: "sm" | "md" | "lg"; placeholder?: boolean; faceDown?: boolean; }) {
  const D = size === "sm" ? { w: 30, h: 42, rank: 12, suit: 12 } : size === "md" ? { w: 38, h: 54, rank: 15, suit: 16 } : { w: 48, h: 68, rank: 18, suit: 22 };
  if (placeholder) {
    return <div style={{ width: D.w, height: D.h, borderRadius: T.radius, background: "transparent", border: `1px dashed ${T.hair}`, flexShrink: 0, opacity: 0.55 }} />;
  }
  if (faceDown) {
    return (
      <div style={{ width: D.w, height: D.h, background: T.cardBg, border: `1px solid ${T.cardBorder}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          {(["♠","♣","♥","♦"] as const).map(s => (
            <span key={s} style={{ fontFamily: T.mono, fontSize: Math.round(D.suit * 0.62), color: "#2a2e34", lineHeight: 1, textAlign: "center" as const }}>{s}</span>
          ))}
        </div>
      </div>
    );
  }
  if (!card) return <div style={{ width: D.w, height: D.h, flexShrink: 0 }} />;
  const color = T.suitColors[card.suit];
  return (
    <div style={{ width: D.w, height: D.h, background: T.cardBg, border: `1px solid ${T.cardBorder}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, flexShrink: 0, opacity: dimmed ? 0.32 : 1, fontFamily: T.mono, color, borderRadius: 0 }}>
      <span style={{ fontSize: D.rank, fontWeight: 600, lineHeight: 1 }}>{card.rank}</span>
      <span style={{ fontSize: D.suit, lineHeight: 1 }}>{card.suit}</span>
    </div>
  );
}

// ═══════════════════════════════════════════
// UI: Badge
// ═══════════════════════════════════════════
function Badge({ action }: { action: string }) {
  const s = T.badgeStyle[action] || T.badgeStyle.fold;
  return (
    <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: T.radius, background: s.bg, color: s.fg, border: `1px solid ${s.border}`, fontSize: 9.5, fontFamily: T.mono, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {action}
    </span>
  );
}

// ═══════════════════════════════════════════
// UI: Feed Entry
// ═══════════════════════════════════════════
function FeedEntry({ s, isFocused, compact, players, heroIdx }: { s: Stage; isFocused: boolean; compact?: boolean; players: PlayerInfo[]; heroIdx?: number }) {
  if (s.type === "info" || s.type === "street") {
    return (
      <div style={{ padding: "10px 14px", background: T.panelAlt, borderTop: `1px solid ${T.hair}`, borderBottom: `1px solid ${T.hair}` }}>
        <div style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.accent, marginBottom: 3 }}>
          {s.type === "info" ? "Setup" : s.street}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 15, fontWeight: 600, color: T.ink, lineHeight: 1.25, marginBottom: 3 }}>{s.title}</div>
        <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkSoft, lineHeight: 1.5 }}>{s.description || s.note}</div>
      </div>
    );
  }

  if (s.type === "action") {
    const d = s.decision!;
    if (d.action === "already_folded") return null;
    const player = players[s.playerIdx!];

    const isVillain = heroIdx !== undefined && s.playerIdx !== heroIdx;

    if (compact && !isFocused) {
      return (
        <div style={{ padding: "7px 14px", background: "transparent", borderBottom: `1px solid ${T.hairSoft}`, display: "flex", alignItems: "center", gap: 8, opacity: 0.65 }}>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, width: 28 }}>{player.posShort}</span>
          <span style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft, flex: 1, fontWeight: 500 }}>{player.name}</span>
          <Badge action={d.action} />
        </div>
      );
    }

    if (isVillain) {
      return (
        <div style={{ padding: "10px 14px", background: isFocused ? T.panelAlt : "transparent", borderLeft: "2px solid transparent", borderBottom: `1px solid ${T.hairSoft}`, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, width: 28, flexShrink: 0 }}>{player.posShort}</span>
          <span style={{ fontFamily: T.mono, fontSize: 13, color: T.inkSoft, flex: 1, fontWeight: 500 }}>{player.name}</span>
          <Badge action={d.action} />
        </div>
      );
    }

    const toCallCtx = Math.max(0, (s.currentBet ?? 0) - (s.bets?.[s.playerIdx ?? 0] ?? 0));
    return (
      <article style={{ padding: "12px 14px 14px", background: isFocused ? T.focus : "transparent", borderLeft: isFocused ? `2px solid ${T.accent}` : "2px solid transparent", borderBottom: `1px solid ${T.hairSoft}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
            <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 600, color: T.ink }}>{player.name}</span>
            <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{player.posShort}</span>
          </div>
          <Badge action={d.action} />
        </div>
        {s.holeCards && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "6px 9px", background: T.panelAlt, border: `1px solid ${T.hairSoft}` }}>
            <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
              {s.holeCards.map((c, ci) => <PlayingCard key={ci} card={c} size="sm" />)}
            </div>
            {s.board.length > 0 && (
              <>
                <span style={{ color: T.hair, fontFamily: T.mono }}>│</span>
                <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                  {s.board.map((c, ci) => <PlayingCard key={ci} card={c} size="sm" />)}
                </div>
              </>
            )}
            <span style={{ color: T.hair, fontFamily: T.mono }}>│</span>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.dim }}>Pot <span style={{ color: T.accent, fontWeight: 600 }}>{s.pot}</span></span>
            {toCallCtx > 0 && <span style={{ fontFamily: T.mono, fontSize: 10, color: T.inkSoft }}>{toCallCtx} to call</span>}
          </div>
        )}
        <div style={{ fontFamily: T.mono, fontSize: 13, color: T.inkSoft, lineHeight: 1.45, marginBottom: 8, paddingLeft: 9, borderLeft: `2px solid ${T.hairSoft}` }}>
          {d.dialogue}
        </div>
        <div style={{ display: "flex", gap: 7, marginBottom: 8 }}>
          <span style={{ color: T.accent, fontSize: 12, lineHeight: 1.4, fontFamily: T.mono }}>//</span>
          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft, lineHeight: 1.5, flex: 1 }}>{d.reasoning}</div>
        </div>
        {d.thoughts && d.thoughts.length > 0 && (
          <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(125,211,160,0.05)", border: `1px solid ${T.hairSoft}`, borderRadius: T.radius }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 5 }}>Inner thoughts</div>
            {d.thoughts.map((t, ti) => (
              <div key={ti} style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkSoft, lineHeight: 1.55, marginBottom: ti < d.thoughts.length - 1 ? 4 : 0 }}>{t}</div>
            ))}
          </div>
        )}
        {d.math && d.math.length > 0 && (
          <div style={{ marginTop: 7, padding: "8px 10px", background: "rgba(125,211,160,0.06)", border: `1px solid ${T.hair}`, borderRadius: T.radius }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.accent, marginBottom: 5 }}>The math</div>
            {d.math.map((m, mi) => (
              <div key={mi} style={{ fontFamily: T.mono, fontSize: 11, color: T.ink, lineHeight: 1.55, marginBottom: mi < d.math.length - 1 ? 2 : 0 }}>{m}</div>
            ))}
          </div>
        )}
      </article>
    );
  }

  if (s.type === "showdown") {
    const winnerName = players[s.winner!].name;
    const winningHand = !s.foldWin ? s.results?.find(r => r.idx === s.winner)?.hand?.name : null;
    return (
      <div style={{ padding: "14px", background: T.panelAlt, borderTop: `2px solid ${T.accent}`, borderBottom: `1px solid ${T.hair}` }}>
        <div style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: T.accent, marginBottom: 5 }}>Showdown</div>
        <div style={{ fontFamily: T.mono, fontSize: 17, fontWeight: 600, color: T.ink, lineHeight: 1.25, marginBottom: 4 }}>
          {s.foldWin ? `${winnerName} wins — everyone else folded.` : s.chop ? `Split pot — tied with ${winningHand}.` : `${winnerName} wins with ${winningHand}.`}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, marginBottom: s.rankedResults && s.rankedResults.length > 1 ? 10 : 0 }}>
          {s.chop ? `${s.pot} chips split.` : `Takes the ${s.pot}-chip pot.`}
        </div>
        {!s.foldWin && s.rankedResults && s.rankedResults.length > 1 && (
          <div style={{ paddingTop: 10, borderTop: `1px solid ${T.hairSoft}` }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 6 }}>All hands at showdown</div>
            {s.rankedResults.map((r, rank) => (
              <div key={r.idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.8, color: rank === 0 ? T.accent : T.inkSoft, fontWeight: rank === 0 ? 600 : 400 }}>
                <span>#{rank + 1} {players[r.idx].name} <span style={{ fontSize: 9.5, color: T.dim }}>{players[r.idx].posShort}</span></span>
                <span>{r.hand?.name}</span>
              </div>
            ))}
            {(() => {
              const top = s.rankedResults[0];
              const second = s.rankedResults[1];
              if (!top?.hand || !second?.hand || top.hand.rank !== second.hand.rank) return null;
              const kw = top.hand.kickers, kl = second.hand.kickers;
              for (let i = 0; i < kw.length; i++) {
                if ((kl[i] ?? -1) === kw[i]) continue;
                const w = valNameL(kw[i]), l = valNameL(kl[i] ?? 0);
                const r = top.hand.rank;
                const desc = r === 2 && i === 0 ? `Both two pair — ${w}s beats ${l}s on top pair.`
                  : r === 2 && i === 1 ? `Both two pair (${valNameL(kw[0])}s) — ${w}s beats ${l}s on second pair.`
                  : r === 2 ? `Identical two pair — ${w} kicker beats ${l}.`
                  : r === 1 && i === 0 ? `Both a pair — ${w}s beats ${l}s.`
                  : r === 1 ? `Same pair (${valNameL(kw[0])}s) — ${w} kicker beats ${l}.`
                  : r === 0 ? `Both high card — ${w} beats ${l}.`
                  : r === 5 || r === 8 ? `Both ${top.hand.name.toLowerCase()} — ${w}-high beats ${l}-high.`
                  : `${w} kicker beats ${l}.`;
                return <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${T.hairSoft}` }}>Tiebreaker: {desc}</div>;
              }
              return <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, marginTop: 6 }}>Split pot — identical hands.</div>;
            })()}
          </div>
        )}
      </div>
    );
  }
  return null;
}

// ═══════════════════════════════════════════
// UI: Training Prompt
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// UI: Pre-Decision Context Strip
// ═══════════════════════════════════════════
function PreDecisionStrip({ stage, players }: { stage: Stage; players: PlayerInfo[] }) {
  const player = players[stage.playerIdx!];
  const toCall = Math.max(0, (stage.currentBet ?? 0) - (stage.bets?.[stage.playerIdx!] ?? 0));
  const isPreflop = stage.street === "preflop";
  const ba = stage.board.length > 0 ? analyzeBoard(stage.board) : null;

  const posNote = (() => {
    const pos = player.pos;
    if (isPreflop) {
      if (pos === "Dealer") return "Button — acting last preflop. Widest opening range.";
      if (pos === "Small Blind") return "Small Blind — you'll be out of position every postflop street.";
      if (pos === "Big Blind") return "Big Blind — last preflop. Best price, worst postflop position.";
      return "UTG — first to act preflop. No reads. Range must be tight.";
    }
    if (pos === "Dealer") return "Button — acting last every street. Maximum information advantage.";
    if (pos === "Small Blind") return "Small Blind — you act first postflop. No reads before committing.";
    if (pos === "Big Blind") return "Big Blind — early postflop position. Limited info before deciding.";
    return "UTG — before the button postflop. Some positional disadvantage.";
  })();

  const potOddsNote = toCall > 0 ? (() => {
    const pct = Math.round(toCall / (stage.pot + toCall) * 100);
    return `${toCall} to call into ${stage.pot + toCall} pot — need ~${pct}% equity to break even.`;
  })() : null;

  const boardNote = ba ? (() => {
    if (ba.trips.length > 0) return "Paired board (trips possible) — full houses in range. Polarizing spot.";
    if (ba.pairs.length > 0 && ba.isMonotone) return "Paired and monotone — flush possible, trips in range. Complex texture.";
    if (ba.pairs.length > 0) return "Paired board — trips and boats in range. Value bets reveal strength.";
    if (ba.isMonotone) return `Monotone (${ba.flushCount} ${ba.flushSuit}) — flush already possible. Draws must pay immediately.`;
    if (ba.straightDanger && ba.twoTone) return "Wet board — straight draws and flush draws both live. Charge them now.";
    if (ba.straightDanger) return "Connected board — straight draws possible. Protect made hands; don't slow-play.";
    if (ba.twoTone) return "Two-tone — flush draw in play. Made hands should charge the draw.";
    return "Dry board — few draws. Made hands run to showdown. Equity is stable.";
  })() : null;

  const rows: { label: string; note: string }[] = [
    { label: "Position", note: posNote },
    ...(potOddsNote ? [{ label: "Pot odds", note: potOddsNote }] : []),
    ...(boardNote ? [{ label: "Board", note: boardNote }] : []),
  ];

  return (
    <div style={{ marginBottom: 12, padding: "8px 10px", background: T.bg, border: `1px solid ${T.hairSoft}` }}>
      {rows.map(({ label, note }, idx) => (
        <div key={label} style={{ display: "flex", gap: 10, ...(idx < rows.length - 1 ? { marginBottom: 4 } : {}) }}>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.dim, minWidth: 54, paddingTop: 2, flexShrink: 0 }}>{label}</span>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, lineHeight: 1.45 }}>{note}</span>
        </div>
      ))}
    </div>
  );
}

function TrainingPrompt({ stage, players, onChoice }: { stage: Stage; players: PlayerInfo[]; onChoice: (action: string) => void }) {
  const player = players[stage.playerIdx!];
  const toCall = (stage.currentBet || 0) - (stage.bets?.[stage.playerIdx!] || 0);
  const actions = toCall > 0 ? ["fold", "call", "raise"] : ["fold", "check", "raise"];
  return (
    <div style={{ padding: "16px 14px 18px", background: T.focus, borderBottom: `1px solid ${T.hair}` }}>
      <PreDecisionStrip stage={stage} players={players} />
      <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: T.accent, marginBottom: 8 }}>Your decision</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 6 }}>
        <span style={{ fontFamily: T.mono, fontSize: 15, fontWeight: 600, color: T.ink }}>{player.name}</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{player.posShort}</span>
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft, marginBottom: 14, lineHeight: 1.4 }}>
        {toCall > 0
          ? <>Pot <span style={{ color: T.accent }}>{stage.pot}</span> · facing a bet of <span style={{ color: T.accent }}>{stage.currentBet}</span> · <span style={{ color: T.accent, fontWeight: 600 }}>{toCall}</span> to call.</>
          : <>First to act. Pot is <span style={{ color: T.accent }}>{stage.pot}</span>.</>
        }
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, marginBottom: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>What do you do?</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
        {actions.map(action => (
          <button key={action} onClick={() => onChoice(action)} style={{ padding: "9px 18px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", background: "transparent", color: T.ink, border: `1px solid ${T.hair}`, borderRadius: T.radius, cursor: "pointer" }}>
            {action}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// UI: Comparison Banner
// ═══════════════════════════════════════════
function ComparisonBanner({ userAction, aiAction }: { userAction: string; aiAction: string }) {
  const aggressive = ["bet", "raise"];
  const isMatch = userAction === aiAction || (aggressive.includes(userAction) && aggressive.includes(aiAction));
  const isClose = !isMatch && (
    (userAction === "check" && aiAction === "call") ||
    (userAction === "call" && aiAction === "check")
  );
  const label = isMatch ? "✓ Match" : isClose ? "~ Close" : "✗ Different";
  const color = isMatch ? T.accent : isClose ? "#f0c060" : "#ff7a6e";
  return (
    <div style={{ padding: "8px 14px", background: `${color}18`, borderLeft: `3px solid ${color}`, borderBottom: `1px solid ${T.hairSoft}`, display: "flex", gap: 12, alignItems: "center" }}>
      <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, color, letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft }}>
        You: <span style={{ color: T.ink }}>{userAction}</span>
        <span style={{ color: T.dim }}>{" · "}</span>
        AI: <span style={{ color: T.ink }}>{aiAction}</span>
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════
// UI: Info Tooltip
// ═══════════════════════════════════════════
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ fontFamily: T.mono, fontSize: 13, color: open ? T.accent : T.inkSoft, cursor: "pointer", userSelect: "none", lineHeight: 1 }}
      >ⓘ</span>
      {open && (
        <span style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          width: 220,
          padding: "9px 11px",
          background: T.panelAlt,
          border: `1px solid ${T.hair}`,
          fontFamily: T.mono,
          fontSize: 11,
          color: T.inkSoft,
          lineHeight: 1.55,
          zIndex: 200,
          pointerEvents: "none" as const,
          whiteSpace: "normal" as const,
        }}>{text}</span>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════
// UI: Villain Recap (shown at showdown in hero mode)
// ═══════════════════════════════════════════
function VillainRecap({ stages, heroIdx, players }: { stages: Stage[]; heroIdx: number; players: PlayerInfo[] }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const villainIdxs = [0, 1, 2, 3].filter(i => i !== heroIdx);
  const hasAny = villainIdxs.some(vi => stages.some(s => s.type === "action" && s.playerIdx === vi && s.decision?.action !== "already_folded"));
  if (!hasAny) return null;
  return (
    <div style={{ margin: "10px 14px 0", padding: "10px 12px", background: T.panel, border: `1px solid ${T.hair}` }}>
      <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 8 }}>// villain decisions</div>
      {villainIdxs.map(vi => {
        const vstages = stages.filter(s => s.type === "action" && s.playerIdx === vi && s.decision?.action !== "already_folded");
        if (vstages.length === 0) return null;
        const isOpen = !!expanded[vi];
        return (
          <div key={vi} style={{ marginBottom: 6, border: `1px solid ${T.hairSoft}` }}>
            <button
              onClick={() => setExpanded(e => ({ ...e, [vi]: !e[vi] }))}
              style={{ width: "100%", padding: "7px 10px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, textAlign: "left" as const }}
            >
              <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: T.inkSoft }}>{players[vi].name}</span>
              <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{players[vi].posShort}</span>
              <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.dim, marginLeft: "auto" }}>{vstages.length} decision{vstages.length !== 1 ? "s" : ""} {isOpen ? "[–]" : "[+]"}</span>
            </button>
            {isOpen && (
              <div style={{ borderTop: `1px solid ${T.hairSoft}` }}>
                {vstages.map((vs, k) => (
                  <div key={k} style={{ borderBottom: k < vstages.length - 1 ? `1px solid ${T.hairSoft}` : "none" }}>
                    <FeedEntry s={vs} isFocused={false} players={players} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════
// UI: Hand Review (shown at showdown in train mode)
// ═══════════════════════════════════════════
function HandReview({ stages, heroIdx, userChoices, players }: { stages: Stage[]; heroIdx: number; userChoices: Record<number, string>; players: PlayerInfo[] }) {
  const aggressive = ["bet", "raise"];
  const rows = stages.map((s, idx) => {
    if (s.type !== "action" || s.playerIdx !== heroIdx || s.decision?.action === "already_folded") return null;
    const userAct = userChoices[idx];
    if (!userAct) return null;
    const rawAi = s.aiDecision?.action ?? s.decision?.action ?? "";
    const toCallStg = Math.max(0, (s.currentBet ?? 0) - (s.bets?.[heroIdx] ?? 0));
    const aiNorm = rawAi === "call" && toCallStg === 0 ? "check" : rawAi;
    const isMatch = userAct === aiNorm || (aggressive.includes(userAct) && aggressive.includes(aiNorm));
    const aiReasoning = s.aiDecision?.reasoning ?? "";
    return { street: s.street ?? "?", userAct, aiNorm, isMatch, aiReasoning };
  }).filter(Boolean) as Array<{ street: string; userAct: string; aiNorm: string; isMatch: boolean; aiReasoning: string }>;

  if (rows.length === 0) return null;
  const matches = rows.filter(r => r.isMatch).length;

  return (
    <div style={{ margin: "10px 14px 0", padding: "10px 12px", background: T.panel, border: `1px solid ${T.hair}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim }}>// hand review</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: matches === rows.length ? T.accent : matches / rows.length >= 0.6 ? T.ink : T.inkSoft }}>
          {matches}/{rows.length} matched
        </span>
      </div>
      {rows.map((row, i) => {
        const color = row.isMatch ? T.accent : "#ff7a6e";
        return (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderTop: i > 0 ? `1px solid ${T.hairSoft}` : "none" }}>
            <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, color, paddingTop: 2, flexShrink: 0 }}>{row.isMatch ? "✓" : "✗"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" as const }}>
                <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{row.street}</span>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.ink }}>You: {row.userAct}</span>
                {!row.isMatch && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>· AI: {row.aiNorm}</span>}
              </div>
              {!row.isMatch && row.aiReasoning && (
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.inkSoft, lineHeight: 1.4, marginTop: 2 }}>{row.aiReasoning}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════
// WHAT YOU MISSED
// ═══════════════════════════════════════════
function getMissedNote(userAction: string, ai: Decision, stage: Stage): string | null {
  const ua = userAction;
  const aa = ai.action;
  if (ua === aa) return null;

  const equity = ai.equity;
  const equityPct = equity !== undefined ? Math.round(equity * 100) : null;
  const toCall = Math.max(0, (stage.currentBet ?? 0) - (stage.bets?.[stage.playerIdx ?? 0] ?? 0));
  const pot = stage.pot;
  const potOddsPct = toCall > 0 ? Math.round(toCall / (pot + toCall) * 100) : 0;
  const ev = equity !== undefined && toCall > 0 ? Math.round(equity * pot - (1 - equity) * toCall) : null;
  const isPreflop = stage.street === "preflop";

  if (isPreflop) {
    if (ua === "fold" && (aa === "call" || aa === "raise"))
      return `Your hand was in the AI's ${aa === "raise" ? "raising" : "calling"} range from this position — folding is too tight here.`;
    if (ua === "call" && aa === "raise")
      return `Premium hands should raise preflop to charge weaker holdings. Calling lets opponents in cheaply and your hand strength is disguised less.`;
    if (ua === "call" && aa === "fold")
      return `The AI folds here — this hand is below the calling threshold for this position. Calling risks chips without the equity to back it up.`;
    if ((ua === "raise" || ua === "bet") && aa === "fold")
      return `This hand falls below the AI's opening threshold for this position — raising risks chips without sufficient hand strength.`;
    if ((ua === "raise" || ua === "bet") && aa === "call")
      return `The AI calls here rather than raise — this hand isn't quite strong enough to build a big pot from this position.`;
    return null;
  }

  // Postflop
  if (ua === "fold" && aa === "call") {
    if (equityPct !== null && ev !== null)
      return `You folded getting ${potOddsPct}% pot odds with ~${equityPct}% equity — the call was ${ev >= 0 ? `+EV (+${ev} chips)` : `-EV (${ev} chips)`}. ${equityPct >= potOddsPct ? "Your equity covered the price." : ""}`.trim();
    return `The AI calls here — your equity was sufficient to justify the price.`;
  }
  if (ua === "fold" && (aa === "bet" || aa === "raise")) {
    if (equityPct !== null)
      return `You folded a hand with ~${equityPct}% equity. The AI bets for value here — folding surrenders a profitable spot.`;
    return `The AI bets for value here. Folding gives up equity you should be playing.`;
  }
  if (ua === "fold" && aa === "check")
    return `Checking was free — you never need to fold when check is an option. You gave up a free look at the next card.`;

  if (ua === "check" && (aa === "bet" || aa === "raise")) {
    if (equityPct !== null && equityPct >= 55) {
      return `Checking gives opponents free cards on a board where you're ahead. With ~${equityPct}% equity, a bet forces draws to pay${ai.amount ? ` (AI bets ${ai.amount})` : ""}.`;
    }
    if (equityPct !== null) {
      const foldPct = ai.amount ? Math.round(ai.amount / (pot + ai.amount) * 100) : null;
      return `A bet works as a bluff here — with ~${equityPct}% equity you can't rely on showdown value, but a bet can take the pot${foldPct ? ` if villain folds more than ${foldPct}% of the time` : ""}.`;
    }
    return `The AI bets here — checking leaves value on the table or misses a bluff opportunity.`;
  }

  if (ua === "call" && aa === "fold") {
    if (equityPct !== null && ev !== null)
      return `You called ${toCall} into a ${pot} pot (${potOddsPct}% pot odds) with only ~${equityPct}% equity — this call loses ~${Math.abs(ev)} chips on average over time.`;
    return `The AI folds here — your equity doesn't cover the cost of calling.`;
  }
  if (ua === "call" && (aa === "bet" || aa === "raise")) {
    if (equityPct !== null)
      return `Calling here misses value. With ~${equityPct}% equity you're ahead — a raise builds the pot when you're winning and charges draws to continue.`;
    return `The AI raises to build the pot here. Calling misses value with strong equity.`;
  }

  if ((ua === "bet" || ua === "raise") && aa === "check") {
    if (equityPct !== null)
      return `With only ~${equityPct}% equity, betting risks chips on a weak holding. The AI checks to see the next card for free and avoid building a pot out of position.`;
    return `The AI checks to control pot size here — a bet risks chips without enough equity to back it up.`;
  }
  if ((ua === "bet" || ua === "raise") && aa === "fold") {
    if (equityPct !== null)
      return `The AI folds with ~${equityPct}% equity — this hand isn't worth playing at any price. Betting here puts chips in when you're unlikely to win even if called.`;
    return `The AI folds here — this hand isn't worth playing. Betting risks chips without sufficient equity.`;
  }
  if ((ua === "bet" || ua === "raise") && aa === "call") {
    if (equityPct !== null && equityPct < 55)
      return `The AI calls here with ~${equityPct}% equity. Raising bloats the pot in a spot where you aren't a big favorite — calling keeps the pot manageable.`;
    return `The AI calls rather than raises — keep the pot manageable with this hand strength.`;
  }

  return null;
}

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════
export default function PokerSim() {
  const [gs, setGs] = useState<{ hands: CardObj[][]; board: CardObj[]; seed: number } | null>(null);

  const [step, setStep] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [mode, setMode] = useState<"focused" | "dense">("focused");
  const [isDesktop, setIsDesktop] = useState(false);
  const [dealerIdx, setDealerIdx] = useState(3); // Dan starts as BTN, rotates each hand
  const [startingStacks, setStartingStacks] = useState([200, 200, 200, 200]);
  const [trainingMode, setTrainingMode] = useState(false);
  const [heroIdx, setHeroIdx] = useState<number | null>(null);
  const [gameStyle, setGameStyle] = useState<"gto" | "loose" | "wild">("loose");
  const [userChoices, setUserChoices] = useState<Record<number, string>>({});
  const [heroChoices, setHeroChoices] = useState<Decision[]>([]);
  const [handScore, setHandScore] = useState({ matches: 0, total: 0 });
  const [sessionScore, setSessionScore] = useState({ matches: 0, total: 0 });
  const [sessionHistory, setSessionHistory] = useState<SessionEntry[]>([]);
  const [handNumber, setHandNumber] = useState(0);
  const handNumberRef = useRef(0);
  handNumberRef.current = handNumber;
  const feedRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<HTMLDivElement>(null);
  const stagesRef = useRef<Stage[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 740px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const denseScrollToRef = useRef<number | null>(null);

  // Stable refs for keyboard handler
  const trainingRef = useRef(false);
  const userChoicesRef = useRef<Record<number, string>>({});
  const heroChoicesRef = useRef<Decision[]>([]);
  const stepRef = useRef(0);
  const heroIdxRef = useRef<number | null>(null);
  trainingRef.current = trainingMode;
  userChoicesRef.current = userChoices;
  heroChoicesRef.current = heroChoices;
  stepRef.current = step;
  heroIdxRef.current = heroIdx;

  // Keyboard navigation — stable listener via refs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const len = stagesRef.current.length;
      const curStage = stagesRef.current[stepRef.current];
      const prevHeroCount = stagesRef.current.slice(0, stepRef.current).filter(s => s.type === "action" && s.playerIdx === heroIdxRef.current).length;
      const needsChoice = trainingRef.current && curStage?.type === "action" && curStage?.decision?.action !== "already_folded" && (heroIdxRef.current === null || curStage?.playerIdx === heroIdxRef.current) && !userChoicesRef.current[stepRef.current] && heroChoicesRef.current.length <= prevHeroCount;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        if (!needsChoice) setStep(s => s < len - 1 ? s + 1 : s);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStep(s => s > 0 ? s - 1 : s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const players = useMemo((): PlayerInfo[] =>
    PLAYER_NAMES.map((name, i) => {
      const pos = POSITIONS_ORDER[(i - dealerIdx + 4) % 4];
      return { name, pos, posShort: POS_SHORT[pos] };
    }),
  [dealerIdx]);

  const sessionPattern = useMemo((): string | null => {
    const divs = sessionHistory.filter(e => !e.wasMatch);
    if (divs.length < 4) return null;
    const foldTight = divs.filter(e => e.heroAction === "fold" && (e.aiAction === "call" || e.aiAction === "raise" || e.aiAction === "bet")).length;
    const missValue = divs.filter(e => (e.heroAction === "check" || e.heroAction === "call") && (e.aiAction === "bet" || e.aiAction === "raise")).length;
    const callLoose = divs.filter(e => e.heroAction === "call" && (e.aiAction === "fold" || e.aiAction === "check")).length;
    const overAgg = divs.filter(e => (e.heroAction === "bet" || e.heroAction === "raise") && (e.aiAction === "check" || e.aiAction === "fold" || e.aiAction === "call")).length;
    const max = Math.max(foldTight, missValue, callLoose, overAgg);
    if (max < 2) return null;
    if (foldTight === max) return `Pattern: folding too often when AI calls/raises (${foldTight}/${divs.length} divergences). Trust your equity more.`;
    if (missValue === max) return `Pattern: missing value — you check/call when AI bets (${missValue}/${divs.length} divergences). If you're ahead, make them pay.`;
    if (callLoose === max) return `Pattern: calling too loose — AI folds in spots you call (${callLoose}/${divs.length} divergences). Tighten your calling range.`;
    if (overAgg === max) return `Pattern: over-betting — AI checks in spots you raise (${overAgg}/${divs.length} divergences). Pick your spots more carefully.`;
    return null;
  }, [sessionHistory]);

  useEffect(() => {
    if (mode === "dense" && feedRef.current) {
      const target = denseScrollToRef.current ?? step;
      const scrollBlock = denseScrollToRef.current !== null ? "start" : "center";
      denseScrollToRef.current = null;
      const el = feedRef.current.querySelector(`[data-step="${target}"]`);
      if (el) el.scrollIntoView({ block: scrollBlock, inline: "nearest" });
    }
    if (mode === "focused" && focusedRef.current) {
      focusedRef.current.scrollTop = 0;
    }
  }, [step, mode]);

  const deal = useCallback(() => {
    const last = stagesRef.current[stagesRef.current.length - 1];
    const finalStacks = last?.stacks ?? [200, 200, 200, 200];
    const nextStacks = finalStacks.some(s => s <= 0) ? [200, 200, 200, 200] : finalStacks;
    setStartingStacks(nextStacks);
    setDealerIdx(d => (d + 1) % 4);
    setUserChoices({});
    setHeroChoices([]);
    handNumberRef.current = handNumberRef.current + 1;
    setHandNumber(handNumberRef.current);
    setHandScore({ matches: 0, total: 0 });
    setHeroIdx(Math.floor(Math.random() * 4));
    const deck = shuffle(makeDeck());
    const hands = [[deck[0], deck[1]], [deck[2], deck[3]], [deck[4], deck[5]], [deck[6], deck[7]]];
    const board = [deck[8], deck[9], deck[10], deck[11], deck[12]];
    setGs({ hands, board, seed: (Math.random() * 2 ** 32) >>> 0 });
    setStep(0);
  }, []);

  const choiceLockRef = useRef(false);
  const handleChoice = useCallback((action: string) => {
    if (choiceLockRef.current) return;
    choiceLockRef.current = true;
    const curStg = stagesRef.current[step];
    if (!curStg || curStg.playerIdx !== heroIdxRef.current) { choiceLockRef.current = false; return; }
    const rawAi = curStg.decision?.action; // before hero choice injected, this IS the AI's decision
    if (!rawAi || rawAi === "already_folded") { choiceLockRef.current = false; return; }
    const stgToCall = Math.max(0, (curStg.currentBet ?? 0) - (curStg.bets?.[curStg.playerIdx ?? 0] ?? 0));
    const aiNorm = rawAi === "call" && stgToCall === 0 ? "check" : rawAi;
    const normalizedAction = action === "call" && stgToCall === 0 ? "check" : action;
    const aggressive = ["bet", "raise"];
    const isMatch = normalizedAction === aiNorm || (aggressive.includes(normalizedAction) && aggressive.includes(aiNorm));
    // Build a Decision object so the simulation can execute the hero's actual choice
    let heroDec: Decision;
    const heroStack = curStg.stacks?.[curStg.playerIdx ?? 0] ?? 200;
    const heroName = players[curStg.playerIdx ?? heroIdxRef.current ?? 0]?.name ?? "you";
    if (normalizedAction === "fold") {
      heroDec = { action: "fold", dialogue: "You fold.", reasoning: `${heroName} folds.`, thoughts: [], math: [] };
    } else if (normalizedAction === "check") {
      heroDec = { action: "check", dialogue: "You check.", reasoning: `${heroName} checks.`, thoughts: [], math: [] };
    } else if (normalizedAction === "call") {
      heroDec = { action: "call", dialogue: "You call.", reasoning: `${heroName} calls.`, thoughts: [], math: [] };
    } else {
      const raiseAmt = snapToBB(Math.max((curStg.currentBet ?? BB) * 2.5, BB * 2.5), heroStack);
      heroDec = { action: "raise", amount: raiseAmt, dialogue: `You raise to ${raiseAmt}.`, reasoning: `${heroName} raises to ${raiseAmt}.`, thoughts: [], math: [] };
    }
    setHeroChoices(prev => [...prev, heroDec]);
    setUserChoices(c => ({ ...c, [step]: normalizedAction }));
    setHandScore(s => ({ matches: s.matches + (isMatch ? 1 : 0), total: s.total + 1 }));
    setSessionScore(s => ({ matches: s.matches + (isMatch ? 1 : 0), total: s.total + 1 }));
    setSessionHistory(h => [...h, {
      hand: handNumberRef.current,
      street: curStg.street ?? "preflop",
      position: players[curStg.playerIdx ?? 0]?.posShort ?? "",
      heroAction: normalizedAction,
      aiAction: aiNorm,
      wasMatch: isMatch,
      aiReasoning: curStg.aiDecision?.reasoning ?? "",
    }]);
    // Release lock after state queued — React batches these so next render clears it
    setTimeout(() => { choiceLockRef.current = false; }, 0);
  }, [step]);

  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stages = useMemo((): Stage[] => {
    if (!gs) return [];
    const dealSeed = gs.seed; // per-spot equity is seeded from this (see equity.ts)
    const { hands, board } = gs;
    const all: Stage[] = [];
    let folded = [false, false, false, false];

    // Dynamic positions from dealerIdx
    const btnIdx = dealerIdx;
    const sbIdx = (dealerIdx + 1) % 4;
    const bbIdx = (dealerIdx + 2) % 4;
    const utgIdx = (dealerIdx + 3) % 4;

    // Stacks
    let stacks = [...startingStacks];
    let pot = SB + BB;
    stacks[sbIdx] -= SB;
    stacks[bbIdx] -= BB;

    const sbName = players[sbIdx].name;
    const bbName = players[bbIdx].name;
    all.push({ type: "info", street: "preflop", title: "Blinds posted", board: [], pot, folded: [...folded], stacks: [...stacks], description: `${sbName} posts ${SB} (SB). ${bbName} posts ${BB} (BB). Forced bets seed the pot.` });

    // Preflop: UTG first, then BTN, SB, BB. Blinds are already posted (in `stacks`/`pot`),
    // so they carry into the round as the starting bets with currentBet = BB.
    const preflopOrder = [utgIdx, btnIdx, sbIdx, bbIdx];
    const preflopBets = [0, 0, 0, 0];
    preflopBets[sbIdx] = SB;
    preflopBets[bbIdx] = BB;
    const pf = runBettingRound({
      order: preflopOrder, hands, board: [], street: "preflop", players,
      pot, folded, stacks, bets: preflopBets, currentBet: BB, raiseCount: 0, countRaises: true,
      heroIdx, heroChoices, heroActionStart: 0,
      decide: ({ pi, pot, currentBet, playerBet, stack, numActive, raiseCount }) =>
        generateFullDecision(pi, hands[pi], [], pot, currentBet, playerBet, "preflop", false, players[pi].name, players[pi].pos, stack, numActive, gameStyle, raiseCount, dealSeed),
    });
    all.push(...pf.stages);
    pot = pf.pot; folded = pf.folded; stacks = pf.stacks;

    // Postflop: SB first, then BB, UTG, BTN. Fresh betting each street (currentBet 0).
    const postflopOrder = [sbIdx, bbIdx, utgIdx, btnIdx];
    const streets = [{ name: "flop", n: 3 }, { name: "turn", n: 4 }, { name: "river", n: 5 }];
    let heroActions = pf.heroActionsConsumed;
    for (const { name, n } of streets) {
      if (folded.filter(f => !f).length <= 1) break;
      const curBoard = board.slice(0, n);
      const streetLabel = name === "flop" ? `Flop — ${curBoard.map(cardStr).join("  ")}` : `${name.charAt(0).toUpperCase() + name.slice(1)} — ${cardStr(board[n - 1])}`;
      const baseNotes: Record<string, string> = { flop: "Three community cards dealt. New betting round begins.", turn: "Fourth card. Outs now use Rule of 2.", river: "Final card. No more outs." };
      const activePlayers = postflopOrder.filter(i => !folded[i]);
      const allAllIn = activePlayers.length >= 2 && activePlayers.every(i => stacks[i] === 0);
      const heroAllIn = heroIdx !== null && !folded[heroIdx] && stacks[heroIdx] === 0;
      const note = allAllIn
        ? `${baseNotes[name]} All players all-in — board running out, no betting.`
        : heroAllIn
        ? `${baseNotes[name]} You are all-in — no more decisions to make.`
        : baseNotes[name];
      all.push({ type: "street", street: name, title: streetLabel, note, board: curBoard, pot, folded: [...folded], stacks: [...stacks] });
      const result = runBettingRound({
        order: postflopOrder, hands, board: curBoard, street: name, players,
        pot, folded, stacks, bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
        heroIdx, heroChoices, heroActionStart: heroActions,
        decide: ({ pi, pot, currentBet, playerBet, stack, numActive }) =>
          generateFullDecision(pi, hands[pi], curBoard, pot, currentBet, playerBet, name, false, players[pi].name, players[pi].pos, stack, numActive, gameStyle, 0, dealSeed),
      });
      heroActions += result.heroActionsConsumed;
      all.push(...result.stages);
      pot = result.pot; folded = result.folded; stacks = result.stacks;
    }

    if (folded.filter(f => !f).length > 1) {
      const finalBoard = board.slice(0, 5);
      const results = hands.map((h, i) => folded[i] ? { idx: i, folded: true, hand: null } : { idx: i, folded: false, hand: bestHand(h, finalBoard) });
      // Distribute by contribution (startingStack − currentStack) so side pots and
      // split pots pay out correctly — not the whole pot to a single seat.
      const contributions = startingStacks.map((s, i) => s - stacks[i]);
      const { payouts, rankedResults } = distributePots(contributions, folded, hands, finalBoard);
      payouts.forEach((amt, i) => { stacks[i] += amt; });
      const top = rankedResults[0], second = rankedResults[1];
      const chop = !!(top?.hand && second?.hand && top.hand.rank === second.hand.rank && cmpK(top.hand.kickers, second.hand.kickers) === 0);
      const winner = top?.idx ?? results.find(r => !r.folded)!.idx;
      all.push({ type: "showdown", board: finalBoard, pot, folded: [...folded], results, rankedResults, winner, payouts, chop, stacks: [...stacks] });
    } else {
      const w = folded.findIndex(f => !f);
      if (w >= 0) {
        stacks[w] += pot;
        all.push({ type: "showdown", board: all[all.length - 1]?.board || [], pot, folded: [...folded], results: [], rankedResults: [], winner: w, foldWin: true, stacks: [...stacks] });
      }
    }
    return all;
  }, [gs, dealerIdx, startingStacks, players, gameStyle, heroIdx, heroChoices]);

  // Keep ref in sync for keyboard handler
  stagesRef.current = stages;

  // Auto-advance villain steps in hero mode
  useEffect(() => {
    if (autoAdvanceRef.current) { clearTimeout(autoAdvanceRef.current); autoAdvanceRef.current = null; }
    if (!trainingMode || heroIdx === null || !stages.length) return;
    const curStage = stages[step];
    if (!curStage || curStage.type !== "action" || curStage.decision?.action === "already_folded") return;
    if (curStage.playerIdx === heroIdx) return;
    autoAdvanceRef.current = setTimeout(() => {
      setStep(s => Math.min(s + 1, stages.length - 1));
    }, 900);
    return () => { if (autoAdvanceRef.current) { clearTimeout(autoAdvanceRef.current); autoAdvanceRef.current = null; } };
  }, [step, trainingMode, heroIdx, stages]);

  const cur = stages[step];
  const visible = stages.slice(0, step + 1);
  const showBoard = cur?.board || [];
  const isEnd = step >= stages.length - 1;

  // ── Shared sub-sections ──────────────────────────────────────────

  const trainToggle = (
    <div style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
      {(["observe", "train"] as const).map(m => {
        const active = trainingMode ? "train" : "observe";
        return (
          <button key={m} onClick={() => { setTrainingMode(m === "train"); setUserChoices({}); setHandScore({ matches: 0, total: 0 }); setSessionScore({ matches: 0, total: 0 }); if (m === "train" && gs) deal(); }} style={{ padding: "4px 9px", fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", background: active === m ? T.accent : "transparent", color: active === m ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
            {m}
          </button>
        );
      })}
    </div>
  );

  const masthead = (
    <header style={{ paddingBottom: 12, borderBottom: `1px solid ${T.ink}`, marginBottom: 14 }}>
      <h1 style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", textTransform: "uppercase", lineHeight: 1, margin: "0 0 6px", color: T.ink }}>
        HOLD&apos;EM TRAINER
      </h1>
      <p style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, margin: "0 0 10px" }}>
        &gt; practice your poker face
      </p>
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
          <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim }}>Table style</span>
          <div style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
            {([["gto", "Tight"], ["loose", "Loose"], ["wild", "Wild"]] as const).map(([s, label]) => (
              <button key={s} onClick={() => setGameStyle(s)} style={{ padding: "4px 10px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", background: gameStyle === s ? T.ink : "transparent", color: gameStyle === s ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, lineHeight: 1.4, minHeight: "2.5em", display: "block" }}>
            {gameStyle === "gto" ? "Tight, disciplined ranges — the toughest benchmark." : gameStyle === "loose" ? "Wider ranges, more calls — common recreational style." : "Unpredictable and aggressive — high variance."}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
          <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim }}>Mode</span>
          {trainToggle}
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, lineHeight: 1.4, minHeight: "2.5em", display: "block" }}>
            {trainingMode ? "Choose first, then compare to AI." : "Watch and study every decision."}
          </span>
        </div>
      </div>
    </header>
  );

  const creditLine = (
    <p style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, margin: "10px 0 0" }}>
      Built by{" "}
      <a href="https://katswint.com" target="_blank" rel="me author noopener" style={{ color: T.dim, textDecoration: "underline", textUnderlineOffset: 2 }}>
        Kat Swint
      </a>
      {" "}with a little help from Claude Code and Codex
    </p>
  );

  const rulesToggle = (
    <section style={{ marginBottom: 12 }}>
      <button onClick={() => setShowRules(!showRules)} style={{ width: "100%", padding: "8px 10px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", background: "transparent", color: T.ink, border: `1px solid ${T.hair}`, borderRadius: T.radius, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Modes &amp; Glossary</span>
        <span style={{ color: T.dim }}>{showRules ? "[–]" : "[+]"}</span>
      </button>
      {showRules && (
        <div style={{ marginTop: 6, padding: "10px 12px", background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius, maxHeight: 260, overflowY: "auto" }}>
          <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.accent, marginBottom: 8 }}>// modes</div>
          {[
            { t: "Observe", d: "Watch the hand play out. Every decision shows full reasoning, inner thoughts, and the math." },
            { t: "Train", d: "Pick your action before seeing the AI's. Then compare — does your read match?" },
            { t: "Single Steps", d: "Current decision shown in full. Prior moves collapse to one-liners above." },
            { t: "Full Log", d: "Every decision in the hand expanded in full. Scroll to review." },
          ].map((r, i, arr) => (
            <div key={r.t} style={{ paddingBottom: i < arr.length - 1 ? 6 : 0, marginBottom: i < arr.length - 1 ? 6 : 0, borderBottom: i < arr.length - 1 ? `1px solid ${T.hairSoft}` : "none", display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color: T.ink }}>{r.t}</span>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, lineHeight: 1.45 }}>{r.d}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${T.hairSoft}`, margin: "10px 0" }} />
          <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 8 }}>// glossary</div>
          {RULES.map((r, i) => (
            <div key={i} style={{ paddingBottom: i < RULES.length - 1 ? 6 : 0, marginBottom: i < RULES.length - 1 ? 6 : 0, borderBottom: i < RULES.length - 1 ? `1px solid ${T.hairSoft}` : "none", display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color: T.ink }}>{r.t}</span>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, lineHeight: 1.45 }}>{r.d}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const emptyState = (
    <div style={{ padding: "36px 18px", border: `1px solid ${T.hair}`, borderRadius: T.radius, background: T.panel, textAlign: "center" }}>
      <div style={{ fontFamily: T.mono, fontSize: 14, color: T.inkSoft, lineHeight: 1.55, marginBottom: 18 }}>
        Deal four hands. Step through every decision to see each player&apos;s thinking and the math.
      </div>
      <button onClick={deal} style={{ padding: "10px 22px", fontFamily: T.mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", background: T.ink, color: T.bg, border: "none", borderRadius: T.radius, cursor: "pointer" }}>
        $ deal →
      </button>
    </div>
  );


  const modeToggle = (
    <div style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
      {([["focused", "Single Steps"], ["dense", "Full Log"]] as const).map(([m, label]) => (
        <button key={m} onClick={() => setMode(m)} style={{ padding: "3px 8px", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", background: mode === m ? T.ink : "transparent", color: mode === m ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
          {label}
        </button>
      ))}
    </div>
  );

  const playerGrid = gs && (
    <>
      {trainingMode && heroIdx !== null && (
        <div style={{ marginBottom: 6, padding: "5px 10px", background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius, display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: T.accent }}>you</span>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>·</span>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.inkSoft }}>Alice</span>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>·</span>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.ink, fontWeight: 600 }}>{players[heroIdx].pos === "Dealer" ? "Button (BTN)" : players[heroIdx].pos}</span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginBottom: 8 }}>
        {players.map((p, i) => {
          const isFolded = cur?.folded?.[i] && cur?.playerIdx !== i;
          const isActing = cur?.type === "action" && cur?.playerIdx === i;
          const isWinner = cur?.type === "showdown" && cur?.winner === i;
          const isHero = trainingMode && heroIdx === i;
          const stack = cur?.stacks?.[i] ?? startingStacks[i];
          return (
            <div key={i} style={{ padding: "6px 5px 7px", background: isWinner ? T.panelAlt : isActing ? T.focus : T.panel, border: `1px solid ${isWinner ? T.accent : isActing ? T.ink : isHero ? T.accent : T.hair}`, borderRadius: T.radius }}>
              <div style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color: T.ink, lineHeight: 1, marginBottom: 1 }}>{p.name}</div>
              <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 4, marginBottom: 5 }}>
                <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim, letterSpacing: "0.12em", textTransform: "uppercase", lineHeight: 1 }}>{p.posShort}</span>
                {isHero && <span style={{ fontFamily: T.mono, fontSize: 8, color: T.accent, letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1 }}>you</span>}
              </div>
              <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                <PlayingCard card={gs.hands[i][0]} dimmed={isFolded} faceDown={trainingMode && heroIdx !== null && i !== heroIdx && cur?.type !== "showdown"} size="sm" />
                <PlayingCard card={gs.hands[i][1]} dimmed={isFolded} faceDown={trainingMode && heroIdx !== null && i !== heroIdx && cur?.type !== "showdown"} size="sm" />
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.accent, textAlign: "center", marginTop: 3, lineHeight: 1 }}>{stack}</div>
              {isFolded && <div style={{ marginTop: 2, fontFamily: T.mono, fontSize: 8.5, color: T.dim, letterSpacing: "0.14em", textTransform: "uppercase", textAlign: "center", lineHeight: 1 }}>folded</div>}
              {isWinner && <div style={{ marginTop: 2, fontFamily: T.mono, fontSize: 8.5, color: T.accent, letterSpacing: "0.14em", textTransform: "uppercase", textAlign: "center", lineHeight: 1, fontWeight: 700 }}>winner</div>}
              {!isFolded && !isWinner && isActing && <div style={{ marginTop: 2, fontFamily: T.mono, fontSize: 8.5, color: T.ink, letterSpacing: "0.14em", textTransform: "uppercase", textAlign: "center", lineHeight: 1, fontWeight: 700 }}>acting</div>}
              {!isFolded && !isWinner && !isActing && <div style={{ marginTop: 2, height: 9.5 }} />}
            {cur?.type === "showdown" && !isFolded && !cur.foldWin && (() => {
              const r = cur.results?.find(r => r.idx === i);
              return r?.hand ? <div style={{ fontFamily: T.mono, fontSize: 9.5, color: isWinner ? T.accent : T.inkSoft, marginTop: 2, textAlign: "center", lineHeight: 1.2 }}>{r.hand.name}</div> : null;
            })()}
          </div>
          );
        })}
      </div>
    </>
  );

  const board = (
    <div style={{ padding: "12px", background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius, marginBottom: 12 }}>
      <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: T.dim, marginBottom: 8, textAlign: "center" }}>The Board</div>
      <div style={{ display: "flex", gap: 5, justifyContent: "center", minHeight: 54, alignItems: "center" }}>
        {[0, 1, 2, 3, 4].map(i => {
          const c = showBoard[i];
          return c ? <PlayingCard key={i} card={c} size="md" /> : <PlayingCard key={i} placeholder size="md" />;
        })}
      </div>
      <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${T.hairSoft}`, display: "flex", justifyContent: "center", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: T.dim }}>Pot</span>
        <span style={{ fontFamily: T.mono, fontSize: 18, fontWeight: 600, color: T.accent, letterSpacing: "-0.01em" }}>{cur?.pot || 0}</span>
      </div>
    </div>
  );

  // Compact single-row board for mobile
  const mobileBoard = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, padding: "7px 10px", background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius }}>
      <div style={{ display: "flex", gap: 4, flex: 1, justifyContent: "center" }}>
        {[0, 1, 2, 3, 4].map(i => {
          const c = showBoard[i];
          return c ? <PlayingCard key={i} card={c} size="sm" /> : <PlayingCard key={i} placeholder size="sm" />;
        })}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, paddingLeft: 10, borderLeft: `1px solid ${T.hairSoft}`, flexShrink: 0 }}>
        <span style={{ fontFamily: T.mono, fontSize: 8, color: T.dim, letterSpacing: "0.14em", textTransform: "uppercase" }}>POT</span>
        <span style={{ fontFamily: T.mono, fontSize: 15, fontWeight: 600, color: T.accent }}>{cur?.pot || 0}</span>
      </div>
    </div>
  );

  const feed = (desktopFill = false) => {
    const isActionStep = cur?.type === "action" && cur?.decision?.action !== "already_folded";
    const isHeroStep = heroIdx === null || cur?.playerIdx === heroIdx;
    // Count how many hero action stages have occurred before the current step
    const prevHeroActionCount = stages.slice(0, step).filter(s => s.type === "action" && s.playerIdx === heroIdx).length;
    const needsChoice = trainingMode && isActionStep && isHeroStep && heroChoices.length <= prevHeroActionCount;
    const userChoice = userChoices[step];
    const stepToCall = Math.max(0, (cur?.currentBet ?? 0) - (cur?.bets?.[cur?.playerIdx ?? 0] ?? 0));
    // aiDecision is stored on hero stages; for non-hero stages, decision IS the AI's
    const rawAiAction = cur?.aiDecision?.action ?? cur?.decision?.action;
    const aiAction = rawAiAction === "call" && stepToCall === 0 ? "check" : rawAiAction;
    const containerStyle = desktopFill ? { flex: 1, overflowY: "auto" as const } : { maxHeight: 400, overflowY: "auto" as const };

    return (
      <>
        <div style={{ marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim }}>
              {gs ? (mode === "focused" ? "Action · current" : `Action · ${visible.length} entries`) : "Action"}
            </span>
          </div>
          {trainingMode && sessionScore.total > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {handScore.total > 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1 }}>This hand</span>
                  <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: handScore.matches === handScore.total ? T.accent : handScore.matches / handScore.total >= 0.7 ? T.ink : T.inkSoft, lineHeight: 1.2 }}>
                    {handScore.matches}/{handScore.total}
                  </span>
                </div>
              )}
              <div style={{ width: 1, height: 28, background: T.hair }} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1 }}>Session</span>
                <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: T.accent, lineHeight: 1.2 }}>
                  {sessionScore.matches}/{sessionScore.total}
                  <span style={{ fontSize: 9, fontWeight: 400, color: T.dim, marginLeft: 4 }}>
                    ({Math.round(sessionScore.matches / sessionScore.total * 100)}%)
                  </span>
                </span>
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {!trainingMode && modeToggle}
          </div>
        </div>
        {trainingMode && sessionPattern && (
          <div style={{ padding: "6px 14px 7px", background: `${T.accent}10`, borderBottom: `1px solid ${T.hairSoft}`, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ fontFamily: T.mono, fontSize: 8.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.accent, paddingTop: 2, flexShrink: 0 }}>Session</span>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, lineHeight: 1.4 }}>{sessionPattern}</span>
          </div>
        )}

        <div ref={needsChoice ? undefined : (trainingMode || mode === "focused" ? focusedRef : feedRef)}
          style={{ background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius, ...containerStyle }}>

          {/* History trail — all prior steps as compact summaries */}
          {(trainingMode || mode === "focused") && visible.slice(0, step).map((s, i) => (
            <div key={i} onClick={() => { if (trainingMode) { setStep(i); } else { denseScrollToRef.current = i; setMode("dense"); } }} style={{ cursor: "pointer" }} title="Click to view this step">
              <FeedEntry s={s} isFocused={false} compact players={players} heroIdx={trainingMode && heroIdx !== null ? heroIdx : undefined} />
            </div>
          ))}

          {/* Dense mode history (non-training) */}
          {!trainingMode && mode === "dense" && visible.slice(0, step).map((s, i) => (
            <div key={i} data-step={i}>
              <FeedEntry s={s} isFocused={false} players={players} />
            </div>
          ))}

          {/* Current step */}
          {cur && needsChoice && (
            <div data-step={step}>
              <TrainingPrompt stage={cur} players={players} onChoice={handleChoice} />
            </div>
          )}
          {cur && !needsChoice && (
            <div data-step={step}>
              {trainingMode && userChoice && aiAction && isActionStep && isHeroStep && (
                <ComparisonBanner userAction={userChoice} aiAction={aiAction} />
              )}
              <FeedEntry s={cur} isFocused players={players} heroIdx={trainingMode && heroIdx !== null ? heroIdx : undefined} />
              {trainingMode && userChoice && isActionStep && isHeroStep && cur.aiDecision && (() => {
                const aggr = ["bet", "raise"];
                const playingAI = cur.decision?.action === cur.aiDecision?.action ||
                  (aggr.includes(cur.decision?.action ?? "") && aggr.includes(cur.aiDecision?.action ?? ""));
                const revealAndFollow = () => {
                  setHeroChoices(prev => [...prev.slice(0, -1), cur.aiDecision!]);
                  setUserChoices(c => ({ ...c, [step]: cur.aiDecision!.action }));
                };
                return (
                  <div style={{ padding: "12px 14px 14px", background: T.panelAlt, borderBottom: `1px solid ${T.hair}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: playingAI ? 0 : 8 }}>
                      <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: T.dim }}>Model line</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {!playingAI && (
                          <button
                            onClick={revealAndFollow}
                            style={{ padding: "4px 10px", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", background: T.accent, color: T.bg, border: "none", borderRadius: T.radius, cursor: "pointer" }}
                          >
                            ▶ Follow AI
                          </button>
                        )}
                        {playingAI && (
                          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.accent, letterSpacing: "0.1em" }}>✓ Playing AI's move</span>
                        )}
                      </div>
                    </div>
                    {!playingAI && (
                      <>
                        <div style={{ fontFamily: T.mono, fontSize: 13, color: T.inkSoft, lineHeight: 1.45, marginBottom: 6, paddingLeft: 9, borderLeft: `2px solid ${T.hairSoft}` }}>
                          {cur.aiDecision.dialogue}
                        </div>
                        <div style={{ display: "flex", gap: 7, marginBottom: (cur.aiDecision.thoughts?.length ?? 0) > 0 ? 8 : 0 }}>
                          <span style={{ color: T.accent, fontSize: 12, lineHeight: 1.4, fontFamily: T.mono }}>//</span>
                          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft, lineHeight: 1.5, flex: 1 }}>{cur.aiDecision.reasoning}</div>
                        </div>
                        {cur.aiDecision.thoughts && cur.aiDecision.thoughts.length > 0 && (
                          <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(125,211,160,0.05)", border: `1px solid ${T.hairSoft}`, borderRadius: T.radius }}>
                            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 5 }}>Inner thoughts</div>
                            {cur.aiDecision.thoughts.map((t, ti) => (
                              <div key={ti} style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkSoft, lineHeight: 1.55, marginBottom: ti < cur.aiDecision!.thoughts.length - 1 ? 4 : 0 }}>{t}</div>
                            ))}
                          </div>
                        )}
                        {cur.aiDecision.math && cur.aiDecision.math.length > 0 && (
                          <div style={{ marginTop: 7, padding: "8px 10px", background: "rgba(125,211,160,0.06)", border: `1px solid ${T.hair}`, borderRadius: T.radius }}>
                            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.accent, marginBottom: 5 }}>The math</div>
                            {cur.aiDecision.math.map((m, mi) => (
                              <div key={mi} style={{ fontFamily: T.mono, fontSize: 11, color: T.ink, lineHeight: 1.55, marginBottom: mi < cur.aiDecision!.math.length - 1 ? 2 : 0 }}>{m}</div>
                            ))}
                          </div>
                        )}
                        {(() => {
                          const userChoice = userChoices[step];
                          if (!userChoice) return null;
                          const note = getMissedNote(userChoice, cur.aiDecision!, cur);
                          if (!note) return null;
                          return (
                            <div style={{ marginTop: 7, padding: "8px 10px", background: "rgba(255,185,80,0.05)", border: `1px solid rgba(255,185,80,0.22)`, borderRadius: T.radius }}>
                              <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,185,80,0.75)", marginBottom: 5 }}>What you missed</div>
                              <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkSoft, lineHeight: 1.55 }}>{note}</div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          {trainingMode && heroIdx !== null && cur?.type === "showdown" && (
            <>
              <HandReview stages={stages} heroIdx={heroIdx} userChoices={userChoices} players={players} />
              <VillainRecap stages={stages} heroIdx={heroIdx} players={players} />
            </>
          )}
        </div>
      </>
    );
  };

  const navBar = (borderTop = true) => gs && (
    <div style={{ background: T.bg, ...(borderTop ? { borderTop: `1px solid ${T.ink}` } : {}), padding: "10px 14px", display: "flex", gap: 8, alignItems: "center" }}>
      {step > 0 && !isEnd && (
        <button onClick={() => setStep(s => Math.max(s - 1, 0))} style={{ padding: "9px 14px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", background: "transparent", color: T.ink, border: `1px solid ${T.ink}`, borderRadius: T.radius, cursor: "pointer" }}>
          ← Back
        </button>
      )}
      <div style={{ flex: 1 }} />
      {!isEnd && step < stages.length - 2 && !trainingMode && (
        <button onClick={() => setStep(stages.length - 1)} style={{ padding: "9px 14px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", background: "transparent", color: T.dim, border: `1px solid ${T.hair}`, borderRadius: T.radius, cursor: "pointer" }}>
          End →|
        </button>
      )}
      {!isEnd ? (() => {
        const needsChoice = trainingMode && cur?.type === "action" && cur?.decision?.action !== "already_folded" && (heroIdx === null || cur?.playerIdx === heroIdx) && !userChoices[step];
        return (
          <button
            onClick={() => !needsChoice && setStep(s => Math.min(s + 1, stages.length - 1))}
            style={{ padding: "9px 20px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", background: needsChoice ? "transparent" : T.ink, color: needsChoice ? T.dim : T.bg, border: needsChoice ? `1px solid ${T.hair}` : "none", borderRadius: T.radius, cursor: needsChoice ? "default" : "pointer", opacity: needsChoice ? 0.5 : 1 }}
          >
            {needsChoice ? "decide first" : "Next →"}
          </button>
        );
      })() : (
        <button onClick={deal} style={{ padding: "9px 20px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", background: T.accent, color: "#0d1014", border: "none", borderRadius: T.radius, cursor: "pointer" }}>
          $ deal again
        </button>
      )}
    </div>
  );

  // ── Desktop layout ───────────────────────────────────────────────
  if (isDesktop) {
    return (
      <div style={{ fontFamily: T.mono, background: T.bg, color: T.ink, display: "flex", flexDirection: "row", height: "100vh", overflow: "hidden" }}>
        <div style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column", height: "100vh", borderRight: `1px solid ${T.hair}` }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px 0" }}>
            {masthead}
            {rulesToggle}
            {!gs ? emptyState : (
              <>
                {playerGrid}
                {board}
              </>
            )}
          </div>
          {navBar()}
          <div style={{ flexShrink: 0, padding: "0 14px 12px" }}>
            {creditLine}
          </div>
        </div>
        {gs ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", padding: "16px 14px" }}>
            {feed(true)}
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>deal a hand to begin</span>
          </div>
        )}
      </div>
    );
  }

  // ── Mobile layout ────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: T.mono, background: T.bg, color: T.ink, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Fixed top section — never scrolls */}
      <div style={{ flexShrink: 0, padding: "10px 14px 0" }}>
        {!gs ? (
          <>
            {masthead}
            {rulesToggle}
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim }}>Table</span>
                <div style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
                  {(["gto", "loose", "wild"] as const).map(s => (
                    <button key={s} onClick={() => setGameStyle(s)} style={{ padding: "4px 9px", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", background: gameStyle === s ? T.ink : "transparent", color: gameStyle === s ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
                      {s === "gto" ? "tight" : s}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim }}>Mode</span>
                {trainToggle}
              </div>
            </div>
            {playerGrid}
            {board}
          </>
        )}
      </div>
      {/* Feed / empty state — fills remaining space with its own scroll */}
      {!gs ? (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 14px" }}>
          {emptyState}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "0 14px 8px" }}>
          {feed(true)}
        </div>
      )}
      {navBar()}
      <div style={{ flexShrink: 0, padding: "0 14px 10px" }}>
        {creditLine}
      </div>
    </div>
  );
}
