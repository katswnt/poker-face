import type { SidePotActionFact, SidePotDecisionFacts } from "./side-pot-teaching";

function chips(value: number): string {
  return `${Math.abs(value).toFixed(2)} chips`;
}

export const SIDE_POT_RIVER_METHOD_NOTE =
  "Every allowed set of cards, action, and pot ending in this small example was counted. " +
  "The saved strategy is still an approximation, not exact GTO or general poker advice.";

export const SIDE_POT_PLAIN_RULE =
  "The main pot contains chips all continuing players paid enough to contest. " +
  "A side pot contains chips from a higher contribution level. A player can win a pot " +
  "only if they paid enough to enter that layer.";

export function explainSidePotRiverAction(
  decision: SidePotDecisionFacts,
  action: SidePotActionFact,
): string {
  if (action.expectedAdditionalValue === null || action.differenceFromBest === null) {
    return `This ${action.action} was not reached often enough to explain.`;
  }
  const direction = action.expectedAdditionalValue >= 0 ? "gains" : "loses";
  const comparison = action.differenceFromBest <= 0.005
    ? "It is the highest-valued choice in this saved strategy."
    : `It gives up ${chips(action.differenceFromBest)} compared with the highest-valued choice.`;
  const callMeaning = action.action === "call"
    ? `Calling costs ${decision.callCost} chips here; the price is capped by this player's remaining stack. `
    : "";
  const side = action.expectedPotLayers.find(layer => layer.layer === "side-1");
  const sideMeaning = side && side.existsProbability !== null && side.existsProbability > 0.005
    ? `A side pot forms ${(side.existsProbability * 100).toFixed(1)}% of the time after this choice. ` +
      ((side.playerEligibilityProbability ?? 0) <= 0.005
        ? "This player cannot win that side pot because they did not pay enough to enter it. "
        : (side.playerEligibilityProbability ?? 0) + 0.005 < side.existsProbability
          ? `This player can win it only on endings where they paid enough to enter it, and expects ` +
            `${chips(side.expectedAward ?? 0)} from it overall. `
          : `This player expects ${chips(side.expectedAward ?? 0)} from that side pot. `)
    : "";
  return `${action.action} ${direction} ${chips(action.expectedAdditionalValue)} on average from this point. ` +
    `${comparison} ${callMeaning}${sideMeaning}`;
}
