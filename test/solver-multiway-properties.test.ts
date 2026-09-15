import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { MULTIWAY_RIVER_V1_SCENARIO } from "../src/lib/solver/multiway/fixture";
import { createMultiwayRiverGame, multiwayRiverState } from "../src/lib/solver/multiway/river-game";

test("positive range weights always produce one exact blocker-aware distribution", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 18, maxLength: 18 }),
    weights => {
      let weightIndex = 0;
      const scenario = {
        ...MULTIWAY_RIVER_V1_SCENARIO,
        id: "three-player-river-weight-property",
        ranges: MULTIWAY_RIVER_V1_SCENARIO.ranges.map(range => range.map(entry => ({
          ...entry,
          weight: weights[weightIndex++],
        }))) as unknown as typeof MULTIWAY_RIVER_V1_SCENARIO.ranges,
      };
      const game = createMultiwayRiverGame(scenario);
      assert.equal(game.deals.length, 172);
      const probability = game.deals.reduce((sum, deal) => sum + deal.probability, 0);
      assert.ok(Math.abs(probability - 1) <= 1e-12);
      for (const deal of game.deals) {
        const [first, second, third] = deal.outcome.hands;
        assert.equal(new Set([...first, ...second, ...third]).size, 6);
        assert.ok(Number.isFinite(deal.probability) && deal.probability > 0);
      }
    },
  ), { numRuns: 100 });
});

test("a three-way board tie and a two-way tie split the whole pot correctly", () => {
  const scenario = {
    ...MULTIWAY_RIVER_V1_SCENARIO,
    id: "three-player-river-tie-test",
    board: ["As", "Ks", "Qs", "Js", "Ts"] as const,
    ranges: [
      [{ cards: ["3c", "2d"] as const, weight: 1 }],
      [{ cards: ["5c", "4d"] as const, weight: 1 }],
      [{ cards: ["7c", "6d"] as const, weight: 1 }],
    ] as const,
  };
  const game = createMultiwayRiverGame(scenario);
  const hands = game.deals[0].outcome.hands;
  const checked = multiwayRiverState(game, hands, ["check", "check", "check"]);
  const checkedNode = game.node(checked);
  assert.equal(checkedNode.kind, "terminal");
  if (checkedNode.kind === "terminal") assert.deepEqual(checkedNode.utility, [0, 0, 0]);

  const oneFold = multiwayRiverState(game, hands, ["bet", "fold", "call"]);
  const oneFoldNode = game.node(oneFold);
  assert.equal(oneFoldNode.kind, "terminal");
  if (oneFoldNode.kind === "terminal") assert.deepEqual(oneFoldNode.utility, [15, -30, 15]);
});

test("invalid cards, weights, and empty compatible tuples are rejected", () => {
  assert.throws(() => createMultiwayRiverGame({
    ...MULTIWAY_RIVER_V1_SCENARIO,
    id: "bad-weight",
    ranges: [
      [{ ...MULTIWAY_RIVER_V1_SCENARIO.ranges[0][0], weight: 0 }],
      MULTIWAY_RIVER_V1_SCENARIO.ranges[1],
      MULTIWAY_RIVER_V1_SCENARIO.ranges[2],
    ],
  }), /invalid weight/);
  assert.throws(() => createMultiwayRiverGame({
    ...MULTIWAY_RIVER_V1_SCENARIO,
    id: "board-collision",
    ranges: [
      [{ cards: ["Ks", "Ah"], weight: 1 }],
      MULTIWAY_RIVER_V1_SCENARIO.ranges[1],
      MULTIWAY_RIVER_V1_SCENARIO.ranges[2],
    ],
  }), /collides with the board/);
  assert.throws(() => createMultiwayRiverGame({
    ...MULTIWAY_RIVER_V1_SCENARIO,
    id: "no-compatible-tuples",
    ranges: [
      [{ cards: ["As", "Qs"], weight: 1 }],
      [{ cards: ["As", "Jh"], weight: 1 }],
      [{ cards: ["As", "Td"], weight: 1 }],
    ],
  }), /no compatible private-hand tuples/);
});
