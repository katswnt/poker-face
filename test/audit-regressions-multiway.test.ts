import assert from "node:assert/strict";
import test from "node:test";
import artifactData from "../src/lib/solver/multiway/artifacts/three-player-side-pot-river-v1.json" with { type: "json" };
import type { SidePotSolveArtifact } from "../src/lib/solver/multiway/side-pot-artifact";
import { deserializeSidePotStrategy } from "../src/lib/solver/multiway/side-pot-artifact";
import { sidePotRiverV1Game } from "../src/lib/solver/multiway/side-pot-fixture";
import { explainSidePotRiverAction } from "../src/lib/solver/multiway/side-pot-language";
import type { SidePotRiverState } from "../src/lib/solver/multiway/side-pot-river-game";
import { sidePotRiverDecisionFacts } from "../src/lib/solver/multiway/side-pot-teaching";

const artifact = artifactData as unknown as SidePotSolveArtifact;

function terminals(state: SidePotRiverState, out: SidePotRiverState[] = []): SidePotRiverState[] {
  const node = sidePotRiverV1Game.node(state);
  if (node.kind === "terminal") out.push(state);
  else if (node.kind === "chance") {
    for (const edge of node.outcomes) terminals(sidePotRiverV1Game.nextChance(state, edge.outcome), out);
  } else {
    for (const action of node.actions) terminals(sidePotRiverV1Game.nextAction(state, action), out);
  }
  return out;
}

test("side-pot settlement never splits dead money into a fake side pot", () => {
  // A layer is a real side pot only when fewer players can win it than the layer below.
  // Chips left behind by a folder at a lower level belong to the same pot, not a new one.
  let multiLayer = 0;
  for (const state of terminals(sidePotRiverV1Game.initialState())) {
    const layers = sidePotRiverV1Game.settlement(state).potLayers;
    if (layers.length > 1) multiLayer += 1;
    for (let index = 1; index < layers.length; index += 1) {
      const below = layers[index - 1].eligiblePlayers;
      const above = layers[index].eligiblePlayers;
      const history = state.public.history.join("-");
      assert.ok(above.length < below.length, `${history}: layer ${index} is not a smaller eligible set`);
      assert.ok(above.every(player => below.includes(player)), `${history}: layer ${index} is not a subset`);
    }
  }
  assert.ok(multiLayer > 0, "the fixture still contains real side pots");
});

test("folding 7h6h after check, bet-30, call does not claim a side pot forms", () => {
  const history = "check-bet-30-call";
  const find = (decisions: SidePotSolveArtifact["decisions"]) => {
    const decision = decisions.find(entry => entry.player === 0 &&
      entry.privateCards.join("") === "7h6h" && entry.history.join("-") === history);
    assert.ok(decision, "decision exists");
    const fold = decision.actions.find(action => action.action === "fold");
    assert.ok(fold, "fold action exists");
    return { decision, fold };
  };
  const live = find(sidePotRiverDecisionFacts(sidePotRiverV1Game, deserializeSidePotStrategy(artifact.strategy)));
  assert.doesNotMatch(explainSidePotRiverAction(live.decision, live.fold), /side pot/i);
  const saved = find(artifact.decisions);
  assert.equal(saved.fold.expectedPotLayers.find(layer => layer.layer === "side-1")?.existsProbability, 0);
  assert.doesNotMatch(explainSidePotRiverAction(saved.decision, saved.fold), /side pot/i);
});
