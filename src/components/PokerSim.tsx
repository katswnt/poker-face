"use client";

import { createContext, useState, useCallback, useContext, useId, useMemo, useRef, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTrainerTask } from "./useTrainerTask";
import { BB, SUIT_NAMES, makeDeck, shuffle, valNameL } from "@/lib/poker/cards";
import { snapToBB, analyzeBoard, POS_SHORT } from "@/lib/poker/decide";
import type { CardObj, Decision, LegalActions, PlayerInfo, Stage } from "@/lib/poker/types";

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
const PLAYER_NAMES = ["Alice", "Bob", "Carol", "Dan"];
// Position assigned by offset from dealer index
const POSITIONS_ORDER = ["Dealer", "Small Blind", "Big Blind", "UTG"];
const EMPTY_STAGES: Stage[] = [];

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
export type ChoiceGrade = "model" | "different" | "costly" | "illegal";
interface SessionEntry { hand: number; heroActionId: number; street: string; position: string; heroAction: string; aiAction: string; wasMatch: boolean; grade: ChoiceGrade; aiReasoning: string; }

type LanguageMode = "plain" | "poker";
const LanguageContext = createContext<LanguageMode>("plain");
const LANGUAGE_STORAGE_KEY = "poker-face-language";
const LANGUAGE_CHANGE_EVENT = "poker-face-language-change";

function readLanguage(): LanguageMode {
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "poker" ? "poker" : "plain";
}

function subscribeToLanguage(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LANGUAGE_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(LANGUAGE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LANGUAGE_CHANGE_EVENT, onChange);
  };
}

const TERM_DEFINITIONS: Record<string, string> = {
  "monte carlo": "random-deal estimate",
  "standard error": "one measure of random sampling variation",
  "implied odds": "possible future winnings",
  "fold equity": "chance everyone else folds",
  "pot odds": "share needed to call",
  "expected value": "average chips gained or lost",
  "semi-bluff": "bet with a hand that can still improve",
  "out of position": "acting earlier",
  "in position": "acting later",
  "variance": "short-term swings",
  "equity": "expected share of the pot",
  "outs": "cards that can improve the hand",
  "range": "group of possible hands",
  "value bet": "bet with a strong estimate",
  "thin value": "small bet with a slight estimated edge",
  "3-bet": "raise after one earlier raise",
  "4-bet": "raise after two earlier raises",
};

const TERM_PATTERN = new RegExp(`\\b(${Object.keys(TERM_DEFINITIONS).sort((a, b) => b.length - a.length).join("|")})\\b`, "gi");

function ExplainedTerm({ poker, plain }: { poker: string; plain: string }) {
  const language = useContext(LanguageContext);
  const [showPlain, setShowPlain] = useState(false);
  const tooltipId = useId();
  if (language === "plain") return <>{plain}</>;
  const visible = showPlain ? plain : poker;
  const help = showPlain ? `Poker term: ${poker}. Click to switch back.` : `Plain meaning: ${plain}. Click to replace this term.`;
  return (
    <span className="explained-term">
      <button
        type="button"
        className="explained-term-button"
        aria-describedby={tooltipId}
        aria-pressed={showPlain}
        onClick={() => setShowPlain(value => !value)}
      >
        {visible}
      </button>
      <span id={tooltipId} role="tooltip" className="explained-term-tooltip">{help}</span>
    </span>
  );
}

function PlainCopy({ children }: { children: string }) {
  const parts = children.split(TERM_PATTERN);
  return <>{parts.map((part, index) => {
    const plain = TERM_DEFINITIONS[part.toLowerCase()];
    return plain ? <ExplainedTerm key={`${part}-${index}`} poker={part} plain={plain} /> : <span key={index}>{part}</span>;
  })}</>;
}

export interface SeatSettlement {
  won: number;
  returned: number;
}

function isUncalledReturn(layer: NonNullable<Stage["pots"]>[number]): boolean {
  return layer.contributors.length === 1
    && layer.awards.every(award => award.idx === layer.contributors[0]);
}

// A payout can contain two very different things: chips won from other players
// and unmatched chips returned to their owner. Keeping them separate prevents
// the UI and hand review from treating a refund as a poker win.
export function showdownSeatSettlements(showdown: Stage, seatCount = showdown.folded.length): SeatSettlement[] {
  const settlements = Array.from({ length: seatCount }, () => ({ won: 0, returned: 0 }));
  // Fold wins carry pot layers too, so an unmatched blind or bet above the survivor's
  // stake shows as returned. Only records saved without layers fall back to the pot.
  if (showdown.foldWin && showdown.winner !== undefined && !showdown.pots?.length) {
    settlements[showdown.winner].won = showdown.pot;
    return settlements;
  }
  if (showdown.pots?.length) {
    for (const layer of showdown.pots) {
      const field: keyof SeatSettlement = isUncalledReturn(layer) ? "returned" : "won";
      for (const award of layer.awards) settlements[award.idx][field] += award.amount;
    }
    return settlements;
  }
  for (let idx = 0; idx < seatCount; idx++) settlements[idx].won = showdown.payouts?.[idx] ?? 0;
  return settlements;
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
  { t: "Raise", d: "Increase someone else's bet. A full raise reopens raising; a short all-in may only change the price." },
  { t: "Fold", d: "Give up your hand. Lose what you've put in, risk nothing more." },
  { t: "Position", d: "Where you sit relative to the dealer. Acting later (closer to BTN) is a structural advantage — you see more information before committing chips." },
  { t: "BTN / Button", d: "Acts last after the flop, seeing the other players' choices before deciding. Rotates clockwise each hand." },
  { t: "UTG", d: "Under the Gun — first to act before the flop, with no earlier choice to observe." },
  { t: "SB", d: "Small Blind — posts half the BB, acts second-to-last preflop, first postflop. Worst postflop position." },
  { t: "BB", d: "Big Blind — posts the full BB and often closes the first betting round. Acts early after the flop." },
  { t: "In Position", d: "Acting after your opponent. You commit chips after seeing what they do — a major information edge." },
  { t: "Out of Position", d: "Acting before another player. They see your choice before making theirs." },
  { t: "Flop", d: "First 3 community cards, dealt together." },
  { t: "Turn", d: "4th community card. Outs now multiply by 2, not 4." },
  { t: "River", d: "5th and final card. You have it or you don't." },
  { t: "Pot", d: "All chips bet this hand. Main and side pots are awarded separately, and tied pots are split." },
  { t: "Outs", d: "Cards left in the deck that improve your hand." },
  { t: "Rule of 2 & 4", d: "Outs × 4 on the flop or × 2 on the turn gives a quick estimate of the chance to improve." },
  { t: "Pot Odds", d: "The share of the final pot you pay to call. Pay 20 toward a final pot of 100, and you need an average share of at least 20 of those chips over many deals." },
  { t: "Kicker", d: "Side card that breaks ties between equal pairs." },
  { t: "Top/Mid/Bot Pair", d: "Which board card your hole card matches." },
  { t: "Set", d: "Trips using a pocket pair + board card. Hidden and powerful." },
  { t: "Trips", d: "Three of a kind using a board pair + your card." },
  { t: "Board Pair", d: "Everyone may use a pair on the board, but hole cards can still make a stronger hand." },
  { t: "Flush Draw", d: "4 cards of one suit, need the 5th." },
  { t: "OESD", d: "Open-ended straight draw — 4 in a row, 8 outs." },
  { t: "Gutshot", d: "Need one rank in the middle for a straight. 4 outs." },
  { t: "Dirty Outs", d: "Cards that help you but might help someone else more." },
  { t: "C-bet", d: "Continuation bet — preflop raiser bets the flop." },
  { t: "Bluff", d: "Betting weak to make opponents fold." },
  { t: "Showdown", d: "Everyone remaining shows. Each pot goes to the best eligible 5-card hand; ties split it." },
];

// ═══════════════════════════════════════════
// UI: Playing Card
// ═══════════════════════════════════════════
function PlayingCard({ card, dimmed, size = "sm", placeholder, faceDown }: { card?: CardObj; dimmed?: boolean; size?: "sm" | "md" | "lg"; placeholder?: boolean; faceDown?: boolean; }) {
  const D = size === "sm" ? { w: 30, h: 42, rank: 12, suit: 12 } : size === "md" ? { w: 38, h: 54, rank: 15, suit: 16 } : { w: 48, h: 68, rank: 18, suit: 22 };
  if (placeholder) {
    return <div aria-hidden="true" style={{ width: D.w, height: D.h, borderRadius: T.radius, background: "transparent", border: `1px dashed ${T.hair}`, flexShrink: 0, opacity: 0.55 }} />;
  }
  if (faceDown) {
    return (
      <div role="img" aria-label="Face-down card" style={{ width: D.w, height: D.h, background: T.cardBg, border: `1px solid ${T.cardBorder}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 0 }}>
        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          {(["♠","♣","♥","♦"] as const).map(s => (
            <span key={s} style={{ fontFamily: T.mono, fontSize: Math.round(D.suit * 0.62), color: "#2a2e34", lineHeight: 1, textAlign: "center" as const }}>{s}</span>
          ))}
        </div>
      </div>
    );
  }
  if (!card) return <div aria-hidden="true" style={{ width: D.w, height: D.h, flexShrink: 0 }} />;
  const color = T.suitColors[card.suit];
  return (
    <div role="img" aria-label={`${card.rank} of ${SUIT_NAMES[card.suit]}`} style={{ width: D.w, height: D.h, background: T.cardBg, border: `1px solid ${T.cardBorder}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, flexShrink: 0, opacity: dimmed ? 0.32 : 1, fontFamily: T.mono, color, borderRadius: 0 }}>
      <span aria-hidden="true" style={{ fontSize: D.rank, fontWeight: 600, lineHeight: 1 }}>{card.rank}</span>
      <span aria-hidden="true" style={{ fontSize: D.suit, lineHeight: 1 }}>{card.suit}</span>
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
        <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkSoft, lineHeight: 1.5 }}><PlainCopy>{s.description || s.note || ""}</PlainCopy></div>
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

    const toCallCtx = s.callQuote?.callCost ?? Math.max(0, (s.currentBet ?? 0) - (s.bets?.[s.playerIdx ?? 0] ?? 0));
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
          <span style={{ color: T.accent, fontSize: 12, lineHeight: 1.4, fontFamily: T.mono }}>{"//"}</span>
          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft, lineHeight: 1.5, flex: 1 }}><PlainCopy>{d.reasoning}</PlainCopy></div>
        </div>
        {d.thoughts && d.thoughts.length > 0 && (
          <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(125,211,160,0.05)", border: `1px solid ${T.hairSoft}`, borderRadius: T.radius }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 5 }}>Inner thoughts</div>
            {d.thoughts.map((t, ti) => (
              <div key={ti} style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkSoft, lineHeight: 1.55, marginBottom: ti < d.thoughts.length - 1 ? 4 : 0 }}><PlainCopy>{t}</PlainCopy></div>
            ))}
          </div>
        )}
        {d.math && d.math.length > 0 && (
          <div style={{ marginTop: 7, padding: "8px 10px", background: "rgba(125,211,160,0.06)", border: `1px solid ${T.hair}`, borderRadius: T.radius }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.accent, marginBottom: 5 }}>The math</div>
            {d.math.map((m, mi) => (
              <div key={mi} style={{ fontFamily: T.mono, fontSize: 11, color: T.ink, lineHeight: 1.55, marginBottom: mi < d.math.length - 1 ? 2 : 0 }}><PlainCopy>{m}</PlainCopy></div>
            ))}
          </div>
        )}
      </article>
    );
  }

  if (s.type === "showdown") {
    const winnerName = players[s.winner!].name;
    const settlements = showdownSeatSettlements(s, players.length);
    const potWinners = settlements.map((settlement, idx) => ({ idx, ...settlement })).filter(({ won }) => won > 0);
    const soleWinner = potWinners.length === 1 ? potWinners[0] : null;
    const soleHand = soleWinner ? s.results?.find(r => r.idx === soleWinner.idx)?.hand?.name : null;
    const returned = settlements.map((settlement, idx) => ({ idx, amount: settlement.returned })).filter(({ amount }) => amount > 0);
    const returnedSummary = returned.length > 0
      ? ` ${returned.map(({ idx, amount }) => `${players[idx].name} gets ${amount} uncalled chip${amount === 1 ? "" : "s"} back.`).join(" ")}`
      : "";
    const contestedLayers = s.pots?.filter(layer => !isUncalledReturn(layer)) ?? [];
    return (
      <div style={{ padding: "14px", background: T.panelAlt, borderTop: `2px solid ${T.accent}`, borderBottom: `1px solid ${T.hair}` }}>
        <div style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: T.accent, marginBottom: 5 }}>Showdown</div>
        <div style={{ fontFamily: T.mono, fontSize: 17, fontWeight: 600, color: T.ink, lineHeight: 1.25, marginBottom: 4 }}>
          {s.foldWin ? `${winnerName} wins — everyone else folded.` : soleWinner ? `${players[soleWinner.idx].name} wins with ${soleHand}.` : `Contested pots paid to ${potWinners.map(({ idx }) => players[idx].name).join(" and ")}.`}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, marginBottom: s.rankedResults && s.rankedResults.length > 1 ? 10 : 0 }}>
          {s.foldWin ? `Takes the ${settlements[s.winner!].won}-chip pot.${returnedSummary}` : soleWinner ? `Wins ${soleWinner.won} contested chips.${returnedSummary}` : `${potWinners.reduce((sum, seat) => sum + seat.won, 0)} contested chips awarded.${returnedSummary}`}
        </div>
        {!s.foldWin && s.pots && s.pots.length > 0 && (
          <div style={{ padding: "8px 0", borderTop: `1px solid ${T.hairSoft}` }}>
            {s.pots.map((layer, index) => {
              const isReturn = isUncalledReturn(layer);
              const contestedIndex = contestedLayers.indexOf(layer);
              const label = isReturn ? "Uncalled chips" : contestedIndex === 0 ? "Main pot" : `Side pot ${contestedIndex}`;
              const awards = layer.awards.map(award => `${players[award.idx].name} +${award.amount} ${isReturn ? "returned" : "won"}`).join(" · ");
              return (
                <div key={`${label}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: T.mono, fontSize: 10.5, lineHeight: 1.8 }}>
                  <span style={{ color: T.dim }}>{label} · {layer.amount}</span>
                  <span style={{ color: T.inkSoft, textAlign: "right" }}>{awards}</span>
                </div>
              );
            })}
          </div>
        )}
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
              return <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, marginTop: 6 }}>Top hands are identical.</div>;
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
export function positionTeachingNote(position: string, isPreflop: boolean): string {
  if (isPreflop) {
    if (position === "Dealer") return "Button — acts after UTG and before the blinds. After the flop, the Button acts last, so this trainer plays one of its wider starting groups here.";
    if (position === "Small Blind") return "Small Blind — acts after the Button before the flop, then acts first after the flop.";
    if (position === "Big Blind") return "Big Blind — has already paid the largest blind and often closes the first betting round. After the flop, the Big Blind acts early.";
    return "UTG — first to act before the flop. With no one else's choice to observe, this trainer uses a tighter starting group.";
  }
  if (position === "Dealer") return "Button — acts last after the flop, so it sees the other players' choices before deciding.";
  if (position === "Small Blind") return "Small Blind — acts first after the flop and must decide before seeing what the others do.";
  if (position === "Big Blind") return "Big Blind — acts early after the flop, after the Small Blind and before UTG and the Button.";
  return "UTG — acts after the blinds and before the Button after the flop.";
}

export function boardTeachingNote(board: CardObj[]): string | null {
  const ba = board.length > 0 ? analyzeBoard(board) : null;
  if (!ba) return null;
  const repeatedRank = ba.trips[0];
  const repeatedCount = repeatedRank === undefined ? 0 : ba.vals.filter(v => v === repeatedRank).length;
  if (repeatedCount === 4) return `Four ${valNameL(repeatedRank)}s are on the board — everyone has four of a kind, so the highest remaining card decides.`;
  if (repeatedCount === 3) return `Three ${valNameL(repeatedRank)}s are on the board — full houses and four of a kind are possible.`;
  if (ba.pairs.length > 0 && ba.madeFlushPossible) return "The board is paired and has three cards of one suit — flushes, three of a kind, and full houses are possible.";
  if (ba.pairs.length > 0) return "The board is paired — three of a kind and full houses are possible.";
  if (ba.madeFlushPossible) return `${ba.flushCount} cards share a suit — a flush is already possible.`;
  if (ba.cardsToCome === 0 && ba.straightDanger) return "The river is connected — a straight is possible, and no cards remain to be dealt.";
  if (ba.cardsToCome === 0) return "The river is complete — no cards remain to be dealt.";
  if (ba.straightDanger && ba.flushDrawPossible) return "The board has possible straight and flush draws.";
  if (ba.straightDanger) return "The connected cards make straight draws possible.";
  if (ba.flushDrawPossible) return "Two cards share a suit, so a flush can still be completed.";
  return "There are few obvious straight or flush draws, but later cards can still change who is ahead.";
}

function PreDecisionStrip({ stage, players }: { stage: Stage; players: PlayerInfo[] }) {
  const player = players[stage.playerIdx!];
  const toCall = stage.callQuote?.callCost ?? Math.max(0, (stage.currentBet ?? 0) - (stage.bets?.[stage.playerIdx!] ?? 0));
  const isPreflop = stage.street === "preflop";
  const posNote = positionTeachingNote(player.pos, isPreflop);

  const potOddsNote = toCall > 0 ? (() => {
    const total = stage.callQuote?.contestablePot ?? stage.pot + toCall;
    const pct = Math.round((stage.callQuote?.requiredEquity ?? toCall / total) * 100);
    return `${toCall} to call for a final pot of ${total} — this needs about ${pct}% of that pot over many deals.`;
  })() : null;

  const boardNote = boardTeachingNote(stage.board);

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
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, lineHeight: 1.45 }}><PlainCopy>{note}</PlainCopy></span>
        </div>
      ))}
    </div>
  );
}

function TrainingPrompt({ stage, players, onChoice }: { stage: Stage; players: PlayerInfo[]; onChoice: (action: string) => void }) {
  const player = players[stage.playerIdx!];
  const toCall = stage.callQuote?.callCost ?? Math.max(0, (stage.currentBet || 0) - (stage.bets?.[stage.playerIdx!] || 0));
  const actionOrder = ["fold", "check", "call", "bet", "raise"] as const;
  const actions = actionOrder.filter(action => stage.legalActions?.[action]);
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
          ? <>Pot <span style={{ color: T.accent }}>{stage.pot}</span> · <span style={{ color: T.accent, fontWeight: 600 }}>{toCall}</span> to call · you can win <span style={{ color: T.accent }}>{stage.callQuote?.contestablePot ?? stage.pot + toCall}</span>.</>
          : <>No bet to call. Pot is <span style={{ color: T.accent }}>{stage.pot}</span>.</>
        }
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, marginBottom: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>What do you do?</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
        {actions.map(action => (
          <button type="button" key={action} onClick={() => onChoice(action)} style={{ padding: "9px 18px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", background: "transparent", color: T.ink, border: `1px solid ${T.hair}`, borderRadius: T.radius, cursor: "pointer" }}>
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
function gradeChoice(userAction: string, aiAction: string, stage: Stage): ChoiceGrade {
  if (!stage.legalActions?.[userAction as keyof LegalActions]) return "illegal";
  if (userAction === aiAction) return "model";
  if (stage.aiDecision?.callEstimate?.isClose) return "different";
  const facingBet = (stage.callQuote?.callCost ?? 0) > 0;
  const hasMeasuredPostflopPrice = stage.street !== "preflop" && facingBet && stage.aiDecision?.equity !== undefined;
  const directCost = hasMeasuredPostflopPrice && (
    (userAction === "call" && aiAction === "fold")
    || (userAction === "fold" && (aiAction === "call" || aiAction === "raise"))
  );
  return directCost ? "costly" : "different";
}

function ComparisonBanner({ userAction, aiAction, stage }: { userAction: string; aiAction: string; stage: Stage }) {
  const grade = gradeChoice(userAction, aiAction, stage);
  const labels: Record<ChoiceGrade, string> = {
    model: "✓ Matches this trainer",
    different: "~ Different legal choice",
    costly: "! Costly in this model",
    illegal: "× Poker rules do not allow this",
  };
  const color = grade === "model" ? T.accent : grade === "different" ? "#f0c060" : "#ff7a6e";
  return (
    <div style={{ padding: "8px 14px", background: `${color}18`, borderLeft: `3px solid ${color}`, borderBottom: `1px solid ${T.hairSoft}`, display: "flex", gap: 12, alignItems: "center" }}>
      <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, color }}>{labels[grade]}</span>
      <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft }}>
        You: <span style={{ color: T.ink }}>{userAction}</span>
        <span style={{ color: T.dim }}>{" · "}</span>
        Trainer: <span style={{ color: T.ink }}>{aiAction}</span>
      </span>
    </div>
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
      <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 8 }}>{"// other players' decisions"}</div>
      {villainIdxs.map(vi => {
        const vstages = stages.filter(s => s.type === "action" && s.playerIdx === vi && s.decision?.action !== "already_folded");
        if (vstages.length === 0) return null;
        const isOpen = !!expanded[vi];
        return (
          <div key={vi} style={{ marginBottom: 6, border: `1px solid ${T.hairSoft}` }}>
            <button type="button"
              aria-expanded={isOpen}
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
export interface HandOutcomeNote {
  title: string;
  reason: string;
  lesson: string;
}

export function getHandOutcomeNote(stages: Stage[], heroIdx: number, grades: ChoiceGrade[]): HandOutcomeNote | null {
  const showdown = stages.findLast(stage => stage.type === "showdown");
  if (!showdown) return null;

  const heroSettlement = showdownSeatSettlements(showdown)[heroIdx] ?? { won: 0, returned: 0 };
  const heroWon = heroSettlement.won > 0;
  const heroSharedPot = showdown.pots?.some(layer => !isUncalledReturn(layer) && layer.winners.length > 1 && layer.winners.includes(heroIdx)) ?? false;
  const returnedSuffix = heroSettlement.returned > 0
    ? ` Your unmatched ${heroSettlement.returned} chip${heroSettlement.returned === 1 ? " was" : "s were"} returned because no one called that part of your bet.`
    : "";
  const heroFolded = showdown.folded[heroIdx] ?? false;
  let title: string;
  let reason: string;

  if (heroWon && showdown.foldWin) {
    const finalHeroAction = stages.findLast(stage =>
      stage.type === "action"
      && stage.playerIdx === heroIdx
      && (stage.decision?.action === "bet" || stage.decision?.action === "raise"),
    );
    const actionDescription = finalHeroAction
      ? `Your ${finalHeroAction.street ?? "final"} ${finalHeroAction.decision?.action} ended the hand, so your cards did not have to be best.`
      : `Your cards did not have to be best.`;
    title = "Why you won";
    reason = `Every opponent folded. ${actionDescription}`;
  } else if (heroWon) {
    const heroResult = showdown.results?.find(result => result.idx === heroIdx)?.hand;
    title = heroSharedPot ? "Why you received chips" : "Why you won";
    reason = heroResult
      ? `${heroSharedPot ? "You shared a contested pot" : "Your hand won contested chips at showdown"} with ${heroResult.name}.${returnedSuffix}`
      : `You won ${heroSettlement.won} contested chips at showdown.${returnedSuffix}`;
  } else if (heroFolded) {
    title = "Why you did not win";
    reason = "You folded before the hand ended, so you were no longer eligible to win a pot.";
  } else {
    const winningResult = showdown.results?.find(result => result.idx === showdown.winner)?.hand;
    title = "Why you did not win";
    reason = winningResult
      ? `Another player won the contested pot at showdown with ${winningResult.name}.${returnedSuffix}`
      : `Another player won the contested pot at showdown.${returnedSuffix}`;
  }

  const hasCostlyDifference = grades.some(grade => grade === "costly" || grade === "illegal");
  const hasOtherDifference = grades.some(grade => grade === "different");
  const lesson = hasCostlyDifference
    ? `${heroWon ? "Winning once does not erase a costly choice." : "Losing once does not prove which choice caused it."} The grade describes what similar decisions are expected to do over time.`
    : hasOtherDifference
      ? `${heroWon ? "Winning this hand does not prove the different choice was better." : "Losing this hand does not prove the different choice was worse."} The trainer marked it as different, not as a measured loss.`
      : `${heroWon ? "A good decision can win or lose once." : "Matching the trainer does not guarantee one hand will win."} The review grades the decisions using the information available at the time.`;

  return { title, reason, lesson };
}

function HandReview({ stages, heroIdx, userChoices }: { stages: Stage[]; heroIdx: number; userChoices: Record<number, string> }) {
  const rows = stages.map((s) => {
    if (s.type !== "action" || s.playerIdx !== heroIdx || s.decision?.action === "already_folded") return null;
    if (s.heroActionId === undefined) return null;
    const userAct = userChoices[s.heroActionId];
    if (!userAct) return null;
    const rawAi = s.aiDecision?.action ?? s.decision?.action ?? "";
    const toCallStg = s.callQuote?.callCost ?? Math.max(0, (s.currentBet ?? 0) - (s.bets?.[heroIdx] ?? 0));
    const aiNorm = rawAi === "call" && toCallStg === 0 ? "check" : rawAi;
    const grade = gradeChoice(userAct, aiNorm, s);
    const isMatch = grade === "model";
    const aiReasoning = s.aiDecision?.reasoning ?? "";
    return { street: s.street ?? "?", userAct, aiNorm, isMatch, grade, aiReasoning };
  }).filter(Boolean) as Array<{ street: string; userAct: string; aiNorm: string; isMatch: boolean; grade: ChoiceGrade; aiReasoning: string }>;

  if (rows.length === 0) return null;
  const matches = rows.filter(r => r.isMatch).length;
  const outcome = getHandOutcomeNote(stages, heroIdx, rows.map(row => row.grade));

  return (
    <div style={{ margin: "10px 14px 0", padding: "10px 12px", background: T.panel, border: `1px solid ${T.hair}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim }}>{"// hand review"}</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: matches === rows.length ? T.accent : matches / rows.length >= 0.6 ? T.ink : T.inkSoft }}>
          {matches}/{rows.length} matched
        </span>
      </div>
      {outcome && (
        <div style={{ marginBottom: 7, padding: "7px 9px", background: T.bg, borderLeft: `2px solid ${T.accent}` }}>
          <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, color: T.accent, textTransform: "uppercase", marginBottom: 3 }}>{outcome.title}</div>
          <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.inkSoft, lineHeight: 1.45 }}><PlainCopy>{outcome.reason}</PlainCopy></div>
          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, lineHeight: 1.45, marginTop: 2 }}><PlainCopy>{outcome.lesson}</PlainCopy></div>
        </div>
      )}
      {rows.map((row, i) => {
        const color = row.grade === "model" ? T.accent : row.grade === "different" ? "#f0c060" : "#ff7a6e";
        const symbol = row.grade === "model" ? "✓" : row.grade === "different" ? "~" : row.grade === "costly" ? "!" : "×";
        return (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderTop: i > 0 ? `1px solid ${T.hairSoft}` : "none" }}>
            <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, color, paddingTop: 2, flexShrink: 0 }}>{symbol}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" as const }}>
                <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{row.street}</span>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.ink }}>You: {row.userAct}</span>
                {!row.isMatch && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>· Trainer: {row.aiNorm}</span>}
              </div>
              {!row.isMatch && row.aiReasoning && (
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.inkSoft, lineHeight: 1.4, marginTop: 2 }}><PlainCopy>{row.aiReasoning}</PlainCopy></div>
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
export interface DifferenceNote {
  reason: string;
  caveat?: string;
}

const differenceNote = (reason: string, caveat?: string): DifferenceNote => ({ reason, caveat });

export function getMissedNote(userAction: string, ai: Decision, stage: Stage): DifferenceNote | null {
  const ua = userAction;
  const aa = ai.action;
  if (ua === aa) return null;

  const equity = ai.equity;
  const equityPct = equity !== undefined ? Math.round(equity * 100) : null;
  const toCall = stage.callQuote?.callCost ?? Math.max(0, (stage.currentBet ?? 0) - (stage.bets?.[stage.playerIdx ?? 0] ?? 0));
  const pot = stage.pot;
  const contestablePot = stage.callQuote?.contestablePot ?? pot + toCall;
  const potOddsPct = toCall > 0 ? Math.round((stage.callQuote?.requiredEquity ?? toCall / contestablePot) * 100) : 0;
  const ev = equity !== undefined && toCall > 0 ? Math.round(equity * contestablePot - toCall) : null;
  const isPreflop = stage.street === "preflop";
  const isRiver = stage.street === "river";
  const isSemiBluff = ai.reasoning.toLowerCase().includes("semi-bluff");

  if (isPreflop) {
    if (ua === "fold" && (aa === "call" || aa === "raise"))
      return differenceNote(`Your hand was in the trainer's ${aa === "raise" ? "raising" : "calling"} range from this position — folding is too tight for this model.`);
    if (ua === "call" && aa === "raise")
      return differenceNote(`The trainer raises because its starting-hand chart puts this hand in its strongest group for this spot. Raising builds the pot and makes weaker hands pay more to continue. Calling keeps the pot smaller and can invite more players in.`);
    if (ua === "call" && aa === "fold")
      return differenceNote(
        `The trainer's starting-hand chart puts this hand below its calling group, so the trainer folds.`,
        `The app has not calculated whether calling here would win or lose chips.`,
      );
    if ((ua === "raise" || ua === "bet") && aa === "fold")
      return differenceNote(
        `The trainer's starting-hand chart puts this hand below its raising group for this spot, so the trainer folds.`,
        `The app has not calculated whether raising here would win or lose chips.`,
      );
    if ((ua === "raise" || ua === "bet") && aa === "call")
      return differenceNote(`The trainer calls rather than raises because it does not rate this hand highly enough to build a larger pot.`);
    return null;
  }

  // Postflop
  if (ua === "fold" && aa === "call") {
    if (equityPct !== null && ev !== null)
      return differenceNote(`The call needed about ${potOddsPct}% of the final pot over many deals, and the estimate was about ${equityPct}%. Calling was estimated to ${ev >= 0 ? `gain ${ev} chips` : `lose ${Math.abs(ev)} chips`} on average.`);
    return differenceNote(`The trainer calls because its estimated share of the pot covers the price.`);
  }
  if (ua === "fold" && (aa === "bet" || aa === "raise")) {
    if (isSemiBluff)
      return differenceNote(`The trainer sometimes bets this kind of unfinished hand because it can improve or win when everyone folds.`, `The app does not model exactly which hands would call this bet.`);
    if (equityPct !== null)
      return differenceNote(`The trainer's estimate gives this hand about ${equityPct}% of the pot over many deals, which passes its rule for a ${aa}.`, `The app does not predict which weaker hands would call.`);
    return differenceNote(`The hand passes the trainer's rule for a ${aa}.`, `The app does not predict which weaker hands would call.`);
  }
  if (ua === "fold" && aa === "check")
    return differenceNote(`Checking costs nothing, so folding is unnecessary when check is an option.`);

  if (ua === "check" && (aa === "bet" || aa === "raise")) {
    if (isSemiBluff)
      return differenceNote(`The trainer sometimes bets this unfinished hand because it can improve or win when everyone folds${ai.amount ? `; here it bets ${ai.amount}` : ""}.`, `The app does not model exactly which hands would call, so it does not claim an exact profit for this bet.`);
    if (equityPct !== null)
      return differenceNote(`The trainer's estimate gives this hand about ${equityPct}% of the pot over many deals, which passes its rule for a ${aa}${ai.amount ? ` of ${ai.amount}` : ""}.`, `The app does not predict which weaker hands would call.`);
    return differenceNote(`The hand passes the trainer's rule for a ${aa}.`, `The app does not predict which weaker hands would call.`);
  }

  if (ua === "call" && aa === "fold") {
    if (equityPct !== null && ev !== null)
      return differenceNote(`You paid ${toCall} toward a final pot of ${contestablePot}. This needs about ${potOddsPct}% of that pot over many deals, but the estimate was about ${equityPct}%. The call loses about ${Math.abs(ev)} chips on average in this model.`);
    return differenceNote(`The trainer folds because the estimated share of the pot does not cover the call price.`);
  }
  if (ua === "call" && (aa === "bet" || aa === "raise")) {
    if (equityPct !== null)
      return differenceNote(`The trainer's estimate gives this hand about ${equityPct}% of the pot over many deals, which passes its rule for a raise. Calling keeps the pot smaller; raising builds it.`, `The app does not predict which weaker hands would call the raise.`);
    return differenceNote(`The hand passes the trainer's rule for a raise. Calling keeps the pot smaller; raising builds it.`, `The app does not predict which weaker hands would call the raise.`);
  }

  if ((ua === "bet" || ua === "raise") && aa === "check") {
    if (equityPct !== null)
      return differenceNote(`The trainer's estimate gives this hand about ${equityPct}% of the pot over many deals, below its betting rule. It checks rather than add chips${isRiver ? "; no cards remain to improve the hand" : ". Another player may still bet"}.`);
    return differenceNote(`The hand is below the trainer's betting rule, so it checks rather than add chips${isRiver ? "; no cards remain to be dealt" : ""}.`);
  }
  if ((ua === "bet" || ua === "raise") && aa === "fold") {
    if (equityPct !== null && ev !== null)
      return differenceNote(`The estimate does not cover the price of calling: the call would lose about ${Math.abs(ev)} chips on average in this model. Raising would put still more chips at risk.`);
    return differenceNote(`The trainer folds because its estimate does not cover the call price. Raising would put still more chips at risk.`);
  }
  if ((ua === "bet" || ua === "raise") && aa === "call") {
    if (equityPct !== null)
      return differenceNote(`The estimate supports a call but does not pass the trainer's rule for a value raise. Raising would build a larger pot.`);
    return differenceNote(`The hand passes the trainer's calling rule but not its rule for a value raise.`);
  }

  return null;
}

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════
export default function PokerSim() {
  const [gs, setGs] = useState<{ hands: CardObj[][]; board: CardObj[]; seed: number; style: "gto" | "loose" | "wild" } | null>(null);

  const [step, setStep] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [mode, setMode] = useState<"focused" | "dense">("focused");
  const [dealerIdx, setDealerIdx] = useState(3); // Dan starts as BTN, rotates each hand
  const [startingStacks, setStartingStacks] = useState([200, 200, 200, 200]);
  const [trainingMode, setTrainingMode] = useState(true);
  const [heroIdx, setHeroIdx] = useState<number | null>(null);
  const [gameStyle, setGameStyle] = useState<"gto" | "loose" | "wild">("loose");
  const [userChoices, setUserChoices] = useState<Record<number, string>>({});
  const [heroChoices, setHeroChoices] = useState<Decision[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionEntry[]>([]);
  const [handNumber, setHandNumber] = useState(0);
  const handNumberRef = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<HTMLDivElement>(null);
  const stagesRef = useRef<Stage[]>([]);
  const languageMode = useSyncExternalStore(subscribeToLanguage, readLanguage, (): LanguageMode => "plain");

  const chooseLanguage = useCallback((language: LanguageMode) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
  }, []);

  // Responsive breakpoint via useSyncExternalStore — SSR-safe (server snapshot = false,
  // matching initial client render) and avoids a setState-in-effect.
  const isDesktop = useSyncExternalStore(
    (cb) => { const mq = window.matchMedia("(min-width: 740px)"); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); },
    () => window.matchMedia("(min-width: 740px)").matches,
    () => false,
  );

  const denseScrollToRef = useRef<number | null>(null);

  // Stable refs for keyboard handler
  const trainingRef = useRef(false);
  const heroChoicesRef = useRef<Decision[]>([]);
  const stepRef = useRef(0);
  const heroIdxRef = useRef<number | null>(null);

  // Keyboard navigation — stable listener via refs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('button, a, input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="tab"], [role="slider"]')) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const len = stagesRef.current.length;
      if (len === 0) return;
      const curStage = stagesRef.current[stepRef.current];
      const heroActionId = curStage?.heroActionId;
      const needsChoice = trainingRef.current && curStage?.type === "action" && curStage?.decision?.action !== "already_folded" && curStage?.playerIdx === heroIdxRef.current && heroActionId !== undefined && !heroChoicesRef.current[heroActionId];
      if (e.key === "ArrowRight") {
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

  const sessionScore = useMemo(() => ({
    matches: sessionHistory.filter(entry => entry.wasMatch).length,
    different: sessionHistory.filter(entry => entry.grade === "different").length,
    costly: sessionHistory.filter(entry => entry.grade === "costly" || entry.grade === "illegal").length,
    total: sessionHistory.length,
  }), [sessionHistory]);

  const handScore = useMemo(() => {
    const entries = sessionHistory.filter(entry => entry.hand === handNumber);
    return { matches: entries.filter(entry => entry.wasMatch).length, total: entries.length };
  }, [sessionHistory, handNumber]);

  const sessionPattern = useMemo((): string | null => {
    const divs = sessionHistory.filter(e => e.grade === "costly" || e.grade === "illegal");
    if (divs.length < 4) return null;
    const foldTight = divs.filter(e => e.heroAction === "fold" && (e.aiAction === "call" || e.aiAction === "raise" || e.aiAction === "bet")).length;
    const missValue = divs.filter(e => (e.heroAction === "check" || e.heroAction === "call") && (e.aiAction === "bet" || e.aiAction === "raise")).length;
    const callLoose = divs.filter(e => e.heroAction === "call" && (e.aiAction === "fold" || e.aiAction === "check")).length;
    const overAgg = divs.filter(e => (e.heroAction === "bet" || e.heroAction === "raise") && (e.aiAction === "check" || e.aiAction === "fold" || e.aiAction === "call")).length;
    const max = Math.max(foldTight, missValue, callLoose, overAgg);
    if (max < 2) return null;
    if (foldTight === max) return `Pattern: you often fold where the trainer continues (${foldTight}/${divs.length} costly differences). Check whether the price supports staying in.`;
    if (missValue === max) return `Pattern: you often check or call where the trainer bets (${missValue}/${divs.length} costly differences). Strong hands can ask worse hands to pay.`;
    if (callLoose === max) return `Pattern: you often call where the trainer folds (${callLoose}/${divs.length} costly differences). Compare the call price with the estimated share of the pot.`;
    if (overAgg === max) return `Pattern: you often raise where the trainer takes a quieter line (${overAgg}/${divs.length} costly differences). Build large pots with a clear reason.`;
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
    setHeroIdx(Math.floor(Math.random() * 4));
    const deck = shuffle(makeDeck());
    const hands = [[deck[0], deck[1]], [deck[2], deck[3]], [deck[4], deck[5]], [deck[6], deck[7]]];
    const board = [deck[8], deck[9], deck[10], deck[11], deck[12]];
    setGs({ hands, board, seed: (Math.random() * 2 ** 32) >>> 0, style: gameStyle });
    setStep(0);
  }, [gameStyle]);

  const choiceLockRef = useRef(false);
  const handleChoice = useCallback((action: string) => {
    if (choiceLockRef.current) return;
    choiceLockRef.current = true;
    const curStg = stagesRef.current[step];
    if (!curStg || curStg.playerIdx !== heroIdxRef.current) { choiceLockRef.current = false; return; }
    const heroActionId = curStg.heroActionId;
    if (heroActionId === undefined) { choiceLockRef.current = false; return; }
    const rawAi = curStg.decision?.action; // before hero choice injected, this IS the AI's decision
    if (!rawAi || rawAi === "already_folded") { choiceLockRef.current = false; return; }
    const stgToCall = curStg.callQuote?.callCost ?? Math.max(0, (curStg.currentBet ?? 0) - (curStg.bets?.[curStg.playerIdx ?? 0] ?? 0));
    const aiNorm = rawAi === "call" && stgToCall === 0 ? "check" : rawAi;
    const normalizedAction = action === "call" && stgToCall === 0 ? "check" : action;
    const isMatch = normalizedAction === aiNorm;
    const grade = gradeChoice(normalizedAction, aiNorm, curStg);
    // Build a Decision object so the simulation can execute the hero's actual choice
    let heroDec: Decision;
    const seat = curStg.playerIdx ?? 0;
    const heroStack = curStg.stacks?.[seat] ?? 200;
    const alreadyBet = curStg.bets?.[seat] ?? 0;
    const maxCommit = heroStack + alreadyBet;
    const heroName = players[curStg.playerIdx ?? heroIdxRef.current ?? 0]?.name ?? "you";
    if (normalizedAction === "fold") {
      heroDec = { action: "fold", dialogue: "You fold.", reasoning: `${heroName} folds.`, thoughts: [], math: [] };
    } else if (normalizedAction === "check") {
      heroDec = { action: "check", dialogue: "You check.", reasoning: `${heroName} checks.`, thoughts: [], math: [] };
    } else if (normalizedAction === "call") {
      heroDec = { action: "call", dialogue: "You call.", reasoning: `${heroName} calls.`, thoughts: [], math: [] };
    } else {
      const aggressiveAction = (curStg.currentBet ?? 0) === 0 ? "bet" : "raise";
      const target = snapToBB(
        Math.max((curStg.currentBet ?? 0) * 2.5, curStg.minRaiseTo ?? BB, BB),
        maxCommit,
      );
      heroDec = { action: aggressiveAction, amount: target, dialogue: `You ${aggressiveAction} to ${target}.`, reasoning: `${heroName} ${aggressiveAction}s to ${target}.`, thoughts: [], math: [] };
    }
    setHeroChoices(prev => [...prev.slice(0, heroActionId), heroDec]);
    setUserChoices(c => ({ ...c, [heroActionId]: normalizedAction }));
    setSessionHistory(h => [...h, {
      hand: handNumberRef.current,
      heroActionId,
      street: curStg.street ?? "preflop",
      position: players[curStg.playerIdx ?? 0]?.posShort ?? "",
      heroAction: normalizedAction,
      aiAction: aiNorm,
      wasMatch: isMatch,
      grade,
      aiReasoning: curStg.aiDecision?.reasoning ?? "",
    }]);
    // Release lock after state queued — React batches these so next render clears it
    setTimeout(() => { choiceLockRef.current = false; }, 0);
  }, [step, players]);

  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [calculationRetry, setCalculationRetry] = useState(0);
  const handCalculation = useTrainerTask(gs ? {
    kind: "hand",
    input: { gs, dealerIdx, startingStacks, players, heroIdx, heroChoices },
  } : null, calculationRetry);
  const stages = handCalculation.status === "complete" && handCalculation.result.kind === "hand"
    ? handCalculation.result.stages
    : EMPTY_STAGES;

  // Sync latest-value refs after each render (read only by the keyboard listener,
  // auto-advance timeout, and click handlers — all post-commit — so an effect is correct
  // and avoids writing refs during render).
  useEffect(() => {
    handNumberRef.current = handNumber;
    trainingRef.current = trainingMode;
    heroChoicesRef.current = heroChoices;
    stepRef.current = step;
    heroIdxRef.current = heroIdx;
    stagesRef.current = stages;
  });

  // Auto-advance villain steps in hero mode
  useEffect(() => {
    if (autoAdvanceRef.current) { clearTimeout(autoAdvanceRef.current); autoAdvanceRef.current = null; }
    if (!trainingMode || heroIdx === null || !stages.length) return;
    const curStage = stages[step];
    if (!curStage || curStage.type !== "action" || curStage.decision?.action === "already_folded") return;
    if (curStage.playerIdx === heroIdx) return;
    // Respect prefers-reduced-motion: don't auto-advance; let the user step manually.
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    autoAdvanceRef.current = setTimeout(() => {
      setStep(s => Math.min(s + 1, stages.length - 1));
    }, 900);
    return () => { if (autoAdvanceRef.current) { clearTimeout(autoAdvanceRef.current); autoAdvanceRef.current = null; } };
  }, [step, trainingMode, heroIdx, stages]);

  const cur = stages[step];
  const visible = stages.slice(0, step + 1);
  const showBoard = cur?.board || [];
  const isEnd = step >= stages.length - 1;

  // Screen-reader announcement of the current step (visually hidden, polite live region).
  const liveText = (() => {
    if (!cur) return "";
    if (cur.type === "action" && cur.decision) {
      const who = cur.playerIdx != null ? players[cur.playerIdx]?.name : "Player";
      const amt = cur.decision.amount ? ` ${cur.decision.amount}` : "";
      return `${who} on the ${cur.street}: ${cur.decision.action}${amt}.`;
    }
    if (cur.type === "showdown") return cur.foldWin ? "Showdown: everyone else folded." : cur.chop ? "Showdown: one or more pots were split." : "Showdown.";
    return cur.title || cur.street || "";
  })();
  const srOnly = { position: "absolute" as const, width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" as const, border: 0 };

  // ── Shared sub-sections ──────────────────────────────────────────

  const trainToggle = (
    <div role="group" aria-label="Training mode" style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
      {(["observe", "train"] as const).map(m => {
        const active = trainingMode ? "train" : "observe";
        return (
          <button type="button" key={m} aria-pressed={active === m} onClick={() => {
            const nextTraining = m === "train";
            if (nextTraining === trainingMode) return;
            setTrainingMode(nextTraining);
            setUserChoices({});
            setHeroChoices([]);
            setSessionHistory([]);
            if (nextTraining && gs) deal();
            else setStep(0);
          }} style={{ padding: "4px 9px", fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", background: active === m ? T.accent : "transparent", color: active === m ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
            {m}
          </button>
        );
      })}
    </div>
  );

  const tableStyleLabel = gameStyle === "gto" ? "Tight" : gameStyle === "loose" ? "Loose" : "Wild";
  const currentHandStyleLabel = gs?.style === "gto" ? "Tight" : gs?.style === "loose" ? "Loose" : "Wild";
  const tableStyleDescription = gs && gs.style !== gameStyle
    ? `Next hand: ${tableStyleLabel}. Current: ${currentHandStyleLabel}.`
    : gameStyle === "gto"
      ? "Fewer hands and calls — a cautious benchmark."
      : gameStyle === "loose"
        ? "More hands and calls — a common casual style."
        : "Many hands and raises — aggressive and swingy.";

  const masthead = (
    <header style={{ paddingBottom: 12, borderBottom: `1px solid ${T.ink}`, marginBottom: 14 }}>
      <h1 style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", textTransform: "uppercase", lineHeight: 1, margin: "0 0 6px", color: T.ink }}>
        HOLD&apos;EM TRAINER
      </h1>
      <p style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, margin: "0 0 6px" }}>
        &gt; practice your poker face
      </p>
      <Link href="/solver" aria-label="Open the heads-up push/fold strategy explorer"
        style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.accent, textDecoration: "none", border: `1px solid ${T.accentSoft}`, background: "rgba(125, 211, 160, 0.06)", padding: "7px 12px", borderRadius: T.radius, margin: "2px 0 12px" }}>
        Push/Fold Explorer <span aria-hidden="true">→</span>
      </Link>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 5fr) minmax(0, 4fr)", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, minWidth: 0 }}>
          <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim }}>Table style</span>
          <div role="group" aria-label="Table style" style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
            {([["gto", "Tight"], ["loose", "Loose"], ["wild", "Wild"]] as const).map(([s, label]) => (
              <button type="button" key={s} aria-pressed={gameStyle === s} onClick={() => setGameStyle(s)} style={{ padding: "4px 10px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", background: gameStyle === s ? T.ink : "transparent", color: gameStyle === s ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, lineHeight: 1.4, height: "2.8em", display: "block" }}>
            {tableStyleDescription}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, minWidth: 0 }}>
          <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim }}>Mode</span>
          {trainToggle}
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, lineHeight: 1.4, height: "2.8em", display: "block" }}>
            {trainingMode ? "Choose first, then compare with the trainer." : "Watch and study every decision."}
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
      <button type="button" aria-expanded={showRules} aria-controls="help-language-panel" onClick={() => setShowRules(!showRules)} style={{ width: "100%", padding: "8px 10px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", background: "transparent", color: T.ink, border: `1px solid ${T.hair}`, borderRadius: T.radius, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Help &amp; Language</span>
        <span style={{ color: T.dim }}>{showRules ? "[–]" : "[+]"}</span>
      </button>
      {showRules && (
        <div id="help-language-panel" style={{ marginTop: 6, padding: "10px 12px", background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius, maxHeight: 300, overflowY: "auto" }}>
          <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, textTransform: "uppercase", color: T.accent, marginBottom: 8 }}>Language</div>
          <div role="group" aria-label="Language style" style={{ display: "inline-flex", border: `1px solid ${T.hair}`, marginBottom: 7 }}>
            {([['plain', 'Plain language'], ['poker', 'Poker terms']] as const).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={languageMode === value}
                onClick={() => chooseLanguage(value)}
                style={{ padding: "6px 9px", fontFamily: T.mono, fontSize: 9.5, background: languageMode === value ? T.ink : "transparent", color: languageMode === value ? T.bg : T.inkSoft, border: "none", cursor: "pointer" }}
              >
                {label}
              </button>
            ))}
          </div>
          <p style={{ fontFamily: T.mono, fontSize: 10.5, color: T.inkSoft, lineHeight: 1.45, margin: "0 0 10px" }}>
            {languageMode === "plain"
              ? "Uses everyday wording throughout the trainer."
              : "Uses standard poker terms. Dotted terms explain themselves when hovered, focused, or clicked."}
          </p>
          <div style={{ borderTop: `1px solid ${T.hairSoft}`, margin: "10px 0" }} />
          <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.accent, marginBottom: 8 }}>{"// modes"}</div>
          {[
            { t: "Observe", d: "Watch the hand play out. Every decision shows full reasoning, inner thoughts, and the math." },
            { t: "Train", d: "Pick your action before seeing the trainer's choice. Then compare the two." },
            { t: "Single Steps", d: "Current decision shown in full. Prior moves collapse to one-liners above." },
            { t: "Full Log", d: "Every decision in the hand expanded in full. Scroll to review." },
          ].map((r, i, arr) => (
            <div key={r.t} style={{ paddingBottom: i < arr.length - 1 ? 6 : 0, marginBottom: i < arr.length - 1 ? 6 : 0, borderBottom: i < arr.length - 1 ? `1px solid ${T.hairSoft}` : "none", display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color: T.ink }}>{r.t}</span>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, lineHeight: 1.45 }}>{r.d}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${T.hairSoft}`, margin: "10px 0" }} />
          <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 8 }}>{"// glossary"}</div>
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
      <button type="button" onClick={deal} style={{ padding: "10px 22px", fontFamily: T.mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", background: T.ink, color: T.bg, border: "none", borderRadius: T.radius, cursor: "pointer" }}>
        $ deal →
      </button>
    </div>
  );


  const modeToggle = (
    <div role="group" aria-label="Feed display" style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
      {([["focused", "Single Steps"], ["dense", "Full Log"]] as const).map(([m, label]) => (
        <button type="button" key={m} aria-pressed={mode === m} onClick={() => setMode(m)} style={{ padding: "3px 8px", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", background: mode === m ? T.ink : "transparent", color: mode === m ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
          {label}
        </button>
      ))}
    </div>
  );

  const currentSettlements = cur?.type === "showdown" ? showdownSeatSettlements(cur, players.length) : null;

  const playerGrid = gs && (
    <>
      {trainingMode && heroIdx !== null && (
        <div style={{ marginBottom: 6, padding: "5px 10px", background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius, display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: T.accent }}>you</span>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>·</span>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.inkSoft }}>{players[heroIdx].name}</span>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>·</span>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.ink, fontWeight: 600 }}>{players[heroIdx].pos === "Dealer" ? "Button (BTN)" : players[heroIdx].pos}</span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginBottom: 8 }}>
        {players.map((p, i) => {
          const isFolded = cur?.folded?.[i] && cur?.playerIdx !== i;
          const isActing = cur?.type === "action" && cur?.playerIdx === i;
          const settlement = currentSettlements?.[i] ?? { won: 0, returned: 0 };
          const isWinner = settlement.won > 0;
          const hasReturn = settlement.returned > 0;
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
              {isWinner && <div style={{ marginTop: 2, fontFamily: T.mono, fontSize: 8.5, color: T.accent, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center", lineHeight: 1, fontWeight: 700 }}>{cur?.foldWin ? "winner" : `+${settlement.won} won`}</div>}
              {hasReturn && <div style={{ marginTop: 2, fontFamily: T.mono, fontSize: 8, color: T.inkSoft, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "center", lineHeight: 1 }}>{`+${settlement.returned} returned`}</div>}
              {!isFolded && !isWinner && isActing && <div style={{ marginTop: 2, fontFamily: T.mono, fontSize: 8.5, color: T.ink, letterSpacing: "0.14em", textTransform: "uppercase", textAlign: "center", lineHeight: 1, fontWeight: 700 }}>acting</div>}
              {!isFolded && !isWinner && !hasReturn && !isActing && <div style={{ marginTop: 2, height: 9.5 }} />}
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


  const feed = (desktopFill = false) => {
    const isActionStep = cur?.type === "action" && cur?.decision?.action !== "already_folded";
    const isHeroStep = cur?.playerIdx === heroIdx;
    const heroActionId = cur?.heroActionId;
    const needsChoice = trainingMode && isActionStep && isHeroStep && heroActionId !== undefined && !heroChoices[heroActionId];
    const userChoice = heroActionId === undefined ? undefined : userChoices[heroActionId];
    const stepToCall = cur?.callQuote?.callCost ?? Math.max(0, (cur?.currentBet ?? 0) - (cur?.bets?.[cur?.playerIdx ?? 0] ?? 0));
    // aiDecision is stored on hero stages; for non-hero stages, decision IS the AI's
    const rawAiAction = cur?.aiDecision?.action ?? cur?.decision?.action;
    const aiAction = rawAiAction === "call" && stepToCall === 0 ? "check" : rawAiAction;
    const containerStyle = desktopFill ? { flex: 1, overflowY: "auto" as const } : { maxHeight: 400, overflowY: "auto" as const };

    if (handCalculation.status === "pending" || handCalculation.status === "error") return (
      <div>
        <p role={handCalculation.status === "error" ? "alert" : "status"} style={{ color: T.inkSoft, lineHeight: 1.5, textWrap: "pretty" }}>
          {handCalculation.status === "error"
            ? handCalculation.message
            : "Calculating this hand in the background. Sampled estimates use 10,000 deals; heads-up rivers count every allowed hand."}
        </p>
        <button
          type="button"
          aria-disabled={handCalculation.status === "pending"}
          onClick={() => { if (handCalculation.status === "error") setCalculationRetry(value => value + 1); }}
          style={{ padding: "8px 12px", fontFamily: T.mono, background: T.panel, color: handCalculation.status === "pending" ? T.dim : T.ink, border: `1px solid ${T.hair}` }}
        >Retry calculation</button>
      </div>
    );
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
                    {handScore.matches}/{handScore.total} match
                  </span>
                </div>
              )}
              <div style={{ width: 1, height: 28, background: T.hair }} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim, letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1 }}>Session</span>
                <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: T.accent, lineHeight: 1.2 }}>
                  {sessionScore.matches} match · {sessionScore.different} other · {sessionScore.costly} costly
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
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSoft, lineHeight: 1.4 }}><PlainCopy>{sessionPattern}</PlainCopy></span>
          </div>
        )}

        <div ref={needsChoice ? undefined : (trainingMode || mode === "focused" ? focusedRef : feedRef)}
          style={{ background: T.panel, border: `1px solid ${T.hair}`, borderRadius: T.radius, ...containerStyle }}>

          {/* History trail — all prior steps as compact summaries */}
          {(trainingMode || mode === "focused") && visible.slice(0, step).map((s, i) => (
            <div key={i} role="button" tabIndex={0} aria-label={`View step ${i + 1}`}
              onClick={() => { if (trainingMode) { setStep(i); } else { denseScrollToRef.current = i; setMode("dense"); } }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (trainingMode) { setStep(i); } else { denseScrollToRef.current = i; setMode("dense"); } } }}
              style={{ cursor: "pointer" }} title="Click to view this step">
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
                <ComparisonBanner userAction={userChoice} aiAction={aiAction} stage={cur} />
              )}
              <FeedEntry s={cur} isFocused players={players} heroIdx={trainingMode && heroIdx !== null ? heroIdx : undefined} />
              {trainingMode && userChoice && isActionStep && isHeroStep && cur.aiDecision && (() => {
                const playingAI = cur.decision?.action === cur.aiDecision?.action;
                const canFollowAI = heroActionId !== undefined && heroActionId === heroChoices.length - 1;
                const revealAndFollow = () => {
                  if (heroActionId === undefined || !canFollowAI) return;
                  setHeroChoices(prev => [...prev.slice(0, heroActionId), cur.aiDecision!]);
                  setUserChoices(c => ({ ...c, [heroActionId]: aiAction ?? cur.aiDecision!.action }));
                  setSessionHistory(history => history.map(entry => entry.hand === handNumber && entry.heroActionId === heroActionId
                    ? { ...entry, heroAction: aiAction ?? cur.aiDecision!.action, wasMatch: true, grade: "model" }
                    : entry));
                };
                return (
                  <div style={{ padding: "12px 14px 14px", background: T.panelAlt, borderBottom: `1px solid ${T.hair}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: playingAI ? 0 : 8 }}>
                      <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: T.dim }}>Trainer&apos;s choice</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {!playingAI && canFollowAI && (
                          <button type="button"
                            onClick={revealAndFollow}
                            style={{ padding: "4px 10px", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", background: T.accent, color: T.bg, border: "none", borderRadius: T.radius, cursor: "pointer" }}
                          >
                            Use trainer&apos;s choice
                          </button>
                        )}
                        {playingAI && (
                          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.accent, letterSpacing: "0.1em" }}>✓ Using trainer&apos;s choice</span>
                        )}
                      </div>
                    </div>
                    {!playingAI && (
                      <>
                        <div style={{ fontFamily: T.mono, fontSize: 13, color: T.inkSoft, lineHeight: 1.45, marginBottom: 6, paddingLeft: 9, borderLeft: `2px solid ${T.hairSoft}` }}>
                          {cur.aiDecision.dialogue}
                        </div>
                        <div style={{ display: "flex", gap: 7, marginBottom: (cur.aiDecision.thoughts?.length ?? 0) > 0 ? 8 : 0 }}>
                          <span style={{ color: T.accent, fontSize: 12, lineHeight: 1.4, fontFamily: T.mono }}>{"//"}</span>
                          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft, lineHeight: 1.5, flex: 1 }}><PlainCopy>{cur.aiDecision.reasoning}</PlainCopy></div>
                        </div>
                        {cur.aiDecision.thoughts && cur.aiDecision.thoughts.length > 0 && (
                          <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(125,211,160,0.05)", border: `1px solid ${T.hairSoft}`, borderRadius: T.radius }}>
                            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 5 }}>Inner thoughts</div>
                            {cur.aiDecision.thoughts.map((t, ti) => (
                              <div key={ti} style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkSoft, lineHeight: 1.55, marginBottom: ti < cur.aiDecision!.thoughts.length - 1 ? 4 : 0 }}><PlainCopy>{t}</PlainCopy></div>
                            ))}
                          </div>
                        )}
                        {cur.aiDecision.math && cur.aiDecision.math.length > 0 && (
                          <div style={{ marginTop: 7, padding: "8px 10px", background: "rgba(125,211,160,0.06)", border: `1px solid ${T.hair}`, borderRadius: T.radius }}>
                            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.accent, marginBottom: 5 }}>The math</div>
                            {cur.aiDecision.math.map((m, mi) => (
                              <div key={mi} style={{ fontFamily: T.mono, fontSize: 11, color: T.ink, lineHeight: 1.55, marginBottom: mi < cur.aiDecision!.math.length - 1 ? 2 : 0 }}><PlainCopy>{m}</PlainCopy></div>
                            ))}
                          </div>
                        )}
                        {(() => {
                          if (!userChoice) return null;
                          const note = getMissedNote(userChoice, cur.aiDecision!, cur);
                          if (!note) return null;
                          return (
                            <div style={{ marginTop: 7, padding: "8px 10px", background: "rgba(255,185,80,0.05)", border: `1px solid rgba(255,185,80,0.22)`, borderRadius: T.radius }}>
                              <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,185,80,0.75)", marginBottom: 5 }}>How the trainer differs</div>
                              <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkSoft, lineHeight: 1.55 }}>
                                <PlainCopy>{note.reason}</PlainCopy>
                                {note.caveat && (
                                  <span style={{ color: T.dim }}> <PlainCopy>{note.caveat}</PlainCopy></span>
                                )}
                              </div>
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
              <HandReview stages={stages} heroIdx={heroIdx} userChoices={userChoices} />
              <VillainRecap stages={stages} heroIdx={heroIdx} players={players} />
            </>
          )}
        </div>
      </>
    );
  };

  const navBar = (borderTop = true) => gs && handCalculation.status === "complete" && (
    <div style={{ background: T.bg, ...(borderTop ? { borderTop: `1px solid ${T.ink}` } : {}), padding: "10px 14px", display: "flex", gap: 8, alignItems: "center" }}>
      {step > 0 && !isEnd && (
        <button type="button" onClick={() => setStep(s => Math.max(s - 1, 0))} style={{ padding: "9px 14px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", background: "transparent", color: T.ink, border: `1px solid ${T.ink}`, borderRadius: T.radius, cursor: "pointer" }}>
          ← Back
        </button>
      )}
      <div style={{ flex: 1 }} />
      {!isEnd && step < stages.length - 2 && !trainingMode && (
        <button type="button" onClick={() => setStep(stages.length - 1)} style={{ padding: "9px 14px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", background: "transparent", color: T.dim, border: `1px solid ${T.hair}`, borderRadius: T.radius, cursor: "pointer" }}>
          End →|
        </button>
      )}
      {!isEnd ? (() => {
        const heroActionId = cur?.heroActionId;
        const needsChoice = trainingMode && cur?.type === "action" && cur?.decision?.action !== "already_folded" && cur?.playerIdx === heroIdx && heroActionId !== undefined && !heroChoices[heroActionId];
        return (
          <button type="button"
            disabled={needsChoice}
            onClick={() => setStep(s => Math.min(s + 1, stages.length - 1))}
            style={{ padding: "9px 20px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", background: needsChoice ? "transparent" : T.ink, color: needsChoice ? T.dim : T.bg, border: needsChoice ? `1px solid ${T.hair}` : "none", borderRadius: T.radius, cursor: needsChoice ? "default" : "pointer", opacity: needsChoice ? 0.5 : 1 }}
          >
            {needsChoice ? "decide first" : "Next →"}
          </button>
        );
      })() : (
        <button type="button" onClick={deal} style={{ padding: "9px 20px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", background: T.accent, color: "#0d1014", border: "none", borderRadius: T.radius, cursor: "pointer" }}>
          $ deal again
        </button>
      )}
    </div>
  );

  // ── Desktop layout ───────────────────────────────────────────────
  if (isDesktop) {
    return (
      <LanguageContext.Provider value={languageMode}>
      <div style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", background: T.bg, color: T.ink, display: "flex", flexDirection: "row", height: "100dvh", overflow: "hidden" }}>
        <div aria-live="polite" style={srOnly}>{liveText}</div>
        <div style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column", height: "100dvh", borderRight: `1px solid ${T.hair}` }}>
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
          <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", padding: "16px 14px" }}>
            {feed(true)}
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>deal a hand to begin</span>
          </div>
        )}
      </div>
      </LanguageContext.Provider>
    );
  }

  // ── Mobile layout ────────────────────────────────────────────────
  return (
    <LanguageContext.Provider value={languageMode}>
    <div style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", background: T.bg, color: T.ink, display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden" }}>
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
                <div role="group" aria-label="Table style" style={{ display: "inline-flex", border: `1px solid ${T.hair}`, borderRadius: T.radius, overflow: "hidden" }}>
                  {(["gto", "loose", "wild"] as const).map(s => (
                    <button type="button" key={s} aria-pressed={gameStyle === s} onClick={() => setGameStyle(s)} style={{ padding: "4px 9px", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", background: gameStyle === s ? T.ink : "transparent", color: gameStyle === s ? T.bg : T.dim, border: "none", cursor: "pointer" }}>
                      {s === "gto" ? "tight" : s}
                    </button>
                  ))}
                </div>
                {gs.style !== gameStyle && <span style={{ fontFamily: T.mono, fontSize: 8, color: T.dim }}>next deal</span>}
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
    </LanguageContext.Provider>
  );
}
