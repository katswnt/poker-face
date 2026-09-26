// Question generators for the instant poker math drills. Each generator is a pure function
// of (seed, level). Formulas and conventions: tasks/drills-spec.md. The tests re-derive every
// answer independently (formula identities, card enumeration, the repo's hand evaluator).
import { makeDeck, shuffle, cv } from "@/lib/poker/cards";
import type { CardObj } from "@/lib/poker/types";
import { cardLabel, choose2, fmtBb, fmtPct, fmtPts, rankLetter, rankWord } from "./format";
import { pick, questionRng, randHalf, randInt, type Rng } from "./rng";
import type { DrillSource, DrillType, Explanation, Fact, Level, MathDrillType, Question } from "./types";

export const PERCENT_TOLERANCE: Readonly<Record<"pot-odds" | "mdf" | "bluff-share" | "outs-equity", number>> = {
  "pot-odds": 1,
  mdf: 1,
  "bluff-share": 1,
  "outs-equity": 2,
};

export const SPEED_TARGET_MS: Readonly<Record<DrillType, number>> = {
  "pot-odds": 6000,
  mdf: 6000,
  "bluff-share": 8000,
  "outs-equity": 6000,
  "outs-count": 15000,
  combos: 12000,
  "call-or-fold": 8000,
  solver: 20000,
};
/** Inclusion–exclusion combo questions get a longer target. */
export const EITHER_COMBOS_TARGET_MS = 20000;

const idOf = (type: DrillType, level: Level, seed: number) => `${type}:${level}:${seed >>> 0}`;

// ---------------------------------------------------------------------------------------------
// Pot and bet sizes by level

const ROUND_FRACTIONS: ReadonlyArray<readonly [number, number, string]> = [
  [1, 4, "¼"], [1, 3, "⅓"], [1, 2, "½"], [2, 3, "⅔"], [3, 4, "¾"], [1, 1, "1×"],
];
const ROUND_POTS = [12, 24, 36, 48, 60, 120];

export interface PotBet { readonly pot: number; readonly bet: number; readonly sizeLabel: string; }

export function potAndBet(rng: Rng, level: Level): PotBet {
  if (level === 1) {
    const [n, d, label] = pick(rng, ROUND_FRACTIONS);
    const pot = pick(rng, ROUND_POTS);
    return { pot, bet: (pot * n) / d, sizeLabel: `${label} pot` };
  }
  const pot = level === 2 ? randHalf(rng, 6, 60) : randHalf(rng, 3, 150);
  const [lo, hi] = level === 2 ? [0.25, 1.5] : [0.2, 2.5];
  const fraction = lo + rng() * (hi - lo);
  const bet = Math.max(0.5, Math.round(pot * fraction * 2) / 2);
  return { pot, bet, sizeLabel: `${Math.round((bet / pot) * 100)}% of the pot` };
}

const potFacts = (pot: number, bet: number): Fact[] => [
  { label: "Pot before the bet", value: `${fmtBb(pot)} bb` },
  { label: "Bet", value: `${fmtBb(bet)} bb` },
];

/** Pot-odds ratio (pot before call) : call, formatted as "x:1". */
function oddsRatio(pot: number, bet: number): string {
  const r = (pot + bet) / bet;
  const rounded = Math.round(r * 100) / 100;
  return `${rounded === r ? fmtRatio(r) : `≈${fmtRatio(rounded)}`}:1`;
}
function fmtRatio(r: number): string {
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
}

const POT_ODDS_ANCHORS = "Anchors: ¼ pot → 16.7%, ⅓ → 20%, ½ → 25%, ⅔ → 28.6%, ¾ → 30%, pot → 33.3%, 2× → 40%.";

// ---------------------------------------------------------------------------------------------
// Pot odds, MDF, bluff share, call-or-fold

export function requiredEquity(pot: number, bet: number): number {
  return (bet / (pot + 2 * bet)) * 100;
}

function potOdds(seed: number, level: Level): Question {
  const rng = questionRng("pot-odds", seed, level);
  const { pot, bet, sizeLabel } = potAndBet(rng, level);
  const value = requiredEquity(pot, bet);
  const explanation: Explanation = {
    formula: "required equity = call ÷ (pot before call + call)",
    plugged: `${fmtBb(bet)} ÷ (${fmtBb(pot + bet)} + ${fmtBb(bet)}) = ${fmtBb(bet)} ÷ ${fmtBb(pot + 2 * bet)}`,
    result: fmtPct(value),
    shortcut: `The bet is ${sizeLabel}. You call ${fmtBb(bet)} to win ${fmtBb(pot + bet)}, odds ${oddsRatio(pot, bet)}; need 1 ÷ (odds + 1). ${POT_ODDS_ANCHORS}`,
    shortcutApproximate: false,
  };
  return {
    id: idOf("pot-odds", level, seed), type: "pot-odds", level, seed,
    prompt: `Your opponent bets ${fmtBb(bet)} bb into a ${fmtBb(pot)} bb pot. What equity do you need to call?`,
    facts: potFacts(pot, bet),
    answer: { kind: "percent", value, tolerance: PERCENT_TOLERANCE["pot-odds"] },
    speedTargetMs: SPEED_TARGET_MS["pot-odds"],
    explanation,
    params: { pot, bet },
  };
}

export function minimumDefense(pot: number, bet: number): number {
  return (pot / (pot + bet)) * 100;
}

function mdf(seed: number, level: Level): Question {
  const rng = questionRng("mdf", seed, level);
  const { pot, bet, sizeLabel } = potAndBet(rng, level);
  const value = minimumDefense(pot, bet);
  return {
    id: idOf("mdf", level, seed), type: "mdf", level, seed,
    prompt: `Your opponent bets ${fmtBb(bet)} bb into a ${fmtBb(pot)} bb pot. What share of your range must continue so a pure bluff can't profit automatically (minimum defence frequency)?`,
    facts: potFacts(pot, bet),
    answer: { kind: "percent", value, tolerance: PERCENT_TOLERANCE.mdf },
    speedTargetMs: SPEED_TARGET_MS.mdf,
    explanation: {
      formula: "MDF = pot ÷ (pot + bet), with the pot measured before the bet",
      plugged: `${fmtBb(pot)} ÷ (${fmtBb(pot)} + ${fmtBb(bet)}) = ${fmtBb(pot)} ÷ ${fmtBb(pot + bet)}`,
      result: fmtPct(value),
      shortcut: `The bet is ${sizeLabel}. A bluff risks ${fmtBb(bet)} to win ${fmtBb(pot)}, so it needs you to fold more than bet ÷ (pot + bet). Anchors: ⅓ pot → 75%, ½ → 66.7%, ⅔ → 60%, pot → 50%, 2× → 33.3%.`,
      shortcutApproximate: false,
      note: "MDF ignores what your hands win when called. It is a theory benchmark, not an instruction to call exactly this often.",
    },
    params: { pot, bet },
  };
}

function bluffShare(seed: number, level: Level): Question {
  const rng = questionRng("bluff-share", seed, level);
  const { pot, bet, sizeLabel } = potAndBet(rng, level);
  const value = requiredEquity(pot, bet);
  return {
    id: idOf("bluff-share", level, seed), type: "bluff-share", level, seed,
    prompt: `You bet ${fmtBb(bet)} bb into a ${fmtBb(pot)} bb pot with a polar range (strong hands or air). What share of your bets can be bluffs so a bluff-catcher gains nothing by calling or folding?`,
    facts: potFacts(pot, bet),
    answer: { kind: "percent", value, tolerance: PERCENT_TOLERANCE["bluff-share"] },
    speedTargetMs: SPEED_TARGET_MS["bluff-share"],
    explanation: {
      formula: "bluff share = bet ÷ (pot + 2 × bet), with the pot measured before your bet",
      plugged: `${fmtBb(bet)} ÷ (${fmtBb(pot)} + 2 × ${fmtBb(bet)}) = ${fmtBb(bet)} ÷ ${fmtBb(pot + 2 * bet)}`,
      result: fmtPct(value),
      shortcut: `The bet is ${sizeLabel}. It is the caller's pot-odds number: the caller risks ${fmtBb(bet)} to win ${fmtBb(pot + bet)}, so bluffs may be that share of your bets. ${POT_ODDS_ANCHORS}`,
      shortcutApproximate: false,
      note: "Assumes a perfectly polar range: strong hands always win when called and bluffs always lose. Real ranges are rarely that clean.",
    },
    params: { pot, bet },
  };
}

/** EV of calling relative to folding, in bb. `equity` in points. */
export function callEv(pot: number, bet: number, equity: number): number {
  return (equity / 100) * (pot + 2 * bet) - bet;
}

export const CALL_OR_FOLD_MARGIN = 3;

function callOrFold(seed: number, level: Level): Question {
  const rng = questionRng("call-or-fold", seed, level);
  const { pot, bet, sizeLabel } = potAndBet(rng, level);
  const required = requiredEquity(pot, bet);
  const margin = level === 1 ? randInt(rng, 8, 20) : level === 2 ? randInt(rng, 5, 12) : randInt(rng, CALL_OR_FOLD_MARGIN, 7);
  let call = rng() < 0.5;
  let equity = call ? Math.ceil(required + margin) : Math.floor(required - margin);
  if (equity > 99 || equity < 1) {
    call = !call;
    equity = call ? Math.ceil(required + margin) : Math.floor(required - margin);
  }
  const ev = callEv(pot, bet, equity);
  const answer = call ? "call" : "fold";
  return {
    id: idOf("call-or-fold", level, seed), type: "call-or-fold", level, seed,
    prompt: `Your opponent bets ${fmtBb(bet)} bb into a ${fmtBb(pot)} bb pot. Your equity if you call is ${equity}%. Call or fold?`,
    facts: [...potFacts(pot, bet), { label: "Your equity", value: `${equity}%` }],
    answer: { kind: "choice", value: answer, options: [{ id: "call", label: "Call" }, { id: "fold", label: "Fold" }] },
    speedTargetMs: SPEED_TARGET_MS["call-or-fold"],
    explanation: {
      formula: "call when equity > call ÷ (pot before call + call); EV of calling vs folding = equity × final pot − call",
      plugged: `need ${fmtBb(bet)} ÷ ${fmtBb(pot + 2 * bet)} = ${fmtPct(required)}; you have ${equity}%. EV = ${equity}% × ${fmtBb(pot + 2 * bet)} − ${fmtBb(bet)} = ${ev >= 0 ? "+" : "−"}${fmtBb(Math.abs(ev))} bb`,
      result: call ? `Call (${fmtPts(equity - required)} above the price)` : `Fold (${fmtPts(required - equity)} below the price)`,
      shortcut: `The bet is ${sizeLabel}. Compare your equity with the pot-odds anchor for that size. ${POT_ODDS_ANCHORS}`,
      shortcutApproximate: false,
      note: "Equity here is your share of the final pot at showdown. The drill ignores later betting (implied odds) and rake.",
    },
    params: { pot, bet, equity, required },
  };
}

// ---------------------------------------------------------------------------------------------
// Outs → equity

export function hitProbability(outs: number, unseen: number, cardsToCome: 1 | 2): number {
  if (cardsToCome === 1) return (outs / unseen) * 100;
  return (1 - choose2(unseen - outs) / choose2(unseen)) * 100;
}

const COMMON_OUTS = [4, 8, 9];

function outsEquity(seed: number, level: Level): Question {
  const rng = questionRng("outs-equity", seed, level);
  const outs = level === 1 ? pick(rng, COMMON_OUTS) : randInt(rng, 2, level === 2 ? 15 : 21);
  // Streets: flop all-in (2 cards), flop to turn only (1), turn to river (1).
  const street = level === 1 ? pick(rng, ["flop-2", "turn-1"] as const) : pick(rng, ["flop-2", "flop-1", "turn-1"] as const);
  const unseen = street === "turn-1" ? 46 : 47;
  const cardsToCome: 1 | 2 = street === "flop-2" ? 2 : 1;
  const value = hitProbability(outs, unseen, cardsToCome);
  const rule = cardsToCome === 2 ? 4 : 2;
  const ruleValue = outs * rule;
  const situation = street === "flop-2"
    ? "You are all-in on the flop and will see both the turn and the river."
    : street === "flop-1" ? "You are on the flop and will see only the turn card." : "You are on the turn and will see the river card.";
  const plugged = cardsToCome === 1
    ? `${outs} ÷ ${unseen}`
    : `1 − C(${unseen - outs}, 2) ÷ C(${unseen}, 2) = 1 − ${choose2(unseen - outs)} ÷ ${choose2(unseen)}`;
  const corrected = ruleValue - (outs - 8);
  return {
    id: idOf("outs-equity", level, seed), type: "outs-equity", level, seed,
    prompt: `${situation} You have ${outs} clean outs and ${unseen} unseen cards. What is your chance to hit at least one out?`,
    facts: [
      { label: "Outs", value: String(outs) },
      { label: "Unseen", value: `${unseen} cards` },
      { label: "To come", value: cardsToCome === 2 ? "turn + river" : "1 card" },
    ],
    answer: { kind: "percent", value, tolerance: PERCENT_TOLERANCE["outs-equity"] },
    speedTargetMs: SPEED_TARGET_MS["outs-equity"],
    explanation: {
      formula: cardsToCome === 1
        ? "P(hit) = outs ÷ unseen cards"
        : "P(hit at least once) = 1 − P(miss twice) = 1 − C(unseen − outs, 2) ÷ C(unseen, 2)",
      plugged,
      result: fmtPct(value),
      shortcut: `Rule of ${rule}: ${outs} × ${rule} = ${ruleValue}% (approximate, ${fmtPts(Math.abs(ruleValue - value))} ${ruleValue >= value ? "high" : "low"} here).`,
      shortcutApproximate: true,
      note: cardsToCome === 2 && outs > 8
        ? `With more than 8 outs the rule of 4 overshoots; ${outs} × 4 − (${outs} − 8) = ${corrected}% is closer (also approximate).`
        : "Clean outs: every out wins and no other card does.",
    },
    params: { outs, unseen, cardsToCome },
  };
}

// ---------------------------------------------------------------------------------------------
// Outs counting on a concrete flop

/** Own straight check on rank values (ace also plays low). Independent of eval.ts. */
export function hasStraight(values: readonly number[]): boolean {
  let mask = 0;
  for (const v of values) mask |= 1 << v;
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let high = 14; high >= 5; high--) {
    const need = 0b11111 << (high - 4);
    if ((mask & need) === need) return true;
  }
  return false;
}

export function hasFlush(cards: readonly CardObj[]): boolean {
  const counts: Record<string, number> = {};
  for (const c of cards) if ((counts[c.suit] = (counts[c.suit] ?? 0) + 1) >= 5) return true;
  return false;
}

export interface OutsBreakdown { readonly flush: number; readonly straight: number; readonly both: number; readonly total: number; readonly straightRanks: number[]; readonly flushSuit: string | null; }

export function countOuts(hole: readonly CardObj[], flop: readonly CardObj[], unseen: readonly CardObj[]): OutsBreakdown {
  const seen = [...hole, ...flop];
  let flush = 0, straight = 0, both = 0, total = 0;
  const straightRanks = new Set<number>();
  let flushSuit: string | null = null;
  for (const c of unseen) {
    const all = [...seen, c];
    const f = hasFlush(all);
    const s = hasStraight(all.map(cv));
    if (f) { flush++; flushSuit = c.suit; }
    if (s) { straight++; straightRanks.add(cv(c)); }
    if (f && s) both++;
    if (f || s) total++;
  }
  return { flush, straight, both, total, straightRanks: [...straightRanks].sort((a, b) => a - b), flushSuit };
}

const OUTS_RANGE: Readonly<Record<Level, readonly [number, number]>> = { 1: [8, 9], 2: [4, 11], 3: [12, 21] };

export interface OutsDeal { readonly hole: CardObj[]; readonly flop: CardObj[]; readonly unseen: CardObj[]; readonly outs: OutsBreakdown; }

export function dealOutsSpot(rng: Rng, level: Level): OutsDeal {
  const [lo, hi] = OUTS_RANGE[level];
  for (let attempt = 0; attempt < 200_000; attempt++) {
    const deck = shuffle(makeDeck(), rng);
    const hole = deck.slice(0, 2);
    const flop = deck.slice(2, 5);
    const unseen = deck.slice(5);
    if (cv(hole[0]) === cv(hole[1])) continue;
    if (new Set(flop.map(cv)).size !== 3) continue;
    const five = [...hole, ...flop];
    if (hasFlush(five) || hasStraight(five.map(cv))) continue;
    const outs = countOuts(hole, flop, unseen);
    if (outs.total < lo || outs.total > hi) continue;
    return { hole, flop, unseen, outs };
  }
  throw new Error(`no outs spot found for level ${level}`);
}

function outsCount(seed: number, level: Level): Question {
  const rng = questionRng("outs-count", seed, level);
  const { hole, flop, outs } = dealOutsSpot(rng, level);
  const parts: string[] = [];
  if (outs.flush) parts.push(`flush: ${outs.flush} (any ${outs.flushSuit})`);
  if (outs.straight) parts.push(`straight: ${outs.straight} (any ${outs.straightRanks.map(rankLetter).join(" or ")})`);
  const plugged = parts.length === 2
    ? `${parts.join(" + ")} − both: ${outs.both} = ${outs.total}`
    : `${parts[0]} = ${outs.total}`;
  return {
    id: idOf("outs-count", level, seed), type: "outs-count", level, seed,
    prompt: "How many turn cards give you a straight or a flush (or better)?",
    facts: [
      { label: "Your hand", value: hole.map(cardLabel).join(" ") },
      { label: "Flop", value: flop.map(cardLabel).join(" ") },
      { label: "Unseen", value: "47 cards" },
    ],
    hole, board: flop,
    answer: { kind: "integer", value: outs.total },
    speedTargetMs: SPEED_TARGET_MS["outs-count"],
    explanation: {
      formula: "outs = flush outs + straight outs − cards that make both",
      plugged,
      result: `${outs.total} outs`,
      shortcut: "Flush draw = 9 (13 of the suit − 4 you see). Open-ended straight = 8, gutshot = 4. Flush draw + open-ender = 15 (9 + 8 − 2 overlap).",
      shortcutApproximate: false,
      note: "Raw outs: they are not discounted for cards that also help your opponent.",
    },
    params: { hole, flop, breakdown: outs },
  };
}

// ---------------------------------------------------------------------------------------------
// Combo counting with card removal

export type ComboKind = "pair" | "any" | "suited" | "offsuit" | "sets" | "either";

const COMBO_KINDS: Readonly<Record<Level, readonly ComboKind[]>> = {
  1: ["pair", "any"],
  2: ["pair", "any", "suited", "offsuit"],
  3: ["pair", "suited", "offsuit", "sets", "either"],
};

const SUITS = ["♠", "♥", "♦", "♣"];

export interface ComboCounts { readonly remaining: (rank: number) => number; readonly suitsLeft: (rank: number) => string[]; readonly unseen: number; }

export function comboCounts(dead: readonly CardObj[]): ComboCounts {
  const deadKeys = new Set(dead.map(c => `${cv(c)}${c.suit}`));
  const suitsLeft = (rank: number) => SUITS.filter(s => !deadKeys.has(`${rank}${s}`));
  return { remaining: rank => suitsLeft(rank).length, suitsLeft, unseen: 52 - dead.length };
}

function comboQuestion(seed: number, level: Level): Question {
  const rng = questionRng("combos", seed, level);
  const deck = shuffle(makeDeck(), rng);
  const boardSize = level === 1 ? 3 : pick(rng, [3, 4]);
  const withHero = level === 3;
  const hole = withHero ? deck.slice(0, 2) : [];
  const board = deck.slice(2, 2 + boardSize);
  const dead = [...hole, ...board];
  const counts = comboCounts(dead);
  const deadRanks = [...new Set(dead.map(cv))];
  const pickRank = (): number => (rng() < 0.6 ? pick(rng, deadRanks) : randInt(rng, 2, 14));
  const kind = pick(rng, COMBO_KINDS[level]);

  let a = pickRank();
  let b = pickRank();
  while (b === a) b = randInt(rng, 2, 14);
  if (b > a) [a, b] = [b, a];
  const na = counts.remaining(a), nb = counts.remaining(b);
  const la = rankLetter(a), lb = rankLetter(b);
  const suited = counts.suitsLeft(a).filter(s => counts.suitsLeft(b).includes(s)).length;

  let label: string, value: number, formula: string, plugged: string, shortcut: string;
  let target = SPEED_TARGET_MS.combos;
  switch (kind) {
    case "pair":
      label = `${la}${la} (a pair of ${rankWord(a, 2)})`;
      value = choose2(na);
      formula = "pair combos = C(n, 2) = n × (n − 1) ÷ 2, n = unseen cards of that rank";
      plugged = `${na} ${rankWord(a, na)} unseen → ${na} × ${Math.max(na - 1, 0)} ÷ 2`;
      shortcut = "6 with none of the rank seen, 3 with one seen, 1 with two seen, 0 with three.";
      break;
    case "any":
      label = `${la}${lb} (any suits)`;
      value = na * nb;
      formula = "unpaired combos = n₁ × n₂";
      plugged = `${na} ${rankWord(a, na)} × ${nb} ${rankWord(b, nb)}`;
      shortcut = "16 with nothing seen (4 suited + 12 offsuit); each seen card of either rank removes 4.";
      break;
    case "suited":
      label = `${la}${lb}s (suited)`;
      value = suited;
      formula = "suited combos = suits in which both cards are still unseen";
      plugged = `${la}: ${counts.suitsLeft(a).join(" ") || "none"}; ${lb}: ${counts.suitsLeft(b).join(" ") || "none"} → shared suits`;
      shortcut = "4 with nothing seen; each seen card of either rank kills its suit.";
      break;
    case "offsuit":
      label = `${la}${lb}o (offsuit)`;
      value = na * nb - suited;
      formula = "offsuit combos = n₁ × n₂ − suited combos";
      plugged = `${na} × ${nb} − ${suited}`;
      shortcut = "12 with nothing seen (16 − 4).";
      break;
    case "sets": {
      const boardRanks = [...new Set(board.map(cv))].sort((x, y) => y - x);
      value = boardRanks.reduce((sum, r) => sum + choose2(counts.remaining(r)), 0);
      label = "sets (pocket pairs that match a board card)";
      formula = "sets = Σ C(n, 2) over the board's ranks, n = unseen cards of that rank";
      plugged = boardRanks.map(r => `${rankLetter(r)}: C(${counts.remaining(r)}, 2) = ${choose2(counts.remaining(r))}`).join(" + ");
      shortcut = "3 per unpaired board rank when you hold none of it: 9 on a flop with three different ranks.";
      break;
    }
    case "either": {
      const n = counts.unseen;
      const onlyA = choose2(n) - choose2(n - na);
      const onlyB = choose2(n) - choose2(n - nb);
      const overlap = na * nb;
      value = onlyA + onlyB - overlap;
      label = `hands containing at least one ${rankWord(a, 1)} or at least one ${rankWord(b, 1)}`;
      formula = "|A ∪ B| = |A| + |B| − |A ∩ B|, with |A| = C(N, 2) − C(N − n₁, 2) and |A ∩ B| = n₁ × n₂";
      plugged = `N = ${n}: [${choose2(n)} − ${choose2(n - na)}] + [${choose2(n)} − ${choose2(n - nb)}] − ${na} × ${nb} = ${onlyA} + ${onlyB} − ${overlap}`;
      shortcut = `Complement: all hands minus hands with neither = C(${n}, 2) − C(${n - na - nb}, 2) = ${choose2(n)} − ${choose2(n - na - nb)}.`;
      target = EITHER_COMBOS_TARGET_MS;
      break;
    }
  }
  const removed = withHero ? "on the board and in your hand" : "on the board";
  return {
    id: idOf("combos", level, seed), type: "combos", level, seed,
    prompt: `How many combos of ${label} can your opponent hold? Cards ${removed} are removed.`,
    facts: [
      ...(withHero ? [{ label: "Your hand", value: hole.map(cardLabel).join(" ") }] : []),
      { label: "Board", value: board.map(cardLabel).join(" ") },
    ],
    hole: withHero ? hole : undefined,
    board,
    answer: { kind: "integer", value },
    speedTargetMs: target,
    explanation: { formula, plugged, result: `${value} ${value === 1 ? "combo" : "combos"}`, shortcut, shortcutApproximate: false },
    params: { kind, a, b, hole, board },
  };
}

// ---------------------------------------------------------------------------------------------
// Registry

export const DRILL_SOURCES: Readonly<Record<MathDrillType, DrillSource>> = {
  "pot-odds": { type: "pot-odds", label: "Pot odds", short: "Equity needed to call", answerKind: "percent", generate: potOdds },
  mdf: { type: "mdf", label: "Minimum defence", short: "MDF against a bet", answerKind: "percent", generate: mdf },
  "bluff-share": { type: "bluff-share", label: "Bluff share", short: "Bluffs in a polar bet", answerKind: "percent", generate: bluffShare },
  "outs-equity": { type: "outs-equity", label: "Outs to equity", short: "Hit chance from outs", answerKind: "percent", generate: outsEquity },
  "outs-count": { type: "outs-count", label: "Count outs", short: "Outs on a real flop", answerKind: "integer", generate: outsCount },
  combos: { type: "combos", label: "Combos", short: "Combos with card removal", answerKind: "integer", generate: comboQuestion },
  "call-or-fold": { type: "call-or-fold", label: "Call or fold", short: "Price vs equity", answerKind: "choice", generate: callOrFold },
};

/** The synchronous math drills (mixed mode draws from these only). */
export const DRILL_TYPES = Object.keys(DRILL_SOURCES) as MathDrillType[];
/** Every drill type, including the lazy-loaded solver decisions. */
export const ALL_DRILL_TYPES: readonly DrillType[] = [...DRILL_TYPES, "solver"];

export const DRILL_LABELS: Readonly<Record<DrillType, string>> = {
  ...Object.fromEntries(DRILL_TYPES.map(t => [t, DRILL_SOURCES[t].label])) as Record<MathDrillType, string>,
  solver: "Solver decisions",
};

export function isMathDrillType(value: unknown): value is MathDrillType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DRILL_SOURCES, value);
}

export function isDrillType(value: unknown): value is DrillType {
  return value === "solver" || isMathDrillType(value);
}

export function generateQuestion(type: MathDrillType, seed: number, level: Level): Question {
  return DRILL_SOURCES[type].generate(seed >>> 0, level);
}
