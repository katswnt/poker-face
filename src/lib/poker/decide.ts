// Decision engine — board/holding analysis and the full per-spot decision.
//
// Extracted from the component so the actual DECISIONS (not just their primitives) are
// unit-testable. The whole module is pure and UI-free: given a spot it returns a Decision
// with dialogue, reasoning, thoughts, and the math trail. It reasons with a hand-tier
// preflop model and Monte Carlo equity postflop — a disciplined heuristic baseline, not a
// GTO solver (see README "Is this GTO?").
import type { CardObj, BoardAnalysis, HoldingResult, Decision } from "./types";
import { SUITS, SUIT_NAMES, RS, BB, cv, ck, cardStr, valName, valNameL, valShort } from "./cards";
import { bestHand } from "./eval";
import { preflopHandTier, preflopThresholds } from "./ranges";
import { monteCarloEquity, equityStandardError } from "./equity";

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
export function assessThreats(ba: BoardAnalysis | null): string[] {
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
export function potOddsNote(pot: number, toCall: number): string {
  const potAfter = pot + toCall;
  const pct = Math.round((toCall / potAfter) * 100);
  return `Pot odds: ${toCall} to call into ${potAfter} total pot → need ${pct}% equity to break even.`;
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
