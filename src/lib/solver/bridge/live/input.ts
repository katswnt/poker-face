import { canonicalBridgeCombo, compareBridgeCombos, type BridgeBetSize, type BridgeRange, type BridgeSpotV1 } from "../contract";
import { isRiverCard, type RiverCard } from "../../river/cards";
import { parseConfigurableRiverRange } from "../../river/configurable/range";
import { parseLiveSpot } from "./admission";

export interface LiveInput { board: string; range0: string; range1: string; pot: string; stack: string;
  bets: string; raise: string; raiseLimit: string; iterations: string }
export type LiveInputErrors = Partial<Record<keyof LiveInput | "json" | "form", string>>;
export class LiveInputError extends Error {
  constructor(readonly errors: LiveInputErrors) { super(Object.values(errors).join(" ")); }
}
export const SMALL_TURN: LiveInput = { board: "Ks 8h 4s 2h", range0: "AcAd QcJd", range1: "KcQd JcJh",
  pot: "100", stack: "100", bets: "50", raise: "2", raiseLimit: "0", iterations: "1000" };
export const SMALL_RIVER: LiveInput = { ...SMALL_TURN, board: "Ks 8h 4s 2h 9c" };

export function parseLiveInput(input: LiveInput): { spot: BridgeSpotV1; removed: [number, number]; roundedWeights: boolean } {
  const errors: LiveInputErrors = {};
  const integer = (key: keyof LiveInput, min: number, max: number) => {
    const n = /^\d+$/.test(input[key].trim()) ? Number(input[key]) : NaN;
    if (!Number.isSafeInteger(n) || n < min || n > max) errors[key] = `Enter a whole number from ${min} to ${max}.`;
    return n;
  };
  const cards = input.board.trim().split(/[\s,]+/);
  if ((cards.length !== 4 && cards.length !== 5) || !cards.every(isRiverCard) || new Set(cards).size !== cards.length) {
    errors.board = "Enter four or five different cards, such as Ks 8h 4s 2h. Use T for ten; c/d/h/s are the suits.";
  }
  const pot = integer("pot", 4, 1_000_000), stack = integer("stack", 1, 1_000_000);
  if (stack > 10 * pot) errors.stack = "Keep the effective stack at most 10 times the starting pot for browser menus.";
  const iterations = integer("iterations", 1, 10_000), raiseLimit = integer("raiseLimit", 0, 1);
  const tokens = input.bets.trim().split(/[\s,]+/).filter(Boolean), bets: BridgeBetSize[] = [];
  if (tokens.length < 1 || tokens.length > 2 || new Set(tokens).size !== tokens.length) errors.bets = "Enter one or two different sizes: 25–200 (% of pot), or allin.";
  for (const token of tokens) {
    if (token === "allin") bets.push({ kind: "allin" });
    else if (/^\d+$/.test(token) && +token >= 25 && +token <= 200) bets.push({ kind: "pot", pct: +token });
    else errors.bets = "Use whole percentages from 25 to 200, or allin. Example: 50 100.";
  }
  const multiple = Number(input.raise);
  if (raiseLimit && (!input.raise.trim() || !Number.isFinite(multiple) || multiple < 2 || multiple > 4)) {
    errors.raise = "Use a raise multiplier from 2 to 4 (2 means twice the previous bet-to amount).";
  }
  const ranges: BridgeRange[] = [], removed: [number, number] = [0, 0]; let roundedWeights = false;
  for (const [p, key] of [[0, "range0"], [1, "range1"]] as const) {
    if (input[key].length > 2000) { errors[key] = "Use at most 2000 characters per range."; continue; }
    if (errors.board) continue;
    try {
      const parsed = parseConfigurableRiverRange(input[key], cards as RiverCard[]);
      if (parsed.entries.length > 64) throw new Error("Use at most 64 hand combinations after removing board cards.");
      removed[p] = parsed.blockedComboCount;
      const max = Math.max(...parsed.entries.map(h => h.weight));
      const combos = parsed.entries.map(h => {
        const normalized = h.weight / max, weight = Math.fround(normalized);
        if (weight === 0) throw new Error("A range weight is too small for the float32 solver.");
        roundedWeights ||= weight !== normalized;
        return { combo: canonicalBridgeCombo(...h.cards), weight };
      }).sort((a, b) => compareBridgeCombos(a.combo, b.combo));
      ranges[p] = { source: "Learner-entered range; normalized to largest weight and rounded to float32", combos };
    } catch (error) { errors[key] = error instanceof Error ? error.message : "Check this range."; }
  }
  if (Object.keys(errors).length) throw new LiveInputError(errors);
  const menu = { oop: { bet: bets, raise: raiseLimit ? [{ kind: "prevBet", multiple } as const] : [] },
    ip: { bet: bets, raise: raiseLimit ? [{ kind: "prevBet", multiple } as const] : [] } };
  const raw = { format: "poker-face-bridge-spot", version: 1, id: "live-custom", ranges, rake: 0,
    board: { flop: cards.slice(0, 3), turn: cards[3], river: cards[4] ?? null }, startingPot: pot, effectiveStack: stack,
    tree: { mode: "menu", flop: null, turn: cards.length === 4 ? menu : null, river: menu, turnDonk: null, riverDonk: null,
      addAllInThreshold: 0, forceAllInThreshold: 0, mergingThreshold: 0, maxRaisesPerStreet: raiseLimit },
    solve: { maxIterations: iterations, timeoutMs: 120000, memoryCapBytes: 256 * 1024 ** 2, compression: "off", exportScope: "full",
      targetExploitabilityPctPot: 0.01 } };
  try { return { spot: parseLiveSpot(JSON.stringify(raw)), removed, roundedWeights }; }
  catch (error) { throw new LiveInputError({ form: error instanceof Error ? error.message : "Check the game." }); }
}

/** Count compatible private-hand pairs, not sampled deals, not public tree states. */
export function compatibleDeals(spot: BridgeSpotV1): number {
  let n = 0;
  for (const a of spot.ranges[0].combos) for (const b of spot.ranges[1].combos) {
    const cards = [a.combo.slice(0, 2), a.combo.slice(2), b.combo.slice(0, 2), b.combo.slice(2)];
    if (new Set(cards).size === 4) n++;
  }
  return n;
}
