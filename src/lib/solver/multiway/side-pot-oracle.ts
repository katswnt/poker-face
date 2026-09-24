import { handScore } from "../../poker/eval";
import {
  riverCardObject,
  riverComboKey,
  riverCombosOverlap,
  type RiverCombo,
} from "../river/cards";
import type { ThreePlayers } from "./river-game";
import type {
  SidePotLayer,
  SidePotRiverAction,
  SidePotRiverGame,
  SidePotRiverScenario,
} from "./side-pot-river-game";

export const SIDE_POT_RIVER_TERMINAL_HISTORIES = [
  ["check", "check", "check"],
  ["check", "check", "bet-30", "fold", "fold"],
  ["check", "check", "bet-30", "fold", "call"],
  ["check", "check", "bet-30", "fold", "raise-all-in", "fold"],
  ["check", "check", "bet-30", "fold", "raise-all-in", "call"],
  ["check", "check", "bet-30", "call", "fold"],
  ["check", "check", "bet-30", "call", "call"],
  ["check", "check", "bet-30", "call", "raise-all-in", "fold"],
  ["check", "check", "bet-30", "call", "raise-all-in", "call"],
  ["check", "check", "bet-all-in", "fold", "fold"],
  ["check", "check", "bet-all-in", "fold", "call"],
  ["check", "check", "bet-all-in", "call", "fold"],
  ["check", "check", "bet-all-in", "call", "call"],
  ["check", "bet-30", "fold", "fold"],
  ["check", "bet-30", "fold", "call"],
  ["check", "bet-30", "call", "fold"],
  ["check", "bet-30", "call", "call"],
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
  ["bet-30", "call", "fold"],
  ["bet-30", "call", "call"],
  ["bet-30", "call", "raise-all-in", "fold"],
  ["bet-30", "call", "raise-all-in", "call"],
  ["bet-30", "raise-all-in", "fold"],
  ["bet-30", "raise-all-in", "call"],
] as const satisfies readonly (readonly SidePotRiverAction[])[];

export interface SidePotOracleDeal {
  readonly hands: ThreePlayers<RiverCombo>;
  readonly probability: number;
}

export interface SidePotRulesAudit {
  readonly dealsChecked: number;
  readonly terminalsChecked: number;
  readonly maximumProbabilityDifference: number;
  readonly maximumUtilityDifference: number;
  readonly maximumReturnedUncalledDifference: number;
  readonly maximumContestablePotDifference: number;
  readonly maximumLayerAmountDifference: number;
  readonly layerStructureMismatches: number;
  readonly maximumZeroSumError: number;
}

interface OracleState {
  readonly active: ThreePlayers<boolean>;
  readonly extra: ThreePlayers<number>;
  readonly actor: number | null;
  readonly currentBet: number;
  readonly raisesUsed: 0 | 1;
  readonly pending: readonly number[];
  readonly checked: number;
  readonly terminal: boolean;
}

interface OracleLayer {
  readonly amount: number;
  readonly contributingPlayers: readonly number[];
  readonly eligiblePlayers: readonly number[];
  readonly winners: readonly number[];
  readonly awards: ThreePlayers<number>;
}

interface OracleSettlement {
  readonly utility: ThreePlayers<number>;
  readonly returnedUncalled: ThreePlayers<number>;
  readonly contestablePot: number;
  readonly potLayers: readonly OracleLayer[];
}

function asThree<T>(values: readonly T[]): ThreePlayers<T> {
  if (values.length !== 3) throw new Error("Side-pot oracle expected exactly three values");
  return [values[0], values[1], values[2]];
}

function seatsAfter(player: number): readonly number[] {
  return [1, 2].map(offset => (player + offset) % 3);
}

function label(history: readonly SidePotRiverAction[]): string {
  return history.join("-");
}

export function oracleSidePotDeals(
  scenario: SidePotRiverScenario,
): readonly SidePotOracleDeal[] {
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
  const total = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Side-pot oracle found no deals");
  return compatible.map(deal => ({ hands: deal.hands, probability: deal.weight / total }));
}

function replay(
  scenario: SidePotRiverScenario,
  history: readonly SidePotRiverAction[],
): OracleState {
  let state: OracleState = {
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
    if (state.terminal || state.actor === null) throw new Error(`Action after terminal ${label(history)}`);
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
      const amount = action === "bet-30" ? 30 : action === "bet-all-in" ? 60 : null;
      if (amount === null || amount > scenario.stackBehind[player]) {
        throw new Error(`Side-pot oracle rejects ${action} with no bet open`);
      }
      extra[player] = amount;
      const pending = seatsAfter(player).filter(seat => extra[seat] < scenario.stackBehind[seat]);
      state = { ...state, extra, actor: pending[0] ?? null, currentBet: amount, pending };
      continue;
    }
    if (state.pending[0] !== player) throw new Error("Side-pot oracle response order is broken");
    if (action === "raise-all-in") {
      const canRespond = seatsAfter(player).some(seat =>
        active[seat] && extra[seat] < scenario.stackBehind[seat]);
      if (
        state.raisesUsed !== 0 || state.currentBet !== 30 ||
        scenario.stackBehind[player] < 60 || !canRespond
      ) throw new Error("Side-pot oracle rejects this raise");
      extra[player] = 60;
      const pending = seatsAfter(player).filter(seat =>
        active[seat] && extra[seat] < scenario.stackBehind[seat]);
      state = {
        ...state,
        extra,
        actor: pending[0],
        currentBet: 60,
        raisesUsed: 1,
        pending,
      };
      continue;
    }
    if (action !== "fold" && action !== "call") {
      throw new Error(`Side-pot oracle rejects ${action} facing a bet`);
    }
    if (action === "fold") active[player] = false;
    else extra[player] = Math.min(state.currentBet, scenario.stackBehind[player]);
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
  if (!state.terminal) throw new Error(`${label(history)} is not terminal in the side-pot oracle`);
  return state;
}

function slowWinners(
  scenario: SidePotRiverScenario,
  hands: ThreePlayers<RiverCombo>,
  eligible: readonly number[],
): readonly number[] {
  if (eligible.length === 0) throw new Error("Side-pot oracle layer has no eligible player");
  if (eligible.length === 1) return eligible;
  const board = scenario.board.map(riverCardObject);
  const scores = eligible.map(player => ({
    player,
    score: handScore(hands[player].map(riverCardObject), board),
  }));
  const best = Math.max(...scores.map(result => result.score));
  return scores.filter(result => result.score === best).map(result => result.player);
}

export function oracleSidePotSettlement(
  scenario: SidePotRiverScenario,
  hands: ThreePlayers<RiverCombo>,
  history: readonly SidePotRiverAction[],
): OracleSettlement {
  const state = replay(scenario, history);
  const contributions = asThree(scenario.committed.map((old, player) => old + state.extra[player]));
  const ordered = contributions.map((amount, player) => ({ amount, player }))
    .sort((left, right) => right.amount - left.amount || left.player - right.player);
  const returned = [0, 0, 0];
  if (ordered[0].amount > ordered[1].amount) {
    returned[ordered[0].player] = ordered[0].amount - ordered[1].amount;
  }
  const returnedUncalled = asThree(returned);
  const remaining = contributions.map((amount, player) => amount - returned[player]);
  const potLayers: OracleLayer[] = [];
  while (remaining.some(amount => amount > 0)) {
    const contributingPlayers = [0, 1, 2].filter(player => remaining[player] > 0);
    const slice = Math.min(...contributingPlayers.map(player => remaining[player]));
    const amount = slice * contributingPlayers.length;
    const eligiblePlayers = contributingPlayers.filter(player => state.active[player]);
    for (const player of contributingPlayers) remaining[player] -= slice;
    // Same contenders as the pot below means dead money, not a new side pot.
    const previous = potLayers[potLayers.length - 1];
    if (previous && samePlayers(previous.eligiblePlayers, eligiblePlayers)) {
      const merged = previous.amount + amount;
      potLayers[potLayers.length - 1] = {
        ...previous,
        amount: merged,
        awards: asThree([0, 1, 2].map(player =>
          previous.winners.includes(player) ? merged / previous.winners.length : 0)),
      };
      continue;
    }
    const winners = slowWinners(scenario, hands, eligiblePlayers);
    const awards = [0, 0, 0] as [number, number, number];
    for (const winner of winners) awards[winner] = amount / winners.length;
    potLayers.push({ amount, contributingPlayers, eligiblePlayers, winners, awards });
  }
  const contestablePot = potLayers.reduce((sum, layer) => sum + layer.amount, 0);
  const awards = [0, 1, 2].map(player =>
    potLayers.reduce((sum, layer) => sum + layer.awards[player], 0));
  const utility = asThree(contributions.map((amount, player) =>
    returned[player] + awards[player] - amount));
  return { utility, returnedUncalled, contestablePot, potLayers };
}

function dealKey(hands: ThreePlayers<RiverCombo>): string {
  return hands.map(riverComboKey).join("|");
}

function samePlayers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((player, index) => player === right[index]);
}

function layersMatch(left: SidePotLayer, right: OracleLayer): boolean {
  return samePlayers(left.contributingPlayers, right.contributingPlayers) &&
    samePlayers(left.eligiblePlayers, right.eligiblePlayers) &&
    samePlayers(left.winners, right.winners);
}

/** Compare every exact deal and terminal with a separate replay, pot builder, and evaluator. */
export function auditSidePotRules(game: SidePotRiverGame): SidePotRulesAudit {
  const oracleDeals = oracleSidePotDeals(game.scenario);
  const probabilities = new Map(game.deals.map(deal => [dealKey(deal.outcome.hands), deal.probability]));
  let maximumProbabilityDifference = 0;
  let maximumUtilityDifference = 0;
  let maximumReturnedUncalledDifference = 0;
  let maximumContestablePotDifference = 0;
  let maximumLayerAmountDifference = 0;
  let layerStructureMismatches = 0;
  let maximumZeroSumError = 0;
  let terminalsChecked = 0;
  for (const deal of oracleDeals) {
    const probability = probabilities.get(dealKey(deal.hands));
    if (probability === undefined) throw new Error(`Game omitted oracle deal ${dealKey(deal.hands)}`);
    maximumProbabilityDifference = Math.max(
      maximumProbabilityDifference,
      Math.abs(probability - deal.probability),
    );
    for (const history of SIDE_POT_RIVER_TERMINAL_HISTORIES) {
      let state = game.nextChance(game.initialState(), { hands: deal.hands });
      for (const action of history) state = game.nextAction(state, action);
      const node = game.node(state);
      if (node.kind !== "terminal") throw new Error(`${label(history)} did not terminate`);
      const actual = game.settlement(state);
      const expected = oracleSidePotSettlement(game.scenario, deal.hands, history);
      for (let player = 0; player < 3; player += 1) {
        maximumUtilityDifference = Math.max(
          maximumUtilityDifference,
          Math.abs(node.utility[player] - expected.utility[player]),
        );
        maximumReturnedUncalledDifference = Math.max(
          maximumReturnedUncalledDifference,
          Math.abs(actual.returnedUncalled[player] - expected.returnedUncalled[player]),
        );
      }
      maximumContestablePotDifference = Math.max(
        maximumContestablePotDifference,
        Math.abs(actual.contestablePot - expected.contestablePot),
      );
      if (actual.potLayers.length !== expected.potLayers.length) {
        layerStructureMismatches += 1;
      } else {
        actual.potLayers.forEach((layer, index) => {
          const oracleLayer = expected.potLayers[index];
          maximumLayerAmountDifference = Math.max(
            maximumLayerAmountDifference,
            Math.abs(layer.amount - oracleLayer.amount),
            ...layer.awards.map((award, player) => Math.abs(award - oracleLayer.awards[player])),
          );
          if (!layersMatch(layer, oracleLayer)) layerStructureMismatches += 1;
        });
      }
      maximumZeroSumError = Math.max(
        maximumZeroSumError,
        Math.abs(node.utility.reduce((sum, value) => sum + value, 0)),
      );
      terminalsChecked += 1;
    }
  }
  if (probabilities.size !== oracleDeals.length) throw new Error("Game contains a deal omitted by oracle");
  return {
    dealsChecked: oracleDeals.length,
    terminalsChecked,
    maximumProbabilityDifference,
    maximumUtilityDifference,
    maximumReturnedUncalledDifference,
    maximumContestablePotDifference,
    maximumLayerAmountDifference,
    layerStructureMismatches,
    maximumZeroSumError,
  };
}
