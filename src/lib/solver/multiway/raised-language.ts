import type { RaisedActionFact, RaisedDecisionFacts } from "./raised-teaching";

function chips(value: number): string {
  return `${Math.abs(value).toFixed(2)} chips`;
}

export const RAISED_RIVER_METHOD_NOTE =
  "Every possible set of cards and every allowed action in this small example was counted. " +
  "The saved strategy is still an approximation, not exact GTO.";

export function explainRaisedRiverAction(
  decision: RaisedDecisionFacts,
  action: RaisedActionFact,
): string {
  if (action.expectedAdditionalValue === null || action.differenceFromBest === null) {
    return `This ${action.action} was not reached often enough to explain.`;
  }
  const direction = action.expectedAdditionalValue >= 0 ? "gains" : "loses";
  const comparison = action.differenceFromBest <= 0.005
    ? "It is the highest-valued choice in this saved strategy."
    : `It gives up ${chips(action.differenceFromBest)} compared with the highest-valued choice.`;
  const raiseMeaning = action.action === "raise-all-in"
    ? "The raise asks every remaining player to match 60 river chips or fold. A player who called 30 earlier may have to decide again. "
    : "";
  const returnMeaning = (action.expectedReturnedUncalled ?? 0) > 0.005
    ? `About ${chips(action.expectedReturnedUncalled!)} comes back on average because nobody matches it. `
    : "";
  return `${action.action} ${direction} ${chips(action.expectedAdditionalValue)} on average from this point. ` +
    `${comparison} ${raiseMeaning}${returnMeaning}${decision.activePlayers.length} players are still in the hand.`;
}
