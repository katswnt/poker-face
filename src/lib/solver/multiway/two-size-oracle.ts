import { handScore } from "../../poker/eval";
import {
  riverCardObject,
  riverComboKey,
  riverCombosOverlap,
  type RiverCombo,
} from "../river/cards";
import type { ThreePlayers } from "./river-game";
import type {
  TwoSizeRiverAction,
  TwoSizeRiverGame,
  TwoSizeRiverScenario,
} from "./two-size-river-game";

export const TWO_SIZE_RIVER_TERMINAL_HISTORIES = [
  ["check", "check", "check"],
  ["check", "check", "bet-30", "fold", "fold"],
  ["check", "check", "bet-30", "fold", "call"],
  ["check", "check", "bet-30", "fold", "raise-all-in", "fold"],
  ["check", "check", "bet-30", "fold", "raise-all-in", "call"],
  ["check", "check", "bet-30", "call", "fold"],
  ["check", "check", "bet-30", "call", "call"],
  ["check", "check", "bet-30", "call", "raise-all-in", "fold", "fold"],
  ["check", "check", "bet-30", "call", "raise-all-in", "fold", "call"],
  ["check", "check", "bet-30", "call", "raise-all-in", "call", "fold"],
  ["check", "check", "bet-30", "call", "raise-all-in", "call", "call"],
  ["check", "check", "bet-30", "raise-all-in", "fold", "fold"],
  ["check", "check", "bet-30", "raise-all-in", "fold", "call"],
  ["check", "check", "bet-30", "raise-all-in", "call", "fold"],
  ["check", "check", "bet-30", "raise-all-in", "call", "call"],
  ["check", "check", "bet-all-in", "fold", "fold"],
  ["check", "check", "bet-all-in", "fold", "call"],
  ["check", "check", "bet-all-in", "call", "fold"],
  ["check", "check", "bet-all-in", "call", "call"],
  ["check", "bet-30", "fold", "fold"],
  ["check", "bet-30", "fold", "call"],
  ["check", "bet-30", "fold", "raise-all-in", "fold"],
  ["check", "bet-30", "fold", "raise-all-in", "call"],
  ["check", "bet-30", "call", "fold"],
  ["check", "bet-30", "call", "call"],
  ["check", "bet-30", "call", "raise-all-in", "fold", "fold"],
  ["check", "bet-30", "call", "raise-all-in", "fold", "call"],
  ["check", "bet-30", "call", "raise-all-in", "call", "fold"],
  ["check", "bet-30", "call", "raise-all-in", "call", "call"],
  ["check", "bet-30", "raise-all-in", "fold", "fold"],
  ["check", "bet-30", "raise-all-in", "fold", "call"],
  ["check", "bet-30", "raise-all-in", "call", "fold"],
  ["check", "bet-30", "raise-all-in", "call", "call"],
  ["check", "bet-all-in", "fold", "fold"],
  ["check", "bet-all-in", "fold", "call"],
  ["check", "bet-all-in", "call", "fold"],
  ["check", "bet-all-in", "call", "call"],
  ["bet-30", "fold", "fold"],
  ["bet-30", "fold", "call"],
  ["bet-30", "fold", "raise-all-in", "fold"],
  ["bet-30", "fold", "raise-all-in", "call"],
  ["bet-30", "call", "fold"],
  ["bet-30", "call", "call"],
  ["bet-30", "call", "raise-all-in", "fold", "fold"],
  ["bet-30", "call", "raise-all-in", "fold", "call"],
  ["bet-30", "call", "raise-all-in", "call", "fold"],
  ["bet-30", "call", "raise-all-in", "call", "call"],
  ["bet-30", "raise-all-in", "fold", "fold"],
  ["bet-30", "raise-all-in", "fold", "call"],
  ["bet-30", "raise-all-in", "call", "fold"],
  ["bet-30", "raise-all-in", "call", "call"],
  ["bet-all-in", "fold", "fold"],
  ["bet-all-in", "fold", "call"],
  ["bet-all-in", "call", "fold"],
  ["bet-all-in", "call", "call"],
] as const satisfies readonly (readonly TwoSizeRiverAction[])[];

export interface TwoSizeOracleDeal {
  readonly hands: ThreePlayers<RiverCombo>;
  readonly probability: number;
}

export interface TwoSizeRiverRulesAudit {
  readonly dealsChecked: number;
  readonly terminalsChecked: number;
  readonly maximumProbabilityDifference: number;
  readonly maximumUtilityDifference: number;
  readonly maximumReturnedUncalledDifference: number;
  readonly maximumContestablePotDifference: number;
  readonly maximumZeroSumError: number;
}

interface OraclePublicState {
  readonly active: ThreePlayers<boolean>;
  readonly extra: ThreePlayers<number>;
  readonly actor: number | null;
  readonly currentBet: number;
  readonly raisesUsed: 0 | 1;
  readonly pending: readonly number[];
  readonly checked: number;
  readonly terminal: boolean;
}

interface OracleSettlement {
  readonly utility: ThreePlayers<number>;
  readonly returnedUncalled: ThreePlayers<number>;
  readonly contestablePot: number;
}

function asThree<T>(values: readonly T[]): ThreePlayers<T> {
  if (values.length !== 3) throw new Error("Two-size oracle expected exactly three values");
  return [values[0], values[1], values[2]];
}

function historyLabel(history: readonly TwoSizeRiverAction[]): string {
  return history.join("-");
}

function seatsAfter(player: number): readonly number[] {
  return [1, 2].map(offset => (player + offset) % 3);
}

/** A separate triple loop checks blocker removal and exact chance weights. */
export function oracleTwoSizeRiverDeals(
  scenario: TwoSizeRiverScenario,
): readonly TwoSizeOracleDeal[] {
  const compatible: { hands: ThreePlayers<RiverCombo>; weight: number }[] = [];
  for (const first of scenario.ranges[0]) {
    for (const second of scenario.ranges[1]) {
      for (const third of scenario.ranges[2]) {
        if (
          riverCombosOverlap(first.cards, second.cards) ||
          riverCombosOverlap(first.cards, third.cards) ||
          riverCombosOverlap(second.cards, third.cards)
        ) continue;
        compatible.push({
          hands: [first.cards, second.cards, third.cards],
          weight: first.weight * second.weight * third.weight,
        });
      }
    }
  }
  const totalWeight = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) throw new Error("Two-size oracle found no deals");
  return compatible.map(deal => ({ hands: deal.hands, probability: deal.weight / totalWeight }));
}

function replayTwoSizeHistory(
  scenario: TwoSizeRiverScenario,
  history: readonly TwoSizeRiverAction[],
): OraclePublicState {
  let state: OraclePublicState = {
    active: [true, true, true],
    extra: [0, 0, 0],
    actor: 0,
    currentBet: 0,
    raisesUsed: 0,
    pending: [],
    checked: 0,
    terminal: false,
  };
  for (const action of history) {
    if (state.terminal || state.actor === null) {
      throw new Error(`Two-size oracle found an action after ${historyLabel(history)}`);
    }
    const player = state.actor;
    const active = [...state.active] as [boolean, boolean, boolean];
    const extra = [...state.extra] as [number, number, number];
    if (state.currentBet === 0) {
      if (action === "check") {
        const checked = state.checked + 1;
        state = {
          ...state,
          actor: checked === 3 ? null : (player + 1) % 3,
          checked,
          terminal: checked === 3,
        };
        continue;
      }
      if (action !== "bet-30" && action !== "bet-all-in") {
        throw new Error(`Two-size oracle rejects ${action} with no open bet`);
      }
      const amount = action === "bet-30" ? scenario.smallBet : scenario.allInBet;
      extra[player] = amount;
      const pending = seatsAfter(player);
      state = { ...state, extra, actor: pending[0], currentBet: amount, pending };
      continue;
    }
    if (state.pending[0] !== player) throw new Error("Two-size oracle response order is broken");
    if (action === "raise-all-in") {
      if (state.raisesUsed !== 0 || state.currentBet !== scenario.smallBet) {
        throw new Error("Two-size oracle rejects this raise");
      }
      extra[player] = scenario.allInBet;
      const pending = seatsAfter(player)
        .filter(seat => active[seat] && extra[seat] < scenario.allInBet);
      if (pending.length === 0) throw new Error("Two-size oracle found a raise with no responder");
      state = {
        ...state,
        extra,
        actor: pending[0],
        currentBet: scenario.allInBet,
        raisesUsed: 1,
        pending,
      };
      continue;
    }
    if (action !== "fold" && action !== "call") {
      throw new Error(`Two-size oracle rejects ${action} facing a bet`);
    }
    if (action === "fold") active[player] = false;
    else extra[player] = state.currentBet;
    const pending = state.pending.slice(1);
    const terminal = active.filter(Boolean).length === 1 || pending.length === 0;
    state = { ...state, active, extra, actor: terminal ? null : pending[0], pending, terminal };
  }
  if (!state.terminal) throw new Error(`${historyLabel(history)} is not terminal in the oracle`);
  return state;
}

export function oracleTwoSizeRiverSettlement(
  scenario: TwoSizeRiverScenario,
  hands: TwoSizeOracleDeal["hands"],
  history: readonly TwoSizeRiverAction[],
): OracleSettlement {
  const state = replayTwoSizeHistory(scenario, history);
  const contributions = asThree(
    scenario.committed.map((committed, player) => committed + state.extra[player]),
  );
  const ranked = contributions.map((value, player) => ({ value, player }))
    .sort((left, right) => right.value - left.value || left.player - right.player);
  const returned = [0, 0, 0];
  if (ranked[0].value > ranked[1].value) {
    returned[ranked[0].player] = ranked[0].value - ranked[1].value;
  }
  const returnedUncalled = asThree(returned);
  const contestablePot = contributions.reduce((sum, value) => sum + value, 0) -
    returnedUncalled.reduce((sum, value) => sum + value, 0);
  const activePlayers = state.active.map((active, player) => active ? player : null)
    .filter((player): player is number => player !== null);
  if (activePlayers.length === 0) throw new Error("Two-size oracle terminal has no active player");
  let winners = activePlayers;
  if (activePlayers.length > 1) {
    const board = scenario.board.map(riverCardObject);
    const scores = activePlayers.map(player => ({
      player,
      score: handScore(hands[player].map(riverCardObject), board),
    }));
    const best = Math.max(...scores.map(result => result.score));
    winners = scores.filter(result => result.score === best).map(result => result.player);
  }
  const share = contestablePot / winners.length;
  return {
    returnedUncalled,
    contestablePot,
    utility: asThree(contributions.map((contribution, player) =>
      returnedUncalled[player] + (winners.includes(player) ? share : 0) - contribution)),
  };
}

function dealKey(hands: TwoSizeOracleDeal["hands"]): string {
  return hands.map(riverComboKey).join("|");
}

/** Compare every exact deal and terminal against an independent replay and evaluator. */
export function auditTwoSizeRiverRules(game: TwoSizeRiverGame): TwoSizeRiverRulesAudit {
  const oracleDeals = oracleTwoSizeRiverDeals(game.scenario);
  const probabilities = new Map(game.deals.map(deal => [dealKey(deal.outcome.hands), deal.probability]));
  let maximumProbabilityDifference = 0;
  let maximumUtilityDifference = 0;
  let maximumReturnedUncalledDifference = 0;
  let maximumContestablePotDifference = 0;
  let maximumZeroSumError = 0;
  let terminalsChecked = 0;
  for (const deal of oracleDeals) {
    const probability = probabilities.get(dealKey(deal.hands));
    if (probability === undefined) throw new Error(`Game omitted oracle deal ${dealKey(deal.hands)}`);
    maximumProbabilityDifference = Math.max(
      maximumProbabilityDifference,
      Math.abs(probability - deal.probability),
    );
    for (const history of TWO_SIZE_RIVER_TERMINAL_HISTORIES) {
      let state = game.nextChance(game.initialState(), { hands: deal.hands });
      for (const action of history) state = game.nextAction(state, action);
      const node = game.node(state);
      if (node.kind !== "terminal") throw new Error(`${historyLabel(history)} did not terminate`);
      const settlement = game.settlement(state);
      const expected = oracleTwoSizeRiverSettlement(game.scenario, deal.hands, history);
      for (let player = 0; player < 3; player += 1) {
        maximumUtilityDifference = Math.max(
          maximumUtilityDifference,
          Math.abs(node.utility[player] - expected.utility[player]),
        );
        maximumReturnedUncalledDifference = Math.max(
          maximumReturnedUncalledDifference,
          Math.abs(settlement.returnedUncalled[player] - expected.returnedUncalled[player]),
        );
      }
      maximumContestablePotDifference = Math.max(
        maximumContestablePotDifference,
        Math.abs(settlement.contestablePot - expected.contestablePot),
      );
      maximumZeroSumError = Math.max(
        maximumZeroSumError,
        Math.abs(node.utility.reduce((sum, value) => sum + value, 0)),
      );
      terminalsChecked += 1;
    }
  }
  if (probabilities.size !== oracleDeals.length) throw new Error("Oracle omitted a two-size game deal");
  return {
    dealsChecked: oracleDeals.length,
    terminalsChecked,
    maximumProbabilityDifference,
    maximumUtilityDifference,
    maximumReturnedUncalledDifference,
    maximumContestablePotDifference,
    maximumZeroSumError,
  };
}
