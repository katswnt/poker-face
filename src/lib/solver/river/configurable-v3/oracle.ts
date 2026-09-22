import { handScore } from "../../../poker/eval";
import type { Utility } from "../../toy/game";
import {
  riverCardObject,
  riverComboKey,
  riverCombosOverlap,
  type RiverCombo,
} from "../cards";
import type { ConfigurableRiverAction } from "../configurable/game";
import type {
  ConfigurableRiverV3Game,
  ConfigurableRiverV3Scenario,
} from "./game";

export interface ConfigurableRiverV3RulesAudit {
  readonly dealsChecked: number;
  readonly publicTerminals: number;
  readonly terminalsChecked: number;
  readonly maximumProbabilityDifference: number;
  readonly maximumUtilityDifference: number;
  readonly maximumZeroSumError: number;
}

interface OracleDeal {
  readonly hands: readonly [RiverCombo, RiverCombo];
  readonly probability: number;
}

interface OracleReplay {
  readonly contributions: readonly [number, number];
  readonly foldedPlayer: 0 | 1 | null;
}

function sized(action: ConfigurableRiverAction): number {
  const amount = Number(action.slice(action.lastIndexOf("-") + 1));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`v3 oracle cannot parse ${action}`);
  return amount;
}

function oracleDeals(scenario: ConfigurableRiverV3Scenario): readonly OracleDeal[] {
  const compatible: { hands: readonly [RiverCombo, RiverCombo]; weight: number }[] = [];
  for (const left of scenario.ranges[0]) {
    for (const right of scenario.ranges[1]) {
      if (riverCombosOverlap(left.cards, right.cards)) continue;
      compatible.push({ hands: [left.cards, right.cards], weight: left.weight * right.weight });
    }
  }
  const total = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("v3 oracle found no compatible deals");
  return compatible.map(deal => ({ hands: deal.hands, probability: deal.weight / total }));
}

/** Separate terminal-money replay: it does not call the v3 transition or settlement methods. */
export function oracleConfigurableRiverV3Contributions(
  scenario: ConfigurableRiverV3Scenario,
  history: readonly ConfigurableRiverAction[],
): OracleReplay {
  const street: [number, number] = [0, 0];
  let actor: 0 | 1 = 0;
  let currentBet = 0;
  let foldedPlayer: 0 | 1 | null = null;
  let terminal = false;
  for (const action of history) {
    if (terminal) throw new Error(`v3 oracle history continues after ${action}`);
    if (action === "check") {
      actor = (1 - actor) as 0 | 1;
      continue;
    }
    if (action.startsWith("bet-to-") || action.startsWith("raise-to-")) {
      const target = sized(action);
      street[actor] = target;
      currentBet = target;
      actor = (1 - actor) as 0 | 1;
      continue;
    }
    if (action === "fold") {
      foldedPlayer = actor;
      terminal = true;
      continue;
    }
    if (action === "call") {
      street[actor] = Math.min(currentBet, scenario.stackBehind[actor]);
      terminal = true;
      continue;
    }
    throw new Error(`v3 oracle does not recognize ${action}`);
  }
  return {
    contributions: [scenario.committed[0] + street[0], scenario.committed[1] + street[1]],
    foldedPlayer,
  };
}

function slowWinner(
  scenario: ConfigurableRiverV3Scenario,
  hands: readonly [RiverCombo, RiverCombo],
): 0 | 1 | null {
  const board = scenario.board.map(riverCardObject);
  const values = hands.map(hand => handScore(hand.map(riverCardObject), board));
  return values[0] === values[1] ? null : values[0] > values[1] ? 0 : 1;
}

export function oracleConfigurableRiverV3Utility(
  scenario: ConfigurableRiverV3Scenario,
  hands: readonly [RiverCombo, RiverCombo],
  history: readonly ConfigurableRiverAction[],
): Utility {
  const replay = oracleConfigurableRiverV3Contributions(scenario, history);
  const [left, right] = replay.contributions;
  const returned: [number, number] = [Math.max(0, left - right), Math.max(0, right - left)];
  const contestable = left + right - returned[0] - returned[1];
  const winner = replay.foldedPlayer === null
    ? slowWinner(scenario, hands)
    : (1 - replay.foldedPlayer) as 0 | 1;
  const awards: [number, number] = [...returned];
  if (winner === null) {
    awards[0] += contestable / 2;
    awards[1] += contestable / 2;
  } else {
    awards[winner] += contestable;
  }
  return [awards[0] - left, awards[1] - right];
}

function terminalHistories(game: ConfigurableRiverV3Game): readonly ConfigurableRiverAction[][] {
  const deal = game.deals[0]?.outcome;
  if (!deal) throw new Error("Cannot audit v3 without a deal");
  const found: ConfigurableRiverAction[][] = [];
  const visit = (history: readonly ConfigurableRiverAction[]): void => {
    let state = game.nextChance(game.initialState(), deal);
    for (const action of history) state = game.nextAction(state, action);
    const node = game.node(state);
    if (node.kind === "terminal") {
      found.push([...history]);
      return;
    }
    if (node.kind !== "player") throw new Error("v3 oracle found chance below the deal");
    for (const action of node.actions) visit([...history, action]);
  };
  visit([]);
  return found;
}

function dealKey(hands: readonly [RiverCombo, RiverCombo]): string {
  return `${riverComboKey(hands[0])}|${riverComboKey(hands[1])}`;
}

export function auditConfigurableRiverV3Rules(
  game: ConfigurableRiverV3Game,
): ConfigurableRiverV3RulesAudit {
  const expectedDeals = oracleDeals(game.scenario);
  const actualDeals = new Map(game.deals.map(deal => [dealKey(deal.outcome.hands), deal.probability]));
  const histories = terminalHistories(game);
  let maximumProbabilityDifference = 0;
  let maximumUtilityDifference = 0;
  let maximumZeroSumError = 0;
  let terminalsChecked = 0;
  for (const deal of expectedDeals) {
    const actualProbability = actualDeals.get(dealKey(deal.hands));
    if (actualProbability === undefined) throw new Error(`v3 omitted oracle deal ${dealKey(deal.hands)}`);
    maximumProbabilityDifference = Math.max(
      maximumProbabilityDifference,
      Math.abs(actualProbability - deal.probability),
    );
    for (const history of histories) {
      let state = game.nextChance(game.initialState(), { hands: deal.hands });
      for (const action of history) state = game.nextAction(state, action);
      const node = game.node(state);
      if (node.kind !== "terminal") throw new Error(`v3 history ${history.join("-")} stayed live`);
      const expected = oracleConfigurableRiverV3Utility(game.scenario, deal.hands, history);
      maximumUtilityDifference = Math.max(
        maximumUtilityDifference,
        Math.abs(node.utility[0] - expected[0]),
        Math.abs(node.utility[1] - expected[1]),
      );
      maximumZeroSumError = Math.max(maximumZeroSumError, Math.abs(node.utility[0] + node.utility[1]));
      terminalsChecked += 1;
    }
  }
  return {
    dealsChecked: expectedDeals.length,
    publicTerminals: histories.length,
    terminalsChecked,
    maximumProbabilityDifference,
    maximumUtilityDifference,
    maximumZeroSumError,
  };
}
