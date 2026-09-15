import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { RAISED_RIVER_V1_SCENARIO } from "../src/lib/solver/multiway/raised-fixture";
import { RAISED_RIVER_TERMINAL_HISTORIES } from "../src/lib/solver/multiway/raised-oracle";
import { createRaisedRiverGame, raisedRiverState } from "../src/lib/solver/multiway/raised-river-game";

test("raised range weights always form one exact blocker-aware distribution", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 18, maxLength: 18 }),
    weights => {
      let weightIndex = 0;
      const game = createRaisedRiverGame({
        ...RAISED_RIVER_V1_SCENARIO,
        id: "three-player-raised-river-weight-property",
        ranges: RAISED_RIVER_V1_SCENARIO.ranges.map(range => range.map(entry => ({
          ...entry,
          weight: weights[weightIndex++],
        }))) as unknown as typeof RAISED_RIVER_V1_SCENARIO.ranges,
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

test("all legal raised terminals conserve chips across valid stack sizes", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 100 }),
    fc.integer({ min: 2, max: 100 }),
    fc.integer({ min: 1, max: 99 }),
    (committed, stack, proposedBet) => {
      const betSize = 1 + (proposedBet % (stack - 1));
      const game = createRaisedRiverGame({
        ...RAISED_RIVER_V1_SCENARIO,
        id: "three-player-raised-river-money-property",
        committed: [committed, committed, committed],
        stackBehind: [stack, stack, stack],
        betSize,
        raiseTo: stack,
      });
      const hands = game.deals[0].outcome.hands;
      for (const history of RAISED_RIVER_TERMINAL_HISTORIES) {
        const state = raisedRiverState(game, hands, history);
        const settlement = game.settlement(state);
        assert.ok(Math.abs(settlement.utility.reduce((sum, value) => sum + value, 0)) <= 1e-9);
        assert.ok(settlement.contestablePot >= committed * 3);
        settlement.returnedUncalled.forEach(value => assert.ok(value >= 0));
        assert.equal(
          settlement.contestablePot + settlement.returnedUncalled.reduce((sum, value) => sum + value, 0),
          settlement.contributions.reduce((sum, value) => sum + value, 0),
        );
      }
    },
  ), { numRuns: 100 });
});
