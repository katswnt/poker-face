import { handScore } from "../../poker/eval";
import {
  riverCardObject,
  riverComboKey,
  riverCombosOverlap,
  type RiverCombo,
} from "../river/cards";
import type {
  FourPlayerRiverAction,
  FourPlayerRiverGame,
  FourPlayerRiverScenario,
  FourPlayers,
} from "./four-player-river-game";

export const FOUR_PLAYER_TERMINAL_HISTORIES = [
  ["check", "check", "check", "check"],
  ["bet-30", "fold", "fold", "fold"],
  ["bet-30", "fold", "fold", "call"],
  ["bet-30", "fold", "call", "fold"],
  ["bet-30", "fold", "call", "call"],
  ["bet-30", "call", "fold", "fold"],
  ["bet-30", "call", "fold", "call"],
  ["bet-30", "call", "call", "fold"],
  ["bet-30", "call", "call", "call"],
  ["check", "bet-30", "fold", "fold", "fold"],
  ["check", "bet-30", "fold", "fold", "call"],
  ["check", "bet-30", "fold", "call", "fold"],
  ["check", "bet-30", "fold", "call", "call"],
  ["check", "bet-30", "call", "fold", "fold"],
  ["check", "bet-30", "call", "fold", "call"],
  ["check", "bet-30", "call", "call", "fold"],
  ["check", "bet-30", "call", "call", "call"],
  ["check", "check", "bet-30", "fold", "fold", "fold"],
  ["check", "check", "bet-30", "fold", "fold", "call"],
  ["check", "check", "bet-30", "fold", "call", "fold"],
  ["check", "check", "bet-30", "fold", "call", "call"],
  ["check", "check", "bet-30", "call", "fold", "fold"],
  ["check", "check", "bet-30", "call", "fold", "call"],
  ["check", "check", "bet-30", "call", "call", "fold"],
  ["check", "check", "bet-30", "call", "call", "call"],
  ["check", "check", "check", "bet-30", "fold", "fold", "fold"],
  ["check", "check", "check", "bet-30", "fold", "fold", "call"],
  ["check", "check", "check", "bet-30", "fold", "call", "fold"],
  ["check", "check", "check", "bet-30", "fold", "call", "call"],
  ["check", "check", "check", "bet-30", "call", "fold", "fold"],
  ["check", "check", "check", "bet-30", "call", "fold", "call"],
  ["check", "check", "check", "bet-30", "call", "call", "fold"],
  ["check", "check", "check", "bet-30", "call", "call", "call"],
] as const satisfies readonly (readonly FourPlayerRiverAction[])[];

export interface FourPlayerOracleDeal {
  readonly hands: FourPlayers<RiverCombo>;
  readonly probability: number;
}

export interface FourPlayerRulesAudit {
  readonly dealsChecked: number;
  readonly terminalsChecked: number;
  readonly maximumProbabilityDifference: number;
  readonly maximumUtilityDifference: number;
  readonly maximumAwardDifference: number;
  readonly maximumPotDifference: number;
  readonly maximumZeroSumError: number;
}

interface OracleState {
  readonly active: FourPlayers<boolean>;
  readonly extra: FourPlayers<number>;
  readonly actor: number | null;
  readonly bettor: number | null;
  readonly pending: readonly number[];
  readonly checked: number;
  readonly terminal: boolean;
}

interface OracleSettlement {
  readonly contributions: FourPlayers<number>;
  readonly pot: number;
  readonly winners: readonly number[];
  readonly awards: FourPlayers<number>;
  readonly utility: FourPlayers<number>;
  readonly active: FourPlayers<boolean>;
}

function asFour<T>(values: readonly T[]): FourPlayers<T> {
  if (values.length !== 4) throw new Error("Four-player oracle expected exactly four values");
  return [values[0], values[1], values[2], values[3]];
}

function orderedAfter(player: number, order: FourPlayers<number>): readonly number[] {
  const index = order.indexOf(player);
  if (index < 0) throw new Error(`Four-player oracle cannot find player ${player}`);
  return [1, 2, 3].map(offset => order[(index + offset) % 4]);
}

function label(history: readonly FourPlayerRiverAction[]): string {
  return history.join("-");
}

export function oracleFourPlayerDeals(
  scenario: FourPlayerRiverScenario,
): readonly FourPlayerOracleDeal[] {
  const compatible: { hands: FourPlayers<RiverCombo>; weight: number }[] = [];
  for (const first of scenario.ranges[0]) {
    for (const second of scenario.ranges[1]) {
      for (const third of scenario.ranges[2]) {
        for (const fourth of scenario.ranges[3]) {
          const hands = [first.cards, second.cards, third.cards, fourth.cards] as const;
          let collision = false;
          for (let left = 0; left < 4; left += 1) {
            for (let right = left + 1; right < 4; right += 1) {
              if (riverCombosOverlap(hands[left], hands[right])) collision = true;
            }
          }
          if (collision) continue;
          compatible.push({
            hands,
            weight: first.weight * second.weight * third.weight * fourth.weight,
          });
        }
      }
    }
  }
  const total = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Four-player oracle found no deals");
  return compatible.map(deal => ({ hands: deal.hands, probability: deal.weight / total }));
}

function replay(
  scenario: FourPlayerRiverScenario,
  history: readonly FourPlayerRiverAction[],
): OracleState {
  let state: OracleState = {
    active: [true, true, true, true],
    extra: [0, 0, 0, 0],
    actor: scenario.actionOrder[0],
    bettor: null,
    pending: [],
    checked: 0,
    terminal: false,
  };
  for (const action of history) {
    if (state.terminal || state.actor === null) throw new Error(`Action after terminal ${label(history)}`);
    const player = state.actor;
    const active = [...state.active] as [boolean, boolean, boolean, boolean];
    const extra = [...state.extra] as [number, number, number, number];
    if (state.bettor === null) {
      if (action === "check") {
        const checked = state.checked + 1;
        state = {
          ...state,
          actor: checked === 4 ? null : orderedAfter(player, scenario.actionOrder)[0],
          checked,
          terminal: checked === 4,
        };
        continue;
      }
      if (action !== "bet-30") throw new Error(`Oracle rejects ${action} with no open bet`);
      extra[player] = 30;
      const pending = orderedAfter(player, scenario.actionOrder);
      state = { ...state, extra, actor: pending[0], bettor: player, pending };
      continue;
    }
    if (state.pending[0] !== player) throw new Error("Four-player oracle response order is broken");
    if (action !== "fold" && action !== "call") throw new Error(`Oracle rejects ${action} facing a bet`);
    if (action === "fold") active[player] = false;
    else extra[player] = 30;
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
  if (!state.terminal) throw new Error(`${label(history)} is not terminal in the oracle`);
  return state;
}

export function oracleFourPlayerSettlement(
  scenario: FourPlayerRiverScenario,
  hands: FourPlayers<RiverCombo>,
  history: readonly FourPlayerRiverAction[],
): OracleSettlement {
  const state = replay(scenario, history);
  const contributions = asFour(scenario.committed.map((old, player) => old + state.extra[player]));
  const activePlayers = state.active.map((active, player) => active ? player : null)
    .filter((player): player is number => player !== null);
  if (activePlayers.length === 0) throw new Error("Four-player oracle has no active player");
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
  const pot = contributions.reduce((sum, amount) => sum + amount, 0);
  const awards = asFour([0, 1, 2, 3].map(player =>
    winners.includes(player) ? pot / winners.length : 0));
  const utility = asFour(contributions.map((amount, player) => awards[player] - amount));
  return { contributions, pot, winners, awards, utility, active: state.active };
}

function dealKey(hands: FourPlayers<RiverCombo>): string {
  return hands.map(riverComboKey).join("|");
}

export function auditFourPlayerRules(game: FourPlayerRiverGame): FourPlayerRulesAudit {
  const oracleDeals = oracleFourPlayerDeals(game.scenario);
  const probabilities = new Map(game.deals.map(deal => [dealKey(deal.outcome.hands), deal.probability]));
  let maximumProbabilityDifference = 0;
  let maximumUtilityDifference = 0;
  let maximumAwardDifference = 0;
  let maximumPotDifference = 0;
  let maximumZeroSumError = 0;
  let terminalsChecked = 0;
  for (const deal of oracleDeals) {
    const probability = probabilities.get(dealKey(deal.hands));
    if (probability === undefined) throw new Error(`Game omitted oracle deal ${dealKey(deal.hands)}`);
    maximumProbabilityDifference = Math.max(
      maximumProbabilityDifference,
      Math.abs(probability - deal.probability),
    );
    for (const history of FOUR_PLAYER_TERMINAL_HISTORIES) {
      let state = game.nextChance(game.initialState(), { hands: deal.hands });
      for (const action of history) state = game.nextAction(state, action);
      const node = game.node(state);
      if (node.kind !== "terminal") throw new Error(`${label(history)} did not terminate`);
      const actual = game.settlement(state);
      const expected = oracleFourPlayerSettlement(game.scenario, deal.hands, history);
      maximumPotDifference = Math.max(maximumPotDifference, Math.abs(actual.pot - expected.pot));
      for (let player = 0; player < 4; player += 1) {
        maximumUtilityDifference = Math.max(
          maximumUtilityDifference,
          Math.abs(actual.utility[player] - expected.utility[player]),
        );
        maximumAwardDifference = Math.max(
          maximumAwardDifference,
          Math.abs(actual.awards[player] - expected.awards[player]),
        );
      }
      maximumZeroSumError = Math.max(
        maximumZeroSumError,
        Math.abs(actual.utility.reduce((sum, value) => sum + value, 0)),
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
    maximumAwardDifference,
    maximumPotDifference,
    maximumZeroSumError,
  };
}
