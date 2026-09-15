import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { TWO_SIZE_RIVER_V1_SCENARIO } from "../src/lib/solver/multiway/two-size-fixture";
import { TWO_SIZE_RIVER_TERMINAL_HISTORIES } from "../src/lib/solver/multiway/two-size-oracle";
import { createTwoSizeRiverGame, twoSizeRiverState } from "../src/lib/solver/multiway/two-size-river-game";

test("two-size positive range weights form one exact compatible distribution", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 18, maxLength: 18 }),
    weights => {
      let weightIndex = 0;
      const game = createTwoSizeRiverGame({
        ...TWO_SIZE_RIVER_V1_SCENARIO,
        id: "three-player-two-size-weight-property",
        ranges: TWO_SIZE_RIVER_V1_SCENARIO.ranges.map(range => range.map(entry => ({
          ...entry,
          weight: weights[weightIndex++],
        }))) as unknown as typeof TWO_SIZE_RIVER_V1_SCENARIO.ranges,
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

test("random exact deals and legal endings always conserve chips", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 171 }),
    fc.integer({ min: 0, max: TWO_SIZE_RIVER_TERMINAL_HISTORIES.length - 1 }),
    (dealIndex, historyIndex) => {
      const game = createTwoSizeRiverGame(TWO_SIZE_RIVER_V1_SCENARIO);
      const hands = game.deals[dealIndex].outcome.hands;
      const history = TWO_SIZE_RIVER_TERMINAL_HISTORIES[historyIndex];
      const settlement = game.settlement(twoSizeRiverState(game, hands, history));
      assert.ok(Math.abs(settlement.utility.reduce((sum, value) => sum + value, 0)) <= 1e-9);
      assert.ok(settlement.contestablePot >= 90);
      settlement.returnedUncalled.forEach(value => assert.ok(value >= 0));
      assert.equal(
        settlement.contestablePot + settlement.returnedUncalled.reduce((sum, value) => sum + value, 0),
        settlement.contributions.reduce((sum, value) => sum + value, 0),
      );
    },
  ), { numRuns: 100 });
});
