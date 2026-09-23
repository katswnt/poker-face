import { test } from "node:test";
import assert from "node:assert/strict";
import { uniformStrategy } from "../src/lib/solver/toy/game";
import { compileFactorizedRiverGame } from "../src/lib/solver/river/factorized/game";
import { prepareConfigurableRiverV3 } from "../src/lib/solver/river/configurable-v3/solve";
import { riverComboKey } from "../src/lib/solver/river/cards";
import { parseRiverLabInput } from "../src/lib/solver/river/lab/input";
import { riverLabExample } from "../src/lib/solver/river/lab/example";
import { SMALL_INPUT } from "../src/lib/solver/river/lab/model";
import { createRiverLabContext, inspectRiverLabDecision } from "../src/lib/solver/river/lab/teaching";

const near = (left: number, right: number) => assert.ok(Math.abs(left - right) < 1e-10, `${left} != ${right}`);

test("saved UI example retains audited counts, grade, hashes, and only one detailed explanation", () => {
  const { result } = riverLabExample();
  assert.equal(result.decisions.length, 308);
  assert.equal(result.preflight.counts.compatibleDeals, 176);
  near(result.quality.value[0], 16.081056725396856);
  assert.ok(Math.abs(result.quality.exploitability - 0.009074631) < 1e-9);
  assert.equal(result.provenance?.payloadHash, "320759e74808f8c5cb784b0e92c3410de02567252346d671a7b0a6eb722ea4e9");
  assert.ok(JSON.stringify(result).length < 150_000);
  assert.equal(result.initialDecision.facts.offPath, false);
});

test("each updated opponent range equals independently weighted compatible paths", () => {
  const game = prepareConfigurableRiverV3(parseRiverLabInput(SMALL_INPUT).request).game;
  const index = compileFactorizedRiverGame(game).index;
  const strategy = new Map(index.informationSets.map((entry, i) => {
    const weights = entry.actions.map((_, j) => 1 + ((i + 3) * (j + 2)) % 13);
    return [entry.key, { actions: entry.actions, probabilities: weights.map(weight => weight / weights.reduce((a, b) => a + b, 0)) }] as const;
  }));
  const context = createRiverLabContext(game, strategy);
  let changedRanges = 0;
  for (const facts of context.decisions) {
    const decision = inspectRiverLabDecision(context, facts.informationSet);
    for (const response of decision.responses) {
      const mass = new Map<string, number>();
      for (const deal of game.deals) {
        if (riverComboKey(deal.outcome.hands[facts.player]) !== riverComboKey(facts.privateCards)) continue;
        let state = game.nextChance(game.initialState(), deal.outcome);
        let weight = deal.probability;
        for (const action of facts.history) {
          const node = game.node(state);
          assert.equal(node.kind, "player");
          if (node.kind !== "player") continue;
          const entry = strategy.get(game.informationSet(state, node.player))!;
          weight *= entry.probabilities[entry.actions.indexOf(action)];
          state = game.nextAction(state, action);
        }
        state = game.nextAction(state, response.action); // Force our action; do not condition on its frequency.
        const node = game.node(state);
        assert.equal(node.kind, "player");
        if (node.kind !== "player") continue;
        const entry = strategy.get(game.informationSet(state, node.player))!;
        weight *= entry.probabilities[entry.actions.indexOf(response.response)];
        const key = riverComboKey(deal.outcome.hands[1 - facts.player]);
        mass.set(key, (mass.get(key) ?? 0) + weight);
      }
      const total = [...mass.values()].reduce((sum, value) => sum + value, 0);
      near(response.range.reduce((sum, combo) => sum + (combo.probability ?? 0), 0), 1);
      for (const combo of response.range) {
        near(combo.probability!, (mass.get(combo.key) ?? 0) / total);
        if (combo.cards.some(card => facts.privateCards.includes(card))) assert.equal(combo.probability, 0);
        if (Math.abs(combo.probability! - facts.opponentRange.find(item => item.key === combo.key)!.probability!) > 1e-6) changedRanges++;
      }
      for (const action of facts.actions) {
        if (action.expectedValue !== null) near(action.expectedAdditionalValue!, action.expectedValue + facts.contributions[facts.player]);
      }
    }
  }
  assert.ok(changedRanges > 0);
});

test("off-path decisions and zero-probability responses have no invented posterior", () => {
  const game = prepareConfigurableRiverV3(parseRiverLabInput(SMALL_INPUT).request).game;
  const index = compileFactorizedRiverGame(game).index;
  const strategy = new Map(index.informationSets.map(entry => [entry.key,
    { actions: entry.actions, probabilities: entry.actions.map((_, i) => i === 0 ? 1 : 0) }] as const));
  const context = createRiverLabContext(game, strategy);
  const off = context.decisions.find(decision => decision.offPath)!;
  const hidden = inspectRiverLabDecision(context, off.informationSet);
  assert.ok(hidden.facts.actions.every(action => action.expectedValue === null));
  assert.ok(hidden.facts.opponentRange.every(combo => combo.probability === null));
  assert.deepEqual(hidden.responses, []);
  const root = context.decisions.find(decision => decision.history.length === 0)!;
  const impossible = inspectRiverLabDecision(context, root.informationSet).responses.filter(item => item.probability === 0);
  assert.ok(impossible.length > 0);
  assert.ok(impossible.every(item => item.range.every(combo => combo.probability === null)));
  assert.throws(() => inspectRiverLabDecision(context, "not-a-real-information-set"), /does not belong/);
});

test("teaching price caps a short all-in call and removes the uncalled overbet", () => {
  const game = prepareConfigurableRiverV3(parseRiverLabInput({ ...SMALL_INPUT,
    stack0: "200", stack1: "30", bets: "100", raises: "200", maxRaises: "1" }).request).game;
  const context = createRiverLabContext(game, uniformStrategy(compileFactorizedRiverGame(game).index));
  const facing = context.decisions.find(decision => decision.player === 1 && decision.history.join() === "bet-to-100")!;
  const decision = inspectRiverLabDecision(context, facing.informationSet);
  assert.equal(facing.toCall, 100);
  assert.equal(decision.callCost, 30);
  assert.equal(decision.finalCallPot, 160);
  assert.equal(decision.callCost / decision.finalCallPot, 0.1875);
  near(facing.actions.find(action => action.action === "fold")!.expectedAdditionalValue!, 0);
});
