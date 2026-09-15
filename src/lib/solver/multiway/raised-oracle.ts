import { handScore } from "../../poker/eval";
import {
  riverCardObject,
  riverComboKey,
  riverCombosOverlap,
  type RiverCombo,
} from "../river/cards";
import type { ThreePlayers } from "./river-game";
import type {
  RaisedRiverAction,
  RaisedRiverGame,
  RaisedRiverScenario,
} from "./raised-river-game";

export const RAISED_RIVER_TERMINAL_HISTORIES = [
  ["check", "check", "check"],
  ["check", "check", "bet", "fold", "fold"],
  ["check", "check", "bet", "fold", "call"],
  ["check", "check", "bet", "fold", "raise-all-in", "fold"],
  ["check", "check", "bet", "fold", "raise-all-in", "call"],
  ["check", "check", "bet", "call", "fold"],
  ["check", "check", "bet", "call", "call"],
  ["check", "check", "bet", "call", "raise-all-in", "fold", "fold"],
  ["check", "check", "bet", "call", "raise-all-in", "fold", "call"],
  ["check", "check", "bet", "call", "raise-all-in", "call", "fold"],
  ["check", "check", "bet", "call", "raise-all-in", "call", "call"],
  ["check", "check", "bet", "raise-all-in", "fold", "fold"],
  ["check", "check", "bet", "raise-all-in", "fold", "call"],
  ["check", "check", "bet", "raise-all-in", "call", "fold"],
  ["check", "check", "bet", "raise-all-in", "call", "call"],
  ["check", "bet", "fold", "fold"],
  ["check", "bet", "fold", "call"],
  ["check", "bet", "fold", "raise-all-in", "fold"],
  ["check", "bet", "fold", "raise-all-in", "call"],
  ["check", "bet", "call", "fold"],
  ["check", "bet", "call", "call"],
  ["check", "bet", "call", "raise-all-in", "fold", "fold"],
  ["check", "bet", "call", "raise-all-in", "fold", "call"],
  ["check", "bet", "call", "raise-all-in", "call", "fold"],
  ["check", "bet", "call", "raise-all-in", "call", "call"],
  ["check", "bet", "raise-all-in", "fold", "fold"],
  ["check", "bet", "raise-all-in", "fold", "call"],
  ["check", "bet", "raise-all-in", "call", "fold"],
  ["check", "bet", "raise-all-in", "call", "call"],
  ["bet", "fold", "fold"],
  ["bet", "fold", "call"],
  ["bet", "fold", "raise-all-in", "fold"],
  ["bet", "fold", "raise-all-in", "call"],
  ["bet", "call", "fold"],
  ["bet", "call", "call"],
  ["bet", "call", "raise-all-in", "fold", "fold"],
  ["bet", "call", "raise-all-in", "fold", "call"],
  ["bet", "call", "raise-all-in", "call", "fold"],
  ["bet", "call", "raise-all-in", "call", "call"],
  ["bet", "raise-all-in", "fold", "fold"],
  ["bet", "raise-all-in", "fold", "call"],
  ["bet", "raise-all-in", "call", "fold"],
  ["bet", "raise-all-in", "call", "call"],
] as const satisfies readonly (readonly RaisedRiverAction[])[];

export interface RaisedRiverOracleDeal {
  readonly hands: ThreePlayers<RiverCombo>;
  readonly probability: number;
}

export interface RaisedRiverRulesAudit {
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
  if (values.length !== 3) throw new Error("Raised oracle expected exactly three values");
  return [values[0], values[1], values[2]];
}

function historyLabel(history: readonly RaisedRiverAction[]): string {
  return history.join("-");
}

function seatsAfter(player: number): readonly number[] {
  return [1, 2].map(offset => (player + offset) % 3);
}

/** A separate triple loop checks blocker removal and chance normalization. */
export function oracleRaisedRiverDeals(
  scenario: RaisedRiverScenario,
): readonly RaisedRiverOracleDeal[] {
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
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error("Raised oracle found no compatible deals");
  }
  return compatible.map(deal => ({
    hands: deal.hands,
    probability: deal.weight / totalWeight,
  }));
}

function replayRaisedHistory(
  scenario: RaisedRiverScenario,
  history: readonly RaisedRiverAction[],
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
      throw new Error(`Raised oracle found an action after ${historyLabel(history)}`);
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
      if (action !== "bet") throw new Error(`Raised oracle rejects ${action} with no open bet`);
      extra[player] = scenario.betSize;
      const pending = seatsAfter(player);
      state = {
        ...state,
        extra,
        actor: pending[0],
        currentBet: scenario.betSize,
        pending,
      };
      continue;
    }
    if (state.pending[0] !== player) throw new Error("Raised oracle response order is broken");
    if (action === "raise-all-in") {
      if (state.raisesUsed !== 0 || state.currentBet !== scenario.betSize) {
        throw new Error("Raised oracle rejects a second raise");
      }
      extra[player] = scenario.raiseTo;
      const pending = seatsAfter(player).filter(seat => active[seat] && extra[seat] < scenario.raiseTo);
      if (pending.length === 0) throw new Error("Raised oracle found a raise with no responder");
      state = {
        ...state,
        extra,
        actor: pending[0],
        currentBet: scenario.raiseTo,
        raisesUsed: 1,
        pending,
      };
      continue;
    }
    if (action !== "fold" && action !== "call") {
      throw new Error(`Raised oracle rejects ${action} facing a bet`);
    }
    if (action === "fold") active[player] = false;
    else extra[player] = state.currentBet;
    const pending = state.pending.slice(1);
    const terminal = active.filter(Boolean).length === 1 || pending.length === 0;
    state = {
      ...state,
      active,
      extra,
      actor: terminal ? null : pending[0],
      pending,
      terminal,
    };
  }
  if (!state.terminal) throw new Error(`${historyLabel(history)} is not terminal in the raised oracle`);
  return state;
}

export function oracleRaisedRiverSettlement(
  scenario: RaisedRiverScenario,
  hands: RaisedRiverOracleDeal["hands"],
  history: readonly RaisedRiverAction[],
): OracleSettlement {
  const state = replayRaisedHistory(scenario, history);
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
  if (activePlayers.length === 0) throw new Error("Raised oracle terminal has no active player");
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
  const utility = asThree(contributions.map((contribution, player) =>
    returnedUncalled[player] + (winners.includes(player) ? share : 0) - contribution));
  return { utility, returnedUncalled, contestablePot };
}

function dealKey(hands: RaisedRiverOracleDeal["hands"]): string {
  return hands.map(riverComboKey).join("|");
}

/** Compare every exact deal and terminal with the independent replay and slow evaluator. */
export function auditRaisedRiverRules(game: RaisedRiverGame): RaisedRiverRulesAudit {
  const oracleDeals = oracleRaisedRiverDeals(game.scenario);
  const probabilities = new Map(game.deals.map(deal => [dealKey(deal.outcome.hands), deal.probability]));
  let maximumProbabilityDifference = 0;
  let maximumUtilityDifference = 0;
  let maximumReturnedUncalledDifference = 0;
  let maximumContestablePotDifference = 0;
  let maximumZeroSumError = 0;
  let terminalsChecked = 0;
  for (const deal of oracleDeals) {
    const probability = probabilities.get(dealKey(deal.hands));
    if (probability === undefined) throw new Error(`Game omitted raised oracle deal ${dealKey(deal.hands)}`);
    maximumProbabilityDifference = Math.max(
      maximumProbabilityDifference,
      Math.abs(probability - deal.probability),
    );
    for (const history of RAISED_RIVER_TERMINAL_HISTORIES) {
      let state = game.nextChance(game.initialState(), { hands: deal.hands });
      for (const action of history) state = game.nextAction(state, action);
      const node = game.node(state);
      if (node.kind !== "terminal") throw new Error(`${historyLabel(history)} did not terminate`);
      const settlement = game.settlement(state);
      const expected = oracleRaisedRiverSettlement(game.scenario, deal.hands, history);
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
  if (probabilities.size !== oracleDeals.length) {
    throw new Error("Raised game contains a deal omitted by the oracle");
  }
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
