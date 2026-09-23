import type { BehavioralStrategy } from "../../toy/game";
import { riverComboKey } from "../cards";
import { configurableRiverDecisionFacts, type ConfigurableRiverDecisionFacts } from "../configurable/explain";
import type { ConfigurableRiverAction } from "../configurable/game";
import { configurableRiverV3State, type ConfigurableRiverV3Game } from "../configurable-v3/game";
import type { RiverLabDecision } from "./model";

export function createRiverLabContext(
  game: ConfigurableRiverV3Game,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
) {
  const decisions = configurableRiverDecisionFacts(game, strategy);
  return { game, strategy, decisions };
}

export type RiverLabContext = ReturnType<typeof createRiverLabContext>;

/** Bayes update using the opponent's information-set strategy, never their actual hidden hand. */
export function inspectRiverLabDecision(context: RiverLabContext, key: string): RiverLabDecision {
  const { game, strategy } = context;
  const facts = context.decisions.find(decision => decision.informationSet === key);
  if (!facts) throw new Error("This decision does not belong to the displayed result.");
  const opponent = facts.player === 0 ? 1 : 0;
  const responses: RiverLabDecision["responses"][number][] = [];
  if (!facts.offPath) {
    for (const action of facts.actions) {
      for (const response of action.immediateOpponentResponses) {
        const weights = facts.opponentRange.map(combo => {
          let mass = 0;
          if (combo.probability !== null && combo.probability > 0) {
            const hands = facts.player === 0
              ? [facts.privateCards, combo.cards] as const
              : [combo.cards, facts.privateCards] as const;
            const state = configurableRiverV3State(game, hands, [...facts.history, action.action]);
            const entry = strategy.get(game.informationSet(state, opponent));
            if (!entry) throw new Error("Missing opponent strategy for a response.");
            const index = entry.actions.indexOf(response.action);
            if (index < 0) throw new Error("Response is unavailable in this information set.");
            mass = combo.probability * entry.probabilities[index];
          }
          return { ...combo, mass };
        });
        const total = weights.reduce((sum, combo) => sum + combo.mass, 0);
        if (Math.abs(total - response.probability) > 1e-10) {
          throw new Error("Opponent range update disagrees with measured response probability.");
        }
        responses.push({
          action: action.action, response: response.action, probability: total,
          range: weights.map(({ mass, ...combo }) => ({
            ...combo, probability: total <= 1e-12 ? null : mass / total,
          })),
        });
      }
    }
  }
  const remaining = game.scenario.stackBehind[facts.player]
    - (facts.contributions[facts.player] - game.scenario.committed[facts.player]);
  const callCost = Math.min(remaining, facts.toCall);
  let finalCallPot: number | null = null;
  if (facts.actions.some(action => action.action === "call")) {
    const deal = game.deals.find(candidate =>
      riverComboKey(candidate.outcome.hands[facts.player]) === riverComboKey(facts.privateCards));
    if (!deal) throw new Error("Decision has no compatible deal.");
    const state = configurableRiverV3State(game, deal.outcome.hands, [...facts.history, "call"]);
    finalCallPot = game.settlement(state).contestablePot;
  }
  return { facts, responses, callCost, finalCallPot };
}

export function riverLabDecisionMenu(decisions: readonly ConfigurableRiverDecisionFacts[]) {
  return decisions.map(({ informationSet, player, privateCards, history, offPath }) =>
    ({ informationSet, player, privateCards, history, offPath }));
}
