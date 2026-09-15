import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { SIDE_POT_RIVER_V1_SCENARIO } from "../src/lib/solver/multiway/side-pot-fixture";
import { SIDE_POT_RIVER_TERMINAL_HISTORIES } from "../src/lib/solver/multiway/side-pot-oracle";
import {
  createSidePotRiverGame,
  sidePotRiverState,
} from "../src/lib/solver/multiway/side-pot-river-game";

test("side-pot positive range weights form one exact compatible distribution", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 18, maxLength: 18 }),
    weights => {
      let index = 0;
      const game = createSidePotRiverGame({
        ...SIDE_POT_RIVER_V1_SCENARIO,
        id: "three-player-side-pot-weight-property",
        ranges: SIDE_POT_RIVER_V1_SCENARIO.ranges.map(range => range.map(entry => ({
          ...entry,
          weight: weights[index++],
        }))) as unknown as typeof SIDE_POT_RIVER_V1_SCENARIO.ranges,
      });
      assert.equal(game.deals.length, 172);
      assert.ok(Math.abs(game.deals.reduce((sum, deal) => sum + deal.probability, 0) - 1) <= 1e-12);
      for (const deal of game.deals) {
        assert.equal(new Set(deal.outcome.hands.flat()).size, 6);
        assert.ok(Number.isFinite(deal.probability) && deal.probability > 0);
      }
    },
  ), { numRuns: 100 });
});

test("random side-pot deals and endings conserve every chip", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 171 }),
    fc.integer({ min: 0, max: SIDE_POT_RIVER_TERMINAL_HISTORIES.length - 1 }),
    (dealIndex, historyIndex) => {
      const game = createSidePotRiverGame(SIDE_POT_RIVER_V1_SCENARIO);
      const state = sidePotRiverState(
        game,
        game.deals[dealIndex].outcome.hands,
        SIDE_POT_RIVER_TERMINAL_HISTORIES[historyIndex],
      );
      const settlement = game.settlement(state);
      assert.ok(Math.abs(settlement.utility.reduce((sum, value) => sum + value, 0)) <= 1e-9);
      assert.equal(
        settlement.contestablePot + settlement.returnedUncalled.reduce((sum, value) => sum + value, 0),
        settlement.contributions.reduce((sum, value) => sum + value, 0),
      );
      assert.equal(
        settlement.potLayers.reduce((sum, layer) => sum + layer.amount, 0),
        settlement.contestablePot,
      );
      settlement.potLayers.forEach(layer => {
        assert.ok(layer.amount > 0);
        assert.ok(layer.eligiblePlayers.length > 0);
        assert.ok(layer.winners.every(player => layer.eligiblePlayers.includes(player)));
        assert.equal(layer.awards.reduce((sum, value) => sum + value, 0), layer.amount);
      });
    },
  ), { numRuns: 100 });
});
