import type { MultiwayActionFact, MultiwayDecisionFacts } from "./teaching";

function chips(value: number): string {
  return `${Math.abs(value).toFixed(2)} chips`;
}

export const MULTIWAY_METHOD_NOTE =
  "Every possible set of cards in this small three-player example was counted. " +
  "The saved strategy is still an approximation, not exact GTO.";

export function explainMultiwayAction(
  decision: MultiwayDecisionFacts,
  action: MultiwayActionFact,
): string {
  if (action.expectedAdditionalValue === null || action.differenceFromBest === null) {
    return `This ${action.action} was not reached often enough to explain.`;
  }
  const direction = action.expectedAdditionalValue >= 0 ? "gains" : "loses";
  const comparison = action.differenceFromBest <= 0.005
    ? "It is the highest-valued choice in this saved strategy."
    : `It gives up ${chips(action.differenceFromBest)} compared with the highest-valued choice.`;
  return `${action.action} ${direction} ${chips(action.expectedAdditionalValue)} on average from this point. ` +
    `${comparison} ${decision.activePlayers.length} players are still in the hand.`;
}
