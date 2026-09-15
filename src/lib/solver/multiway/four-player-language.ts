import type { FourPlayerActionFact, FourPlayerDecisionFacts } from "./four-player-teaching";

function chips(value: number): string {
  return `${Math.abs(value).toFixed(2)} chips`;
}

export const FOUR_PLAYER_METHOD_NOTE =
  "Every allowed four-player card combination and action in this small example was counted. " +
  "The saved strategy is still an approximation, not exact GTO or general poker advice.";

export const FOUR_PLAYER_PLAIN_RULE =
  "A fourth player adds another possible hand to beat and another possible source of chips. " +
  "That changes the calculation; it does not create a rule that you should always fold.";

export function explainFourPlayerAction(
  decision: FourPlayerDecisionFacts,
  action: FourPlayerActionFact,
): string {
  if (action.expectedAdditionalValue === null || action.differenceFromBest === null) {
    return `This ${action.action} was not reached often enough to explain.`;
  }
  const direction = action.expectedAdditionalValue >= 0 ? "gains" : "loses";
  const comparison = action.differenceFromBest <= 0.005
    ? "It is the highest-valued choice in this saved strategy."
    : `It gives up ${chips(action.differenceFromBest)} compared with the highest-valued choice.`;
  const field = `${decision.activePlayers.length} players are active at this point`;
  const call = action.action === "call" ? ` Calling costs ${decision.callCost} chips.` : "";
  return `${action.action} ${direction} ${chips(action.expectedAdditionalValue)} on average from this point. ` +
    `${comparison}${call} This is a four-player calculation: ${field}.`;
}
