"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
const SUITS = ["♠", "♥", "♦", "♣"];
const SUIT_NAMES: Record<string, string> = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RV: Record<string, number> = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
const RN: Record<number, string> = { 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten", 11: "Jack", 12: "Queen", 13: "King", 14: "Ace" };
const RNL: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "jack", 12: "queen", 13: "king", 14: "ace" };
const RS: Record<number, string> = { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };
const POS_SHORT: Record<string, string> = { "Small Blind": "SB", "Big Blind": "BB", "UTG": "UTG", "Dealer": "BTN" };
const PLAYER_NAMES = ["Alice", "Bob", "Carol", "Dan"];
const SB = 5, BB = 10;
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
interface CardObj { rank: string; suit: string; }
interface HandResult { rank: number; name: string; kickers: number[]; cards?: CardObj[]; }
interface Draw { type: string; suit?: string; outs: number; holeCards?: CardObj[]; highCard?: number; isNut?: boolean; dirty?: boolean; desc: string; drawType?: string; completionRanks?: number[]; }
interface HoldingResult { hand: HandResult; draws: Draw[]; pairSource: string | null; realStrength: string; details: string; }
interface BoardAnalysis { vals: number[]; suits: string[]; pairs: number[]; trips: number[]; isMonotone: boolean; twoTone: boolean; flushSuit: string | null; flushCount: number; isRainbow: boolean; connected: boolean; straightDanger: boolean; highCard: number; lowCard: number; maxRun: number; }
interface Decision { action: string; amount?: number; dialogue: string; reasoning: string; thoughts: string[]; math: string[]; }
interface PlayerInfo { name: string; pos: string; posShort: string; }
interface Stage {
  type: string; street?: string; title?: string; board: CardObj[]; pot: number; folded: boolean[];
  description?: string; note?: string; playerIdx?: number; bets?: number[]; decision?: Decision;
  currentBet?: number; results?: Array<{ idx: number; folded: boolean; hand: HandResult | null }>; winner?: number; foldWin?: boolean;
  stacks?: number[];
  rankedResults?: Array<{ idx: number; folded: boolean; hand: HandResult | null }>;
}

// ═══════════════════════════════════════════
// DECK & UTILITIES
// ═══════════════════════════════════════════
const makeDeck = (): CardObj[] => { const d: CardObj[] = []; for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s }); return d; };
const shuffle = (a: CardObj[]): CardObj[] => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const ck = (c: CardObj) => c.rank + c.suit;
const cv = (c: CardObj) => RV[c.rank];
const cardStr = (c: CardObj) => c.rank + c.suit;
const valName = (v: number) => RN[v] || String(v);
const valNameL = (v: number) => RNL[v] || String(v);
const valShort = (v: number) => RS[v] || String(v);

// ═══════════════════════════════════════════
// HAND EVALUATION
// ═══════════════════════════════════════════
function getCombos(arr: CardObj[], k: number): CardObj[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [f, ...r] = arr;
  return [...getCombos(r, k - 1).map((c: CardObj[]) => [f, ...c]), ...getCombos(r, k)];
}

function evalHand(cards: CardObj[]): HandResult {
  const vals = cards.map(cv).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  const counts: Record<number, number> = {};
  vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const groups = Object.entries(counts).map(([v, c]) => ({ val: +v, count: c })).sort((a, b) => b.count - a.count || b.val - a.val);
  const isStraight = checkStr(vals);
  if (isFlush && isStraight && vals.includes(14) && vals.includes(13)) return { rank: 9, name: "Royal Flush", kickers: vals };
  if (isFlush && isStraight) return { rank: 8, name: "Straight Flush", kickers: isStraight };
  if (groups[0].count === 4) return { rank: 7, name: "Four of a Kind", kickers: [groups[0].val, groups[1].val] };
  if (groups[0].count === 3 && groups[1]?.count === 2) return { rank: 6, name: "Full House", kickers: [groups[0].val, groups[1].val] };
  if (isFlush) return { rank: 5, name: "Flush", kickers: vals };
  if (isStraight) return { rank: 4, name: "Straight", kickers: isStraight };
  if (groups[0].count === 3) return { rank: 3, name: "Three of a Kind", kickers: [groups[0].val, ...groups.slice(1).map(g => g.val)] };
  if (groups[0].count === 2 && groups[1]?.count === 2) return { rank: 2, name: "Two Pair", kickers: [groups[0].val, groups[1].val, groups[2]?.val] };
  if (groups[0].count === 2) return { rank: 1, name: "Pair", kickers: [groups[0].val, ...groups.slice(1).map(g => g.val)] };
  return { rank: 0, name: "High Card", kickers: vals };
}

function checkStr(vals: number[]): number[] | false {
  const u = [...new Set(vals)].sort((a, b) => b - a);
  if (u.length < 5) return false;
  for (let i = 0; i <= u.length - 5; i++) { if (u[i] - u[i + 4] === 4) { const s = u.slice(i, i + 5); if (new Set(s).size === 5) return s; } }
  if (u.includes(14) && u.includes(5) && u.includes(4) && u.includes(3) && u.includes(2)) return [5, 4, 3, 2, 1];
  return false;
}

function bestHand(hole: CardObj[], board: CardObj[]): HandResult {
  const all = [...hole, ...board];
  if (all.length < 5) return { rank: 0, name: "Incomplete", kickers: [] };
  const combos = getCombos(all, 5);
  let best: HandResult | null = null;
  for (const c of combos) { const e = evalHand(c); if (!best || e.rank > best.rank || (e.rank === best.rank && cmpK(e.kickers, best.kickers) > 0)) { best = e; best.cards = c; } }
  return best!;
}

function cmpK(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}

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
): Decision {
  if (folded) return { action: "already_folded", dialogue: "", reasoning: "", thoughts: [], math: [] };
  const toCall = currentBet - playerBet;
  const hv = hole.map(cv);
  const highHole = Math.max(...hv), lowHole = Math.min(...hv);
  const suited = hole[0].suit === hole[1].suit;
  const pocket = hole[0].rank === hole[1].rank;

  if (street === "preflop") {
    const thoughts = [`Holding ${cardStr(hole[0])} ${cardStr(hole[1])}.`];
    const math = ["Preflop decisions are pattern-based — you learn which starting hands are strong enough to play."];
    const raiseAmt = snapToBB(Math.max(currentBet * 2.5, BB * 2.5), playerStack + playerBet);
    if (pocket && highHole >= 10) { thoughts.push(`Pocket ${valNameL(highHole)}s — premium pair. This is a top-10 starting hand.`); return { action: "raise", amount: raiseAmt, dialogue: `"Raise to ${raiseAmt}." ${playerName} looks confident.`, reasoning: `Pocket ${hole[0].rank}s — premium pair. Raising to build the pot and thin the field.`, thoughts, math }; }
    if (pocket) { thoughts.push(`Pocket ${valNameL(highHole)}s — small pair. Hoping to flop a set (about 12% chance, or roughly 1 in 8 times).`); return { action: "call", dialogue: `"I'll call." ${playerName} peeks at the pocket pair.`, reasoning: `Small pocket pair — set-mining.`, thoughts, math }; }
    if (highHole === 14 && lowHole >= 10) { thoughts.push(`Ace with a ${valNameL(lowHole)} — strong hand. Both cards are high, good kicker.`); return { action: "raise", amount: raiseAmt, dialogue: `"Raise." ${playerName} puts in ${raiseAmt}.`, reasoning: `Strong ace — raising for value.`, thoughts, math }; }
    if (highHole === 14) { thoughts.push(`Ace with a ${valNameL(lowHole)} — the ace is tempting but the ${valNameL(lowHole)} kicker is trouble.`); return { action: "call", dialogue: `"I'll see a flop." Can't fold an ace at a home game.`, reasoning: `Weak ace — risky kicker but hard to fold preflop.`, thoughts, math }; }
    if (highHole >= 10 && lowHole >= 9) { thoughts.push(`Two broadway cards — connected and playable.`); return { action: "call", dialogue: `"I'm in."`, reasoning: `Two high cards, worth seeing a flop.`, thoughts, math }; }
    if (suited && Math.abs(highHole - lowHole) <= 2) { thoughts.push(`Suited connectors (${cardStr(hole[0])} ${cardStr(hole[1])}) — small chance of a straight or flush. Fun hand to play.`); return { action: "call", dialogue: `"I'll play these." Suited connectors are tempting.`, reasoning: `Suited connectors — speculative but have potential.`, thoughts, math }; }
    if (suited) { thoughts.push(`Suited but not connected. Flush is a long shot.`); return { action: "call", dialogue: `"They're suited, I'm in." ${playerName} grins.`, reasoning: `Suited cards — loose call, common at home games.`, thoughts, math }; }
    if (toCall <= BB) { thoughts.push(`${valName(highHole)}-${valNameL(lowHole)} offsuit is weak but it's only ${toCall} to see a flop.`); return { action: "call", dialogue: `"Eh, it's only ${toCall}." ${playerName} tosses in chips.`, reasoning: `Weak hand, but the price is cheap.`, thoughts, math }; }
    thoughts.push(`${valName(highHole)}-${valNameL(lowHole)} offsuit — junk. Not connected, not suited, not high. Fold.`);
    return { action: "fold", dialogue: `"I'm out." ${playerName} mucks.`, reasoning: `Junk hand. Not worth it.`, thoughts, math };
  }

  const ba = analyzeBoard(board)!;
  const holding = analyzeHolding(hole, board, ba);
  const threats = assessThreats(ba);
  const hand = holding.hand;
  const thoughts: string[] = [];

  // Board description
  let boardDesc = `Board: ${board.map(cardStr).join(" ")}.`;
  if (ba.isMonotone) boardDesc += ` All ${SUIT_NAMES[ba.flushSuit!]} — monotone board.`;
  else if (ba.flushCount >= 3) boardDesc += ` Three ${SUIT_NAMES[ba.flushSuit!]} — flush is possible.`;
  else if (ba.twoTone) boardDesc += ` Two ${SUIT_NAMES[ba.flushSuit!]} — flush draws possible.`;
  else if (ba.isRainbow) boardDesc += ` Rainbow — no flush draws.`;
  if (ba.pairs.length > 0) boardDesc += ` Board is paired (${ba.pairs.map(v => valNameL(v) + "s").join(", ")}) — everyone has that pair.`;
  if (ba.straightDanger) boardDesc += ` Cards are connected — straight draws likely.`;
  thoughts.push(boardDesc);

  // Position awareness
  if (playerPos === "Dealer") {
    thoughts.push("In position (button) — acting last this round. You see every opponent commit before you decide. Major structural advantage.");
  } else if (playerPos === "Small Blind") {
    thoughts.push("Out of position (SB) — first to act postflop. Harder to play without reads on the rest of the table.");
  } else if (playerPos === "Big Blind") {
    thoughts.push("Out of position (BB) — acting early postflop with less information than the later positions.");
  } else {
    thoughts.push("UTG postflop — first or second to act. No reads yet from the later positions.");
  }

  thoughts.push(`Holding ${cardStr(hole[0])} ${cardStr(hole[1])}. ${holding.details}`);
  if (holding.draws.length > 0) for (const d of holding.draws) { if (d.type !== "backdoor_flush") thoughts.push(d.desc); else if (board.length === 3) thoughts.push(d.desc); }
  else if (hand.rank < 4) thoughts.push("No meaningful draws.");
  if (threats.length > 0) thoughts.push("Threats: " + threats.slice(0, 2).join(" "));

  let drawOuts = 0; const drawOutsDesc: string[] = [];
  for (const d of holding.draws) { if (d.type === "flush" && d.outs > 0) { drawOuts += d.outs; drawOutsDesc.push(`${d.outs} outs for the flush`); } if (d.type === "straight" && d.outs > 0) { drawOuts += d.outs; drawOutsDesc.push(`${d.outs} outs for the straight`); } }
  let improvementOuts = 0; const improvementDesc: string[] = [];
  if (hand.rank === 1 && holding.pairSource !== "board") { improvementOuts = 2; improvementDesc.push(`2 outs to make trips`); }
  const totalOuts = drawOuts + improvementOuts;
  const cardsLeft = board.length === 3 ? 2 : 1;
  const multiplier = cardsLeft === 2 ? 4 : 2;
  const hitPct = Math.min(totalOuts * multiplier, 100);
  const hasBackdoorFlush = holding.draws.some(d => d.type === "backdoor_flush");
  const math: string[] = [];
  const strength = holding.realStrength;
  const maxBet = playerStack;

  const appendOutsMath = () => {
    const allDesc = [...improvementDesc, ...drawOutsDesc];
    if (totalOuts > 0) {
      math.push(`Outs: ${allDesc.join(" + ")} = ${totalOuts} total.`);
      math.push(`Rule of ${multiplier}: ${totalOuts} × ${multiplier} = ~${hitPct}% chance to improve.`);
    }
    if (hasBackdoorFlush) math.push(`Backdoor flush draw (needs runner-runner) — not counted.`);
  };

  if (strength === "monster") {
    const betSize = snapToBB(pot * 0.65, maxBet);
    const frac = potFractionLabel(betSize, pot);
    math.push(`Made hand: ${hand.name} — premium.`);
    math.push(`${frac} bet (${betSize} chips) to build the pot and charge draws.`);
    if (toCall > 0) math.push(potOddsNote(pot, toCall));
    thoughts.push(`This is strong. Bet to build the pot.`);
    if (toCall === 0) return { action: "bet", amount: betSize, dialogue: `"${betSize}." ${playerName} bets with quiet confidence.`, reasoning: `${hand.name} — ${frac} bet for value.`, thoughts, math };
    const raiseAmt = snapToBB(toCall * 2.5, maxBet + playerBet);
    return { action: "raise", amount: raiseAmt, dialogue: `"Raise to ${raiseAmt}." ${playerName} slides chips forward.`, reasoning: `${hand.name} — raising for value.`, thoughts, math };
  }
  if (strength === "strong") {
    const betSize = snapToBB(pot * 0.5, maxBet);
    const frac = potFractionLabel(betSize, pot);
    math.push(`Made hand: ${hand.name} — strong.`);
    math.push(`${frac} bet (${betSize} chips) to protect against draws and extract value.`);
    appendOutsMath();
    if (toCall > 0) math.push(potOddsNote(pot, toCall));
    thoughts.push(`Good hand — need to bet to protect it.`);
    if (toCall === 0) return { action: "bet", amount: betSize, dialogue: `"${betSize}." ${playerName} puts out a bet.`, reasoning: `${holding.details} ${frac} bet to protect.`, thoughts, math };
    if (toCall <= pot * 0.6) return { action: "call", dialogue: `"Call." ${playerName} matches the bet.`, reasoning: `${holding.details} Strong enough to call.`, thoughts, math };
    return { action: "call", dialogue: `"...call." ${playerName} thinks, then calls.`, reasoning: `${holding.details} Hard to fold this.`, thoughts, math };
  }
  if (strength === "good") {
    const betSize = snapToBB(pot * 0.5, maxBet);
    const frac = potFractionLabel(betSize, pot);
    math.push(`Made hand: ${hand.name}. Solid but vulnerable.`);
    math.push(`${frac} bet (${betSize} chips) — standard value sizing.`);
    appendOutsMath();
    if (toCall > 0) math.push(potOddsNote(pot, toCall));
    if (toCall === 0) { thoughts.push(`Decent hand. Bet for value but stay aware of the board texture.`); return { action: "bet", amount: betSize, dialogue: `"${betSize}." ${playerName} bets.`, reasoning: `${holding.details} ${frac} bet for value.`, thoughts, math }; }
    if (toCall <= pot * 0.5) { thoughts.push(`Facing a bet but the hand is strong enough to continue.`); return { action: "call", dialogue: `"Call." ${playerName} matches.`, reasoning: `${holding.details} Worth calling at this price.`, thoughts, math }; }
    thoughts.push(`Big bet to face. The hand is decent but there are better hands possible.`);
    return { action: "call", dialogue: `"...call." Reluctant but can't fold.`, reasoning: `${holding.details} Tough call but the hand is too good to fold.`, thoughts, math };
  }
  if (strength === "decent") {
    if (toCall === 0) {
      thoughts.push(`Marginal hand — check and see what happens.`);
      math.push(`Not strong enough to bet for value.`);
      appendOutsMath();
      return { action: "check", dialogue: `"Check." ${playerName} taps the table.`, reasoning: `${holding.details} Checking — not confident enough to bet.`, thoughts, math };
    }
    if (toCall <= pot * 0.25) {
      thoughts.push(`Small bet to call with a marginal hand. Worth seeing another card.`);
      math.push(`Pot is ${pot}, costs ${toCall}. Getting ${Math.round(pot / toCall)}:1 pot odds.`);
      math.push(potOddsNote(pot, toCall));
      appendOutsMath();
      return { action: "call", dialogue: `"I'll call." Small price to pay.`, reasoning: `${holding.details} Cheap call.`, thoughts, math };
    }
    thoughts.push(`Facing aggression with a marginal hand. Probably behind.`);
    math.push(potOddsNote(pot, toCall));
    math.push(`${holding.details} Not enough equity to justify ${toCall} into a ${pot} pot.`);
    appendOutsMath();
    return { action: "fold", dialogue: `"Fold." ${playerName} lets it go.`, reasoning: `${holding.details} Not worth the price.`, thoughts, math };
  }
  if (totalOuts >= 4) {
    math.push(`① Outs: ${totalOuts} (${[...improvementDesc, ...drawOutsDesc].join(", ")})`);
    math.push(`② Rule of ${multiplier}: ${totalOuts} × ${multiplier} = ${hitPct}% chance to hit`);
    if (hasBackdoorFlush) math.push(`Backdoor flush (runner-runner needed) — not counted in outs.`);
    if (toCall > 0) {
      const potAfterCall = pot + toCall;
      const potOddsPct = Math.round((toCall / potAfterCall) * 100);
      math.push(`③ Pot odds: ${toCall} to call ÷ (${pot} pot + ${toCall} call) = ${potOddsPct}% needed`);
      if (hitPct >= potOddsPct) { math.push(`④ ${hitPct}% ≥ ${potOddsPct}% → CALL is profitable long-term`); thoughts.push(`The math says call. Even though I'm behind now, the price is right.`); return { action: "call", dialogue: `"Call." ${playerName} counts the pot, does the math, calls.`, reasoning: `Drawing hand — pot odds justify it.`, thoughts, math }; }
      else { math.push(`④ ${hitPct}% < ${potOddsPct}% → FOLD saves money long-term`); thoughts.push(`The draw isn't worth it at this price.`); return { action: "fold", dialogue: `"Too rich for me." ${playerName} folds.`, reasoning: `Draw odds don't justify the call.`, thoughts, math }; }
    } else { math.push(`③ No bet to face — checking is free. Always take a free card with a draw.`); thoughts.push(`Free card — stay in and hope to hit.`); return { action: "check", dialogue: `"Check." ${playerName} taps the table.`, reasoning: `Drawing hand, free card.`, thoughts, math }; }
  }
  const bluffSeed = (playerIdx * 31 + board.length * 17 + pot) % 7;
  if (bluffSeed === 0 && toCall === 0 && currentBet === 0 && maxBet >= BB) { const betSize = snapToBB(pot * 0.6, maxBet); const frac = potFractionLabel(betSize, pot); thoughts.push(`Nothing in hand — but nobody else has bet either. Time to bluff.`); math.push(`Bluff: ${frac} bet (${betSize} chips) to win ${pot}. Only needs to work ${Math.round(betSize / (pot + betSize) * 100)}% of the time.`); return { action: "bet", amount: betSize, dialogue: `"${betSize}." ${playerName} bets.`, reasoning: `Bluff — ${frac} bet hoping the board scares everyone off.`, thoughts, math }; }
  if (toCall === 0) { thoughts.push(`Nothing worth betting, but it's free to stay in.`); math.push(`No meaningful outs. Checking because it costs nothing.`); return { action: "check", dialogue: `"Check." ${playerName} taps the table.`, reasoning: `${holding.details} Free to check.`, thoughts, math }; }
  math.push(potOddsNote(pot, toCall));
  math.push(`No made hand. ${totalOuts > 0 ? `Only ${totalOuts} outs — not enough.` : "No outs."} Folding.`);
  thoughts.push(`Nothing here. Fold and save the chips.`);
  return { action: "fold", dialogue: `"Fold." ${playerName} tosses the cards.`, reasoning: `${holding.details} Not worth it.`, thoughts, math };
}

// ═══════════════════════════════════════════
// BETTING ROUND
// ═══════════════════════════════════════════
function runBettingRound(
  order: number[],
  hands: CardObj[][],
  board: CardObj[],
  pot: number,
  folded: boolean[],
  street: string,
  stacks: number[],
  players: PlayerInfo[],
): { stages: Stage[]; pot: number; folded: boolean[]; stacks: number[] } {
  const stages: Stage[] = [];
  const bets = [0, 0, 0, 0];
  let currentBet = 0;
  const f = [...folded];
  let p = pot;
  const s = [...stacks];
  const needsAction = [false, false, false, false];
  order.forEach(i => { if (!f[i]) needsAction[i] = true; });
  let safety = 0, orderIdx = 0;
  while (needsAction.some(Boolean) && safety < 40) {
    safety++;
    const pi = order[orderIdx % order.length];
    orderIdx++;
    if (!needsAction[pi] || f[pi]) { needsAction[pi] = false; continue; }
    if (s[pi] <= 0) { needsAction[pi] = false; continue; } // all-in, can't act
    if (f.filter(x => !x).length <= 1) break;
    const decision = generateFullDecision(pi, hands[pi], board, p, currentBet, bets[pi], street, false, players[pi].name, players[pi].pos, s[pi]);
    needsAction[pi] = false;
    if (decision.action === "fold") {
      f[pi] = true;
    } else if (decision.action === "call") {
      const cost = Math.min(currentBet - bets[pi], s[pi]);
      p += cost; s[pi] -= cost; bets[pi] += cost;
    } else if (decision.action === "bet" || decision.action === "raise") {
      const desired = Math.round(decision.amount != null ? decision.amount : currentBet * 2);
      const maxCommit = s[pi] + bets[pi];
      const newBet = Math.min(desired, maxCommit);
      const additional = newBet - bets[pi];
      if (additional > 0 && newBet > currentBet) {
        p += additional; s[pi] -= additional; bets[pi] = newBet; currentBet = newBet;
        order.forEach(j => { if (j !== pi && !f[j]) needsAction[j] = true; });
      } else {
        // Degenerate bet (0 or below current bet) — treat as call
        const cost = Math.min(currentBet - bets[pi], s[pi]);
        if (cost > 0) { p += cost; s[pi] -= cost; bets[pi] += cost; }
      }
    }
    stages.push({ type: "action", street, playerIdx: pi, board: [...board], pot: p, bets: [...bets], folded: [...f], decision, currentBet, stacks: [...s] });
  }
  return { stages, pot: p, folded: f, stacks: s };
}

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
function PlayingCard({ card, dimmed, size = "sm", placeholder }: { card?: CardObj; dimmed?: boolean; size?: "sm" | "md" | "lg"; placeholder?: boolean; }) {
  const D = size === "sm" ? { w: 30, h: 42, rank: 12, suit: 12 } : size === "md" ? { w: 38, h: 54, rank: 15, suit: 16 } : { w: 48, h: 68, rank: 18, suit: 22 };
  if (placeholder) {
    return <div style={{ width: D.w, height: D.h, borderRadius: T.radius, background: "transparent", border: `1px dashed ${T.hair}`, flexShrink: 0, opacity: 0.55 }} />;
  }
  const color = T.suitColors[card!.suit];
  return (
    <div style={{ width: D.w, height: D.h, background: T.cardBg, border: `1px solid ${T.cardBorder}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, flexShrink: 0, opacity: dimmed ? 0.32 : 1, fontFamily: T.mono, color, borderRadius: 0 }}>
      <span style={{ fontSize: D.rank, fontWeight: 600, lineHeight: 1 }}>{card!.rank}</span>
      <span style={{ fontSize: D.suit, lineHeight: 1 }}>{card!.suit}</span>
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
function FeedEntry({ s, isFocused, compact, players }: { s: Stage; isFocused: boolean; compact?: boolean; players: PlayerInfo[] }) {
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

    if (compact && !isFocused) {
      return (
        <div style={{ padding: "7px 14px", background: "transparent", borderBottom: `1px solid ${T.hairSoft}`, display: "flex", alignItems: "center", gap: 8, opacity: 0.65 }}>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, width: 28 }}>{player.posShort}</span>
          <span style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft, flex: 1, fontWeight: 500 }}>{player.name}</span>
          <Badge action={d.action} />
        </div>
      );
    }

    return (
      <article style={{ padding: "12px 14px 14px", background: isFocused ? T.focus : "transparent", borderLeft: isFocused ? `2px solid ${T.accent}` : "2px solid transparent", borderBottom: `1px solid ${T.hairSoft}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
            <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 600, color: T.ink }}>{player.name}</span>
            <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{player.posShort}</span>
          </div>
          <Badge action={d.action} />
        </div>
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
          {s.foldWin ? `${winnerName} wins — everyone else folded.` : `${winnerName} wins with ${winningHand}.`}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, marginBottom: s.rankedResults && s.rankedResults.length > 1 ? 10 : 0 }}>
          Takes the {s.pot}-chip pot.
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
function TrainingPrompt({ stage, players, onChoice }: { stage: Stage; players: PlayerInfo[]; onChoice: (action: string) => void }) {
  const player = players[stage.playerIdx!];
  const toCall = (stage.currentBet || 0) - (stage.bets?.[stage.playerIdx!] || 0);
  const actions = toCall > 0 ? ["fold", "call", "raise"] : ["check", "bet"];
  return (
    <div style={{ padding: "16px 14px 18px", background: T.focus, borderBottom: `1px solid ${T.hair}` }}>
      <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: T.accent, marginBottom: 8 }}>Your decision</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 6 }}>
        <span style={{ fontFamily: T.mono, fontSize: 15, fontWeight: 600, color: T.ink }}>{player.name}</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{player.posShort}</span>
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft, marginBottom: 14, lineHeight: 1.4 }}>
        {toCall > 0
          ? <>{toCall} to call into a <span style={{ color: T.accent }}>{stage.pot}</span> pot.</>
          : <>No bet to face — first to act. Pot is <span style={{ color: T.accent }}>{stage.pot}</span>.</>
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
// MAIN COMPONENT
// ═══════════════════════════════════════════
export default function PokerSim() {
  const [gs, setGs] = useState<{ hands: CardObj[][]; board: CardObj[] } | null>(null);
  const [step, setStep] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [mode, setMode] = useState<"focused" | "dense">("focused");
  const [isDesktop, setIsDesktop] = useState(false);
  const [dealerIdx, setDealerIdx] = useState(3); // Dan starts as BTN, rotates each hand
  const [startingStacks, setStartingStacks] = useState([200, 200, 200, 200]);
  const [trainingMode, setTrainingMode] = useState(false);
  const [userChoices, setUserChoices] = useState<Record<number, string>>({});
  const [handScore, setHandScore] = useState({ matches: 0, total: 0 });
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

  // Stable refs for keyboard handler
  const trainingRef = useRef(false);
  const userChoicesRef = useRef<Record<number, string>>({});
  const stepRef = useRef(0);
  trainingRef.current = trainingMode;
  userChoicesRef.current = userChoices;
  stepRef.current = step;

  // Keyboard navigation — stable listener via refs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const len = stagesRef.current.length;
      const curStage = stagesRef.current[stepRef.current];
      const needsChoice = trainingRef.current && curStage?.type === "action" && curStage?.decision?.action !== "already_folded" && !userChoicesRef.current[stepRef.current];
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

  useEffect(() => {
    if (mode === "dense" && feedRef.current) {
      const el = feedRef.current.querySelector(`[data-step="${step}"]`);
      if (el) el.scrollIntoView({ block: "center", inline: "nearest" });
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
    setHandScore({ matches: 0, total: 0 });
    const deck = shuffle(makeDeck());
    const hands = [[deck[0], deck[1]], [deck[2], deck[3]], [deck[4], deck[5]], [deck[6], deck[7]]];
    const board = [deck[8], deck[9], deck[10], deck[11], deck[12]];
    setGs({ hands, board });
    setStep(0);
  }, []);

  const handleChoice = useCallback((action: string) => {
    const aiAction = stagesRef.current[step]?.decision?.action;
    if (!aiAction || aiAction === "already_folded") return;
    const aggressive = ["bet", "raise"];
    const isMatch = action === aiAction || (aggressive.includes(action) && aggressive.includes(aiAction));
    setUserChoices(c => ({ ...c, [step]: action }));
    setHandScore(s => ({ matches: s.matches + (isMatch ? 1 : 0), total: s.total + 1 }));
  }, [step]);

  const stages = useMemo((): Stage[] => {
    if (!gs) return [];
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

    // Preflop: UTG first, then BTN, SB, BB
    const preflopOrder = [utgIdx, btnIdx, sbIdx, bbIdx];
    const preflopBets = [0, 0, 0, 0];
    preflopBets[sbIdx] = SB;
    preflopBets[bbIdx] = BB;
    let preflopCurrentBet = BB;
    const pfStages: Stage[] = [];
    let pfPot = pot;
    let pfFolded = [...folded];
    const pfNeeds = [false, false, false, false];
    preflopOrder.forEach(i => { if (!pfFolded[i]) pfNeeds[i] = true; });
    let pfSafety = 0, pfIdx = 0;
    while (pfNeeds.some(Boolean) && pfSafety < 40) {
      pfSafety++;
      const pi = preflopOrder[pfIdx % preflopOrder.length]; pfIdx++;
      if (!pfNeeds[pi] || pfFolded[pi]) { pfNeeds[pi] = false; continue; }
      const dec = generateFullDecision(pi, hands[pi], [], pfPot, preflopCurrentBet, preflopBets[pi], "preflop", false, players[pi].name, players[pi].pos, stacks[pi]);
      pfNeeds[pi] = false;
      if (dec.action === "fold") {
        pfFolded[pi] = true;
      } else if (dec.action === "call") {
        const cost = Math.min(preflopCurrentBet - preflopBets[pi], stacks[pi]);
        pfPot += cost; stacks[pi] -= cost; preflopBets[pi] += cost;
      } else if (dec.action === "raise") {
        const desired = Math.round(dec.amount != null ? dec.amount : preflopCurrentBet * 2);
        const maxCommit = stacks[pi] + preflopBets[pi];
        const newBet = Math.min(desired, maxCommit);
        const additional = newBet - preflopBets[pi];
        if (additional > 0 && newBet > preflopCurrentBet) {
          pfPot += additional; stacks[pi] -= additional; preflopBets[pi] = newBet; preflopCurrentBet = newBet;
          preflopOrder.forEach(j => { if (j !== pi && !pfFolded[j]) pfNeeds[j] = true; });
        } else {
          const cost = Math.min(preflopCurrentBet - preflopBets[pi], stacks[pi]);
          if (cost > 0) { pfPot += cost; stacks[pi] -= cost; preflopBets[pi] += cost; }
        }
      }
      pfStages.push({ type: "action", street: "preflop", playerIdx: pi, board: [], pot: pfPot, bets: [...preflopBets], folded: [...pfFolded], decision: dec, currentBet: preflopCurrentBet, stacks: [...stacks] });
    }
    all.push(...pfStages);
    pot = pfPot; folded = pfFolded;

    // Postflop: SB first, then BB, UTG, BTN
    const postflopOrder = [sbIdx, bbIdx, utgIdx, btnIdx];
    const streets = [{ name: "flop", n: 3 }, { name: "turn", n: 4 }, { name: "river", n: 5 }];
    for (const { name, n } of streets) {
      if (folded.filter(f => !f).length <= 1) break;
      const curBoard = board.slice(0, n);
      const streetLabel = name === "flop" ? `Flop — ${curBoard.map(cardStr).join("  ")}` : `${name.charAt(0).toUpperCase() + name.slice(1)} — ${cardStr(board[n - 1])}`;
      const notes: Record<string, string> = { flop: "Three community cards dealt. New betting round begins.", turn: "Fourth card. Outs now use Rule of 2.", river: "Final card. No more outs." };
      all.push({ type: "street", street: name, title: streetLabel, note: notes[name], board: curBoard, pot, folded: [...folded], stacks: [...stacks] });
      const result = runBettingRound(postflopOrder, hands, curBoard, pot, folded, name, stacks, players);
      all.push(...result.stages);
      pot = result.pot; folded = result.folded; stacks = result.stacks;
    }

    if (folded.filter(f => !f).length > 1) {
      const finalBoard = board.slice(0, 5);
      const results = hands.map((h, i) => folded[i] ? { idx: i, folded: true, hand: null } : { idx: i, folded: false, hand: bestHand(h, finalBoard) });
      const active = results.filter(r => !r.folded).sort((a, b) => { if (a.hand!.rank !== b.hand!.rank) return b.hand!.rank - a.hand!.rank; return cmpK(b.hand!.kickers, a.hand!.kickers); });
      const winner = active[0].idx;
      stacks[winner] += pot;
      all.push({ type: "showdown", board: finalBoard, pot, folded: [...folded], results, rankedResults: active, winner, stacks: [...stacks] });
    } else {
      const w = folded.findIndex(f => !f);
      if (w >= 0) {
        stacks[w] += pot;
        all.push({ type: "showdown", board: all[all.length - 1]?.board || [], pot, folded: [...folded], results: [], rankedResults: [], winner: w, foldWin: true, stacks: [...stacks] });
      }
    }
    return all;
  }, [gs, dealerIdx, startingStacks, players]);

  // Keep ref in sync for keyboard handler
  stagesRef.current = stages;

  const cur = stages[step];
  const visible = stages.slice(0, step + 1);
  const showBoard = cur?.board || [];
  const isEnd = step >= stages.length - 1;

  // ── Shared sub-sections ──────────────────────────────────────────

  const masthead = (
    <header style={{ paddingBottom: 12, borderBottom: `1px solid ${T.ink}`, marginBottom: 14 }}>
      <h1 style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em", textTransform: "uppercase", lineHeight: 1, margin: "0 0 5px", color: T.ink }}>
        HOLD&apos;EM TRAINER
      </h1>
      <p style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft, margin: 0, lineHeight: 1.4 }}>
        &gt; step through every decision
      </p>
    </header>
  );

  const rulesToggle = (
    <section style={{ marginBottom: 12 }}>
      <button onClick={() => setShowRules(!showRules)} style={{ width: "100%", padding: "8px 10px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", background: "transparent", color: T.ink, border: `1px solid ${T.hair}`, borderRadius: T.radius, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Rules &amp; Glossary</span>
        <span style={{ color: T.dim }}>{showRules ? "[–]" : "[+]"}</span>
      </button>
      {showRules && (
        <div style={{ marginTop: 6, padding: "10px 12px", background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius, maxHeight: 220, overflowY: "auto" }}>
          {RULES.map((r, i) => (
            <div key={i} style={{ paddingBottom: i < RULES.length - 1 ? 6 : 0, marginBottom: i < RULES.length - 1 ? 6 : 0, borderBottom: i < RULES.length - 1 ? `1px solid ${T.hairSoft}` : "none", display: "grid", gridTemplateColumns: "100px 1fr", gap: 8, alignItems: "baseline" }}>
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

  const stepCounter = (
    <span style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim }}>
      Step {step + 1} / {stages.length}
    </span>
  );

  const modeToggle = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <div style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
        {(["focused", "dense"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{ padding: "4px 9px", fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", background: mode === m ? T.ink : "transparent", color: mode === m ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
            {m}
          </button>
        ))}
      </div>
      <InfoTip text="Focused: current decision shown in full, with a compact trail of prior moves above. Dense: every decision expanded in full." />
    </div>
  );

  const playerGrid = gs && (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginBottom: 8 }}>
      {players.map((p, i) => {
        const isFolded = cur?.folded?.[i];
        const isActing = cur?.type === "action" && cur?.playerIdx === i;
        const isWinner = cur?.type === "showdown" && cur?.winner === i;
        const stack = cur?.stacks?.[i] ?? startingStacks[i];
        return (
          <div key={i} style={{ padding: "6px 5px 7px", background: isWinner ? T.panelAlt : isActing ? T.focus : T.panel, border: `1px solid ${isWinner ? T.accent : isActing ? T.ink : T.hair}`, borderRadius: T.radius }}>
            <div style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color: T.ink, lineHeight: 1, marginBottom: 1 }}>{p.name}</div>
            <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim, letterSpacing: "0.12em", textTransform: "uppercase", lineHeight: 1, marginBottom: 5 }}>{p.posShort}</div>
            <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
              <PlayingCard card={gs.hands[i][0]} dimmed={isFolded} size="sm" />
              <PlayingCard card={gs.hands[i][1]} dimmed={isFolded} size="sm" />
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.accent, textAlign: "center", marginTop: 3, lineHeight: 1 }}>{stack}</div>
            {isFolded && <div style={{ marginTop: 2, fontFamily: T.mono, fontSize: 8.5, color: T.dim, letterSpacing: "0.14em", textTransform: "uppercase", textAlign: "center", lineHeight: 1 }}>folded</div>}
            {isWinner && <div style={{ marginTop: 2, fontFamily: T.mono, fontSize: 8.5, color: T.accent, letterSpacing: "0.14em", textTransform: "uppercase", textAlign: "center", lineHeight: 1, fontWeight: 700 }}>winner</div>}
            {isActing && !isFolded && !isWinner && <div style={{ marginTop: 2, fontFamily: T.mono, fontSize: 8.5, color: T.ink, letterSpacing: "0.14em", textTransform: "uppercase", textAlign: "center", lineHeight: 1, fontWeight: 700 }}>acting</div>}
            {!isFolded && !isWinner && !isActing && <div style={{ marginTop: 2, height: 9.5 }} />}
            {cur?.type === "showdown" && !isFolded && !cur.foldWin && (() => {
              const r = cur.results?.find(r => r.idx === i);
              return r?.hand ? <div style={{ fontFamily: T.mono, fontSize: 9.5, color: isWinner ? T.accent : T.inkSoft, marginTop: 2, textAlign: "center", lineHeight: 1.2 }}>{r.hand.name}</div> : null;
            })()}
          </div>
        );
      })}
    </div>
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

  const trainToggle = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <div style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
        {(["observe", "train"] as const).map(m => {
          const active = trainingMode ? "train" : "observe";
          return (
            <button key={m} onClick={() => { setTrainingMode(m === "train"); setUserChoices({}); setHandScore({ matches: 0, total: 0 }); }} style={{ padding: "4px 9px", fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", background: active === m ? T.accent : "transparent", color: active === m ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
              {m}
            </button>
          );
        })}
      </div>
      <InfoTip text="Observe: watch the AI reason through every decision. Train: make your choice first, then see if the AI agreed." />
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
    const needsChoice = trainingMode && isActionStep && !userChoices[step];
    const userChoice = userChoices[step];
    const aiAction = cur?.decision?.action;
    const containerStyle = desktopFill ? { flex: 1, overflowY: "auto" as const } : { maxHeight: 400, overflowY: "auto" as const };

    return (
      <>
        <div style={{ marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {trainingMode && gs && handScore.total > 0 && (
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.accent, fontWeight: 600, letterSpacing: "0.04em" }}>
                {handScore.matches}/{handScore.total}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {!trainingMode && modeToggle}
            {trainToggle}
          </div>
        </div>

        <div ref={needsChoice ? undefined : (trainingMode || mode === "focused" ? focusedRef : feedRef)}
          style={{ background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius, ...containerStyle }}>

          {/* History trail — always compact in training mode */}
          {(trainingMode || mode === "focused") && visible.slice(Math.max(0, step - 4), step).map((s, i) => (
            <FeedEntry key={Math.max(0, step - 4) + i} s={s} isFocused={false} compact players={players} />
          ))}

          {/* Dense mode history (non-training) */}
          {!trainingMode && mode === "dense" && visible.slice(0, step).map((s, i) => (
            <div key={i} data-step={i}>
              <FeedEntry s={s} isFocused={false} players={players} />
            </div>
          ))}

          {/* Current step */}
          {cur && needsChoice && (
            <TrainingPrompt stage={cur} players={players} onChoice={handleChoice} />
          )}
          {cur && !needsChoice && (
            <>
              {trainingMode && userChoice && aiAction && isActionStep && (
                <ComparisonBanner userAction={userChoice} aiAction={aiAction} />
              )}
              <FeedEntry s={cur} isFocused players={players} />
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
        const needsChoice = trainingMode && cur?.type === "action" && cur?.decision?.action !== "already_folded" && !userChoices[step];
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
                <div style={{ marginBottom: 10 }}>
                  {stepCounter}
                </div>
                {playerGrid}
                {board}
              </>
            )}
          </div>
          {navBar()}
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
            {rulesToggle}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              {stepCounter}
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
    </div>
  );
}
