import { handScore } from "../../poker/eval";
import { riverCardObject, riverComboKey, riverCombosOverlap } from "../river/cards";
import type {
  MultiwayRiverAction,
  MultiwayRiverGame,
  MultiwayRiverScenario,
  ThreePlayers,
} from "./river-game";

export const MULTIWAY_RIVER_TERMINAL_HISTORIES = [
  ["bet", "fold", "fold"],
  ["bet", "fold", "call"],
  ["bet", "call", "fold"],
  ["bet", "call", "call"],
  ["check", "bet", "fold", "fold"],
  ["check", "bet", "fold", "call"],
  ["check", "bet", "call", "fold"],
  ["check", "bet", "call", "call"],
  ["check", "check", "check"],
  ["check", "check", "bet", "fold", "fold"],
  ["check", "check", "bet", "fold", "call"],
  ["check", "check", "bet", "call", "fold"],
  ["check", "check", "bet", "call", "call"],
] as const satisfies readonly (readonly MultiwayRiverAction[])[];

export interface MultiwayOracleDeal {
  readonly hands: ThreePlayers<import("../river/cards").RiverCombo>;
  readonly probability: number;
}

export interface MultiwayRiverRulesAudit {
  readonly dealsChecked: number;
  readonly terminalsChecked: number;
  readonly maximumProbabilityDifference: number;
  readonly maximumUtilityDifference: number;
  readonly maximumZeroSumError: number;
}

interface TerminalTableEntry {
  readonly extra: ThreePlayers<number>;
  readonly active: ThreePlayers<boolean>;
}

const TERMINAL_TABLE: Readonly<Record<string, TerminalTableEntry>> = {
  "bet-fold-fold": { extra: [30, 0, 0], active: [true, false, false] },
  "bet-fold-call": { extra: [30, 0, 30], active: [true, false, true] },
  "bet-call-fold": { extra: [30, 30, 0], active: [true, true, false] },
  "bet-call-call": { extra: [30, 30, 30], active: [true, true, true] },
  "check-bet-fold-fold": { extra: [0, 30, 0], active: [false, true, false] },
  "check-bet-fold-call": { extra: [30, 30, 0], active: [true, true, false] },
  "check-bet-call-fold": { extra: [0, 30, 30], active: [false, true, true] },
  "check-bet-call-call": { extra: [30, 30, 30], active: [true, true, true] },
  "check-check-check": { extra: [0, 0, 0], active: [true, true, true] },
  "check-check-bet-fold-fold": { extra: [0, 0, 30], active: [false, false, true] },
  "check-check-bet-fold-call": { extra: [0, 30, 30], active: [false, true, true] },
  "check-check-bet-call-fold": { extra: [30, 0, 30], active: [true, false, true] },
  "check-check-bet-call-call": { extra: [30, 30, 30], active: [true, true, true] },
};

function label(history: readonly MultiwayRiverAction[]): string {
  return history.join("-");
}

function asThree<T>(values: readonly T[]): ThreePlayers<T> {
  if (values.length !== 3) throw new Error("Oracle expected exactly three values");
  return [values[0], values[1], values[2]];
}

/** Separate triple loop used to audit blocker removal and chance normalization. */
export function oracleMultiwayRiverDeals(
  scenario: MultiwayRiverScenario,
): readonly MultiwayOracleDeal[] {
  const compatible: { hands: MultiwayOracleDeal["hands"]; weight: number }[] = [];
  for (const first of scenario.ranges[0]) {
    for (const second of scenario.ranges[1]) {
      for (const third of scenario.ranges[2]) {
        const cards = [first.cards, second.cards, third.cards] as const;
        if (
          riverCombosOverlap(cards[0], cards[1]) ||
          riverCombosOverlap(cards[0], cards[2]) ||
          riverCombosOverlap(cards[1], cards[2])
        ) continue;
        compatible.push({ hands: cards, weight: first.weight * second.weight * third.weight });
      }
    }
  }
  const totalWeight = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) throw new Error("Oracle found no compatible deals");
  return compatible.map(deal => ({ hands: deal.hands, probability: deal.weight / totalWeight }));
}

export function oracleMultiwayRiverUtility(
  scenario: MultiwayRiverScenario,
  hands: MultiwayOracleDeal["hands"],
  history: readonly MultiwayRiverAction[],
): ThreePlayers<number> {
  const table = TERMINAL_TABLE[label(history)];
  if (!table) throw new Error(`Oracle does not recognize terminal history ${label(history)}`);
  if (table.extra.some(value => value !== 0 && value !== scenario.betSize)) {
    throw new Error("Oracle terminal table does not match the configured bet size");
  }
  const contributions = asThree(
    scenario.committed.map((committed, player) => committed + table.extra[player]),
  );
  const active = table.active.map((isActive, player) => isActive ? player : null)
    .filter((player): player is number => player !== null);
  if (active.length === 0) throw new Error("Oracle terminal has no active player");
  let winners = active;
  if (active.length > 1) {
    const board = scenario.board.map(riverCardObject);
    const scores = active.map(player => ({
      player,
      score: handScore(hands[player].map(riverCardObject), board),
    }));
    const best = Math.max(...scores.map(result => result.score));
    winners = scores.filter(result => result.score === best).map(result => result.player);
  }
  const pot = contributions.reduce((sum, contribution) => sum + contribution, 0);
  const share = pot / winners.length;
  return asThree(contributions.map((contribution, player) =>
    winners.includes(player) ? share - contribution : -contribution));
}

function dealKey(hands: MultiwayOracleDeal["hands"]): string {
  return hands.map(riverComboKey).join("|");
}

/** Compare every exact deal and terminal with the deliberately separate oracle. */
export function auditMultiwayRiverRules(game: MultiwayRiverGame): MultiwayRiverRulesAudit {
  const oracleDeals = oracleMultiwayRiverDeals(game.scenario);
  const probabilities = new Map(game.deals.map(deal => [dealKey(deal.outcome.hands), deal.probability]));
  let maximumProbabilityDifference = 0;
  let maximumUtilityDifference = 0;
  let maximumZeroSumError = 0;
  let terminalsChecked = 0;

  for (const deal of oracleDeals) {
    const probability = probabilities.get(dealKey(deal.hands));
    if (probability === undefined) throw new Error(`Game omitted oracle deal ${dealKey(deal.hands)}`);
    maximumProbabilityDifference = Math.max(
      maximumProbabilityDifference,
      Math.abs(probability - deal.probability),
    );
    for (const history of MULTIWAY_RIVER_TERMINAL_HISTORIES) {
      let state = game.nextChance(game.initialState(), { hands: deal.hands });
      for (const action of history) state = game.nextAction(state, action);
      const node = game.node(state);
      if (node.kind !== "terminal") throw new Error(`${label(history)} did not terminate`);
      const expected = oracleMultiwayRiverUtility(game.scenario, deal.hands, history);
      for (let player = 0; player < 3; player += 1) {
        maximumUtilityDifference = Math.max(
          maximumUtilityDifference,
          Math.abs(node.utility[player] - expected[player]),
        );
      }
      maximumZeroSumError = Math.max(
        maximumZeroSumError,
        Math.abs(node.utility.reduce((sum, value) => sum + value, 0)),
      );
      terminalsChecked += 1;
    }
  }
  if (probabilities.size !== oracleDeals.length) throw new Error("Game contains a deal omitted by the oracle");
  return {
    dealsChecked: oracleDeals.length,
    terminalsChecked,
    maximumProbabilityDifference,
    maximumUtilityDifference,
    maximumZeroSumError,
  };
}
