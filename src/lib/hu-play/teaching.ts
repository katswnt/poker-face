/** P5 teaching-only math. Never import this module into the AI solve path. */
import { score7 } from "../poker/score7";
import { classifyHand, RANGE_GROUP_LABELS } from "../drills/solver/composition";
import { minimumDefenceFrequency } from "../solver/bridge/library/query";
import { assertDistinctRiverCards, parseRiverCombo, RIVER_DECK, riverCardObject, type RiverCard } from "../solver/river/cards";
import { derivePublicState, validatePublicState } from "./public-state";
import type { HeadsUpPublicState, HuRange } from "./types";

export interface DecisionPrice {
  readonly call: number;
  readonly potBeforeCall: number;
  readonly requiredEquity: number;
  readonly polarBluffShare: number;
  readonly aggressorRisk: number;
  readonly potBeforeAggression: number;
  readonly minimumDefence: number;
}

/** Fractions, not percentage points. MDF is a zero-equity-bluff benchmark, not a
 * prescribed defence. On raises, risk is what the aggressor added, not what we must call.
 */
export function decisionPrice(input: HeadsUpPublicState): DecisionPrice | null {
  const s = validatePublicState(input);
  if (s.status !== "betting" || s.toAct === null) return null;
  const call = Math.max(...s.streetPut) - s.streetPut[s.toAct];
  if (!call) return null;
  const last = s.events.at(-1);
  if (last?.kind !== "action" || (last.action.type !== "bet" && last.action.type !== "raise")) {
    throw new Error("A call price must follow a public bet or raise");
  }
  const before = derivePublicState(s, s.events.slice(0, -1));
  const aggressorRisk = last.action.to - before.streetPut[last.player];
  const requiredEquity = call / (s.pot + call);
  return { call, potBeforeCall: s.pot, requiredEquity, polarBluffShare: requiredEquity,
    aggressorRisk, potBeforeAggression: before.pot,
    minimumDefence: minimumDefenceFrequency(before.pot, aggressorRisk) };
}

/** Learner-known cards only, plus the publicly reconstructed AI reach. No actual AI
 * hand or future runout is accepted. This goes to a separate teaching Worker, not W2.
 */
export interface RangeEquityInput {
  readonly humanHand: string;
  readonly board: readonly RiverCard[];
  readonly aiRange: HuRange;
}
export interface RangeEquityProgress { readonly completedHands: number; readonly totalHands: number; readonly outcomes: number }
export interface RangeEquityResult {
  readonly method: "exact-enumeration";
  readonly equity: number | null;
  readonly win: number;
  readonly tie: number;
  readonly loss: number;
  readonly compatibleHands: number;
  /** Count of compatible opponent-hand / unordered-runout pairs; not Monte Carlo samples. */
  readonly outcomes: number;
  readonly groups: readonly { label: string; share: number }[];
}

function fields(input: unknown, names: readonly string[], label: string): void {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).sort().join() !== [...names].sort().join()) throw new Error(`Invalid ${label} fields`);
}

export function exactRangeEquity(input: RangeEquityInput,
  progress?: (value: RangeEquityProgress) => void): RangeEquityResult {
  fields(input, ["humanHand", "board", "aiRange"], "teaching input (no hidden cards)");
  if (typeof input.humanHand !== "string" || !Array.isArray(input.board)
    || input.board.length < 3 || input.board.length > 5) throw new Error("Equity needs a human hand and flop, turn or river board");
  const hero = parseRiverCombo(input.humanHand), known = [...hero, ...input.board];
  assertDistinctRiverCards(known, "Teaching cards");
  fields(input.aiRange, ["source", "entries"], "AI range");
  if (typeof input.aiRange.source !== "string" || input.aiRange.source.length > 500
    || !Array.isArray(input.aiRange.entries) || input.aiRange.entries.length > 1326) throw new Error("Invalid AI range");
  const seen = new Set<string>();
  const hands = input.aiRange.entries.map(row => {
    fields(row, ["combo", "weight"], "range entry");
    if (typeof row.combo !== "string" || !Number.isFinite(row.weight) || row.weight < 0) throw new Error("Invalid range weight or combo");
    const cards = parseRiverCombo(row.combo), key = cards.join("");
    if (seen.has(key)) throw new Error("Duplicate range combo"); seen.add(key);
    return { cards, weight: row.weight };
  }).filter(h => h.weight > 0 && h.cards.every(c => !known.includes(c)));
  const groups = new Array<number>(RANGE_GROUP_LABELS.length).fill(0);
  if (!hands.length) return { method: "exact-enumeration", equity: null, win: 0, tie: 0, loss: 0,
    compatibleHands: 0, outcomes: 0, groups: [] };
  const scale = Math.max(...hands.map(h => h.weight));
  const board = input.board.map(riverCardObject), heroCards = hero.map(riverCardObject);
  let mass = 0, win = 0, tie = 0, loss = 0, outcomes = 0;
  progress?.({ completedHands: 0, totalHands: hands.length, outcomes });
  hands.forEach((h, index) => {
    const weight = h.weight / scale, villainCards = h.cards.map(riverCardObject);
    const deck = RIVER_DECK.filter(c => !known.includes(c) && !h.cards.includes(c)).map(riverCardObject);
    const a = [...heroCards, ...board], b = [...villainCards, ...board];
    let wins = 0, ties = 0, count = 0;
    const compare = () => { const x = score7(a), y = score7(b); count++; if (x > y) wins++; else if (x === y) ties++; };
    if (board.length === 5) compare();
    else if (board.length === 4) {
      for (const card of deck) { a[6] = b[6] = card; compare(); }
    } else {
      for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) {
        a[5] = b[5] = deck[i]; a[6] = b[6] = deck[j]; compare();
      }
    }
    mass += weight; win += weight * wins / count; tie += weight * ties / count;
    loss += weight * (count - wins - ties) / count; outcomes += count;
    groups[classifyHand(villainCards, board)] += weight;
    progress?.({ completedHands: index + 1, totalHands: hands.length, outcomes });
  });
  win /= mass; tie /= mass; loss /= mass;
  return { method: "exact-enumeration", equity: win + tie / 2, win, tie, loss,
    compatibleHands: hands.length, outcomes,
    groups: RANGE_GROUP_LABELS.map((label, i) => ({ label, share: groups[i] / mass })) };
}
