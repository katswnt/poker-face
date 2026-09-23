import { isRiverCard } from "../cards";
import { parseConfigurableRiverRange } from "../configurable/range";
import { prepareConfigurableRiverV3, type ConfigurableRiverV3Request } from "../configurable-v3/solve";
import { BROWSER_ITERATION_LIMIT, BROWSER_STATE_LIMIT, type RiverLabErrors, type RiverLabInput, type RiverLabPreflight } from "./model";

export class RiverLabInputError extends Error {
  constructor(readonly errors: RiverLabErrors) {
    super(Object.values(errors).join(" "));
  }
}

/** Deliberately modest input bounds also bound parsing and whole-chip arithmetic. */
export function parseRiverLabInput(input: RiverLabInput): { request: ConfigurableRiverV3Request; iterations: number } {
  const errors: RiverLabErrors = {};
  const integer = (field: keyof RiverLabInput, min: number, max: number): number => {
    const raw = input[field];
    const value = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      errors[field] = `Enter a whole number from ${min} to ${max}.`;
    }
    return value;
  };
  const board = input.board.trim().split(/[\s,]+/);
  if (board.length !== 5 || !board.every(isRiverCard) || new Set(board).size !== 5) {
    errors.board = "Enter five different cards, such as Ks 8s 4s 2c 9d. Use T for ten.";
  }
  const pot = integer("pot", 2, 1_000_000);
  if (Number.isFinite(pot) && pot % 2 !== 0) {
    errors.pot = "Use an even pot: this game starts with equal whole-chip contributions.";
  }
  const stack0 = integer("stack0", 1, 1_000_000);
  const stack1 = integer("stack1", 1, 1_000_000);
  const maxRaises = integer("maxRaises", 0, 2) as 0 | 1 | 2;
  const iterations = integer("iterations", 21, BROWSER_ITERATION_LIMIT);
  const sizes = (field: "bets" | "raises"): number[] => {
    if (field === "raises" && maxRaises === 0 && !input[field].trim()) return [1];
    const tokens = input[field].trim().split(/[\s,]+/);
    const values = tokens.map(token => /^\d+$/.test(token) ? Number(token) : NaN);
    if (values.length > 5 || values.some(value => !Number.isSafeInteger(value) || value < 1 || value > 1_000_000)
      || new Set(values).size !== values.length) {
      errors[field] = "Enter 1 to 5 different whole-chip amounts, separated by spaces (1–1000000).";
    }
    return values;
  };
  const bets = sizes("bets");
  const raises = sizes("raises");
  if (!errors.bets && !errors.stack0 && !errors.stack1 && !bets.some(bet => bet <= Math.max(stack0, stack1))) {
    errors.bets = "At least one opening bet must fit a player's stack.";
  }
  for (const field of ["range0", "range1"] as const) {
    if (input[field].length > 2000) errors[field] = "Keep each range under 2000 characters.";
    else if (!errors.board) {
      try {
        const parsed = parseConfigurableRiverRange(input[field], board as unknown as ConfigurableRiverV3Request["board"]);
        if (parsed.entries.length > 128) errors[field] = "Use at most 128 hand combinations after removing board cards.";
      } catch (error) {
        errors[field] = error instanceof Error ? error.message : "Check this range.";
      }
    }
  }
  if (Object.keys(errors).length) throw new RiverLabInputError(errors);
  return {
    iterations,
    request: {
      id: "river-lab-custom", board: board as unknown as ConfigurableRiverV3Request["board"],
      rangeText: [input.range0, input.range1], committed: [pot / 2, pot / 2],
      stackBehind: [stack0, stack1], openingBetSizes: bets, raiseToSizes: raises, maxRaises,
    },
  };
}

export function riverLabPreflight(input: RiverLabInput) {
  const parsed = parseRiverLabInput(input);
  // Preparation counts only the bounded public tree and deal list, never the repeated tree.
  const prepared = prepareConfigurableRiverV3(parsed.request);
  const counts = prepared.game.preflight;
  const preflight: RiverLabPreflight = {
    counts, allowed: counts.projectedFullStates <= BROWSER_STATE_LIMIT,
    iterations: parsed.iterations,
    approximateNodeVisits: (counts.projectedFullStates - 1) * 5 * parsed.iterations,
    blockedCombos: [prepared.parsedRanges[0].blockedComboCount, prepared.parsedRanges[1].blockedComboCount],
  };
  return { ...parsed, prepared, preflight };
}
