import type { RiverActionFact, RiverDecisionFacts } from "./explain";
import type { RiverAction } from "./game";

export interface RiverActionExplanation {
  readonly choice: string;
  readonly frequency: string;
  readonly resultFromNow: string;
  readonly comparison: string;
  readonly immediateResponse: string | null;
  readonly showdown: string | null;
  readonly accuracy: string;
  readonly scope: string;
}

const ACTION_NAME: Readonly<Record<RiverAction, string>> = {
  check: "check",
  "bet-half": "bet half the pot",
  "bet-pot": "bet the full pot",
  fold: "fold",
  call: "call",
  "raise-all-in": "raise all-in",
};

const ACTION_VERB: Readonly<Record<RiverAction, string>> = {
  check: "checks",
  "bet-half": "bets half the pot",
  "bet-pot": "bets the full pot",
  fold: "folds",
  call: "calls",
  "raise-all-in": "raises all-in",
};

function rounded(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/, "");
}

function percentage(value: number): string {
  return `${rounded(value * 100, 1)}%`;
}

function chipResult(value: number): string {
  if (Math.abs(value) < 0.005) return "breaks even";
  return `${value > 0 ? "gains" : "loses"} about ${rounded(Math.abs(value), 2)} chips`;
}

function responseLine(action: RiverActionFact): string | null {
  if (action.immediateOpponentResponses.length === 0) return null;
  const responses = action.immediateOpponentResponses.map(response => {
    if (response.probability === null) return `${ACTION_NAME[response.action]}: unavailable`;
    return `${ACTION_NAME[response.action]} ${percentage(response.probability)}`;
  });
  return `The opponent's next choice is: ${responses.join(", ")}.`;
}

/**
 * Turn audited action facts into plain learner copy. This layer contains no poker math;
 * every displayed number comes from the structured decision record.
 */
export function explainRiverAction(
  decision: RiverDecisionFacts,
  actionName: RiverAction,
): RiverActionExplanation {
  const action = decision.actions.find(candidate => candidate.action === actionName);
  if (!action) throw new Error(`${actionName} is not legal at ${decision.informationSet}`);
  const choice = ACTION_NAME[action.action];
  const accuracy = "The action frequencies come from an approximate saved strategy, not exact GTO.";
  const scope =
    "These numbers apply only to this saved two-player river example: its board, ranges, pot, stacks, positions, and bet sizes.";

  if (
    decision.offPath || action.expectedAdditionalValue === null ||
    action.differenceFromBest === null
  ) {
    return {
      choice,
      frequency: `The saved strategy ${ACTION_VERB[action.action]} about ${percentage(action.frequency)} of the time.`,
      resultFromNow: "This situation is not reached often enough to give a reliable chip result.",
      comparison: "There is not enough on-path evidence to compare this choice with the others.",
      immediateResponse: null,
      showdown: null,
      accuracy,
      scope,
    };
  }

  const comparison = action.differenceFromBest < 0.01
    ? "This choice is within one hundredth of a chip of the best measured choice."
    : `This choice is about ${rounded(action.differenceFromBest, 2)} chips behind the best measured choice.`;
  return {
    choice,
    frequency: `The saved strategy ${ACTION_VERB[action.action]} about ${percentage(action.frequency)} of the time.`,
    resultFromNow:
      `From this decision onward, this choice ${chipResult(action.expectedAdditionalValue)} on average.`,
    comparison,
    immediateResponse: responseLine(action),
    showdown: action.showdownEquity === null
      ? null
      : `When this line reaches showdown, this hand receives about ${percentage(action.showdownEquity)} of the pot on average.`,
    accuracy,
    scope,
  };
}
