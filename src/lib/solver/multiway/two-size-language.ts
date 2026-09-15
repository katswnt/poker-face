import type { TwoSizeActionFact, TwoSizeDecisionFacts } from "./two-size-teaching";

function chips(value: number): string {
  return `${Math.abs(value).toFixed(2)} chips`;
}

export const TWO_SIZE_RIVER_METHOD_NOTE =
  "Every possible set of cards and every allowed action in this small example was counted. " +
  "The saved strategy is still an approximation, not exact GTO or general poker advice.";

export function explainTwoSizeRiverAction(
  decision: TwoSizeDecisionFacts,
  action: TwoSizeActionFact,
): string {
  if (action.expectedAdditionalValue === null || action.differenceFromBest === null) {
    return `This ${action.action} was not reached often enough to explain.`;
  }
  const direction = action.expectedAdditionalValue >= 0 ? "gains" : "loses";
  const comparison = action.differenceFromBest <= 0.005
    ? "It is the highest-valued choice in this saved strategy."
    : `It gives up ${chips(action.differenceFromBest)} compared with the highest-valued choice.`;
  const sizeMeaning = action.action === "bet-30"
    ? "Betting 30 risks less and leaves room for an opponent to raise. "
    : action.action === "bet-all-in"
      ? "Betting 60 risks the whole remaining stack, so nobody can raise again. "
      : "";
  const returnMeaning = (action.expectedReturnedUncalled ?? 0) > 0.005
    ? `About ${chips(action.expectedReturnedUncalled!)} comes back on average because nobody matches it. `
    : "";
  return `${action.action} ${direction} ${chips(action.expectedAdditionalValue)} on average from this point. ` +
    `${comparison} ${sizeMeaning}${returnMeaning}${decision.activePlayers.length} players are still in the hand.`;
}
