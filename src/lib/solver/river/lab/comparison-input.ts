import type { ConfigurableRiverV3Game } from "../configurable-v3/game";
import { BROWSER_STATE_LIMIT } from "./model";
import { riverLabPreflight } from "./input";
import { comparisonInput, type RiverComparisonAnchor, type RiverComparisonChange, type RiverComparisonPreflight } from "./comparison";

function hasDecision(game: ConfigurableRiverV3Game, anchor: RiverComparisonAnchor): boolean {
  const own = [...anchor.decision.privateCards].sort().join("");
  const deal = game.deals.find(({ outcome }) => [...outcome.hands[anchor.decision.player]].sort().join("") === own);
  if (!deal) return false;
  let state = game.nextChance(game.initialState(), deal.outcome);
  for (const action of anchor.decision.history) {
    const node = game.node(state);
    if (node.kind !== "player" || !node.actions.includes(action)) return false;
    state = game.nextAction(state, action);
  }
  const node = game.node(state);
  return node.kind === "player" && node.player === anchor.decision.player;
}

export function riverComparisonPreflight(anchor: RiverComparisonAnchor, change: RiverComparisonChange) {
  const input = comparisonInput(anchor, change);
  const before = riverLabPreflight(anchor.input), after = riverLabPreflight(input);
  if (!hasDecision(before.prepared.game, anchor)) throw new Error("The pinned decision does not belong to the starting game. Pin a decision again.");
  let unchanged: boolean;
  if (change.kind === "range") {
    const old = before.prepared.game.deals, next = after.prepared.game.deals;
    unchanged = old.length === next.length && old.every((deal, i) =>
      JSON.stringify(deal.outcome.hands) === JSON.stringify(next[i].outcome.hands)
      && Math.abs(deal.probability - next[i].probability) < 1e-14);
  } else if (change.kind === "bets") {
    unchanged = JSON.stringify(before.prepared.scenario.openingBetSizes.toSorted((a, b) => a - b))
      === JSON.stringify(after.prepared.scenario.openingBetSizes.toSorted((a, b) => a - b));
  } else {
    unchanged = before.request.stackBehind[1 - anchor.decision.player] === after.request.stackBehind[1 - anchor.decision.player];
  }
  if (unchanged) throw new Error("Change the selected assumption first. These inputs are unchanged within numeric tolerance. Try changing a hand's relative weight or a chip amount, not just reordering entries.");
  const totalStates = before.preflight.counts.projectedFullStates + after.preflight.counts.projectedFullStates;
  const preflight: RiverComparisonPreflight = { before: before.preflight, after: after.preflight, totalStates,
    allowed: totalStates <= BROWSER_STATE_LIMIT, decisionAvailable: hasDecision(after.prepared.game, anchor) };
  return { input, preflight };
}
