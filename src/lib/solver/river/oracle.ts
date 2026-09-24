import { handScore } from "../../poker/eval";
import type { Utility } from "../toy/game";
import {
  riverCardObject,
  riverComboKey,
  riverCombosOverlap,
  type RiverCombo,
} from "./cards";
import type { RiverAction, RiverGame, RiverScenario } from "./game";

export const RIVER_TERMINAL_HISTORIES = [
  ["check", "check"],
  ["check", "bet-half", "fold"],
  ["check", "bet-half", "call"],
  ["check", "bet-half", "raise-all-in", "fold"],
  ["check", "bet-half", "raise-all-in", "call"],
  ["check", "bet-pot", "fold"],
  ["check", "bet-pot", "call"],
  ["bet-half", "fold"],
  ["bet-half", "call"],
  ["bet-half", "raise-all-in", "fold"],
  ["bet-half", "raise-all-in", "call"],
  ["bet-pot", "fold"],
  ["bet-pot", "call"],
] as const satisfies readonly (readonly RiverAction[])[];

export interface RiverOracleDeal {
  readonly hands: readonly [RiverCombo, RiverCombo];
  readonly probability: number;
}

export interface RiverRulesAudit {
  readonly dealsChecked: number;
  readonly terminalsChecked: number;
  readonly maximumProbabilityDifference: number;
  readonly maximumUtilityDifference: number;
  readonly maximumZeroSumError: number;
}

function label(history: readonly RiverAction[]): string {
  return history.join("-");
}

/**
 * A deliberately separate joint-range calculation used to audit the game factory.
 * It enumerates the two input ranges directly and normalizes only after collisions
 * have been removed.
 */
export function oracleRiverDeals(scenario: RiverScenario): readonly RiverOracleDeal[] {
  const compatible: { hands: readonly [RiverCombo, RiverCombo]; weight: number }[] = [];
  for (const left of scenario.ranges[0]) {
    for (const right of scenario.ranges[1]) {
      if (!riverCombosOverlap(left.cards, right.cards)) {
        compatible.push({
          hands: [left.cards, right.cards],
          weight: left.weight * right.weight,
        });
      }
    }
  }
  const total = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Oracle found no compatible river deals");
  return compatible.map(deal => ({ hands: deal.hands, probability: deal.weight / total }));
}

/**
 * Independent contribution table for every terminal history in river v1. Sizes are
 * derived from the v1 rules themselves (half-pot, pot, and the all-in stack) rather
 * than read from `scenario.betSizes`, so a mis-sized game factory is still caught.
 */
export function oracleRiverContributions(
  scenario: RiverScenario,
  history: readonly RiverAction[],
): readonly [number, number] {
  const beforeRiver = scenario.committed;
  const startingPot = beforeRiver[0] + beforeRiver[1];
  const half = startingPot / 2;
  const pot = startingPot;
  const allIn: readonly [number, number] = [scenario.stackBehind[0], scenario.stackBehind[1]];
  const put = (river0: number, river1: number): readonly [number, number] =>
    [beforeRiver[0] + river0, beforeRiver[1] + river1];
  switch (label(history)) {
    case "check-check":
      return put(0, 0);
    case "bet-half-fold":
      return put(half, 0);
    case "bet-half-call":
      return put(half, half);
    case "bet-half-raise-all-in-fold":
      return put(half, allIn[1]);
    case "bet-half-raise-all-in-call":
      return put(Math.min(allIn[0], allIn[1]), allIn[1]);
    case "bet-pot-fold":
      return put(pot, 0);
    case "bet-pot-call":
      return put(pot, Math.min(pot, allIn[1]));
    case "check-bet-half-fold":
      return put(0, half);
    case "check-bet-half-call":
      return put(half, half);
    case "check-bet-half-raise-all-in-fold":
      return put(allIn[0], half);
    case "check-bet-half-raise-all-in-call":
      return put(allIn[0], Math.min(allIn[0], allIn[1]));
    case "check-bet-pot-fold":
      return put(0, pot);
    case "check-bet-pot-call":
      return put(Math.min(pot, allIn[0]), pot);
    default:
      throw new Error(`Oracle does not recognize terminal river history ${label(history)}`);
  }
}

function slowShowdownWinner(
  scenario: RiverScenario,
  hands: readonly [RiverCombo, RiverCombo],
): 0 | 1 | null {
  const board = scenario.board.map(riverCardObject);
  const scores = hands.map(hand => handScore(hand.map(riverCardObject), board));
  return scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
}

/**
 * Terminal payoff oracle. It uses the slow five-of-seven evaluator and a separate
 * contribution table, so it can catch mistakes in both the fast evaluator wiring and
 * the state machine's pot accounting.
 */
export function oracleRiverUtility(
  scenario: RiverScenario,
  hands: readonly [RiverCombo, RiverCombo],
  history: readonly RiverAction[],
): Utility {
  const contributions = oracleRiverContributions(scenario, history);
  const pot = contributions[0] + contributions[1];
  let winner: 0 | 1 | null;
  switch (label(history)) {
    case "bet-half-fold":
    case "bet-pot-fold":
    case "check-bet-half-raise-all-in-fold":
      winner = 0;
      break;
    case "check-bet-half-fold":
    case "check-bet-pot-fold":
    case "bet-half-raise-all-in-fold":
      winner = 1;
      break;
    default:
      winner = slowShowdownWinner(scenario, hands);
  }
  if (winner === null) return [pot / 2 - contributions[0], pot / 2 - contributions[1]];
  return winner === 0
    ? [pot - contributions[0], -contributions[1]]
    : [-contributions[0], pot - contributions[1]];
}

function dealKey(hands: readonly [RiverCombo, RiverCombo]): string {
  return `${riverComboKey(hands[0])}|${riverComboKey(hands[1])}`;
}

/** Compare every chance edge and terminal payoff with the independent oracle. */
export function auditRiverRules(game: RiverGame): RiverRulesAudit {
  const oracleDeals = oracleRiverDeals(game.scenario);
  const gameProbabilities = new Map(game.deals.map(deal => [dealKey(deal.outcome.hands), deal.probability]));
  let maximumProbabilityDifference = 0;
  let maximumUtilityDifference = 0;
  let maximumZeroSumError = 0;
  let terminalsChecked = 0;

  for (const deal of oracleDeals) {
    const actualProbability = gameProbabilities.get(dealKey(deal.hands));
    if (actualProbability === undefined) throw new Error(`Game omitted oracle deal ${dealKey(deal.hands)}`);
    maximumProbabilityDifference = Math.max(
      maximumProbabilityDifference,
      Math.abs(actualProbability - deal.probability),
    );

    for (const history of RIVER_TERMINAL_HISTORIES) {
      let state = game.nextChance(game.initialState(), { hands: deal.hands });
      for (const action of history) state = game.nextAction(state, action);
      const node = game.node(state);
      if (node.kind !== "terminal") throw new Error(`Game history ${label(history)} did not terminate`);
      const expected = oracleRiverUtility(game.scenario, deal.hands, history);
      maximumUtilityDifference = Math.max(
        maximumUtilityDifference,
        Math.abs(node.utility[0] - expected[0]),
        Math.abs(node.utility[1] - expected[1]),
      );
      maximumZeroSumError = Math.max(maximumZeroSumError, Math.abs(node.utility[0] + node.utility[1]));
      terminalsChecked += 1;
    }
  }

  if (gameProbabilities.size !== oracleDeals.length) throw new Error("Game contains a deal omitted by the oracle");
  return {
    dealsChecked: oracleDeals.length,
    terminalsChecked,
    maximumProbabilityDifference,
    maximumUtilityDifference,
    maximumZeroSumError,
  };
}
