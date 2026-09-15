import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { FOUR_PLAYER_RIVER_V1_SCENARIO } from "../src/lib/solver/multiway/four-player-fixture";
import {
  createFourPlayerRiverGame,
  fourPlayerRiverState,
} from "../src/lib/solver/multiway/four-player-river-game";
import { FOUR_PLAYER_TERMINAL_HISTORIES } from "../src/lib/solver/multiway/four-player-oracle";

test("four-player positive range weights form one exact compatible distribution", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 16, maxLength: 16 }),
    weights => {
      let index = 0;
      const game = createFourPlayerRiverGame({
        ...FOUR_PLAYER_RIVER_V1_SCENARIO,
        id: "four-player-weight-property",
        ranges: FOUR_PLAYER_RIVER_V1_SCENARIO.ranges.map(range => range.map(entry => ({
          ...entry,
          weight: weights[index++],
        }))) as unknown as typeof FOUR_PLAYER_RIVER_V1_SCENARIO.ranges,
      });
      assert.equal(game.deals.length, 174);
      assert.ok(Math.abs(game.deals.reduce((sum, deal) => sum + deal.probability, 0) - 1) <= 1e-12);
      for (const deal of game.deals) {
        assert.equal(new Set(deal.outcome.hands.flat()).size, 8);
        assert.ok(Number.isFinite(deal.probability) && deal.probability > 0);
      }
    },
  ), { numRuns: 100 });
});

test("random four-player deals and endings conserve chips", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 173 }),
    fc.integer({ min: 0, max: FOUR_PLAYER_TERMINAL_HISTORIES.length - 1 }),
    (dealIndex, historyIndex) => {
      const game = createFourPlayerRiverGame(FOUR_PLAYER_RIVER_V1_SCENARIO);
      const settlement = game.settlement(fourPlayerRiverState(
        game,
        game.deals[dealIndex].outcome.hands,
        FOUR_PLAYER_TERMINAL_HISTORIES[historyIndex],
      ));
      assert.ok(Math.abs(settlement.utility.reduce((sum, value) => sum + value, 0)) <= 1e-9);
      assert.equal(settlement.awards.reduce((sum, value) => sum + value, 0), settlement.pot);
      assert.equal(settlement.contributions.reduce((sum, value) => sum + value, 0), settlement.pot);
      assert.ok(settlement.winners.every(player => settlement.awards[player] > 0));
    },
  ), { numRuns: 100 });
});
