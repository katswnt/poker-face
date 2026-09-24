import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { buildGameTreeIndex } from "../src/lib/solver/toy/game";
import { parseRiverCombo } from "../src/lib/solver/river/cards";
import {
  configurableRiverState,
  createConfigurableRiverGame,
  type ConfigurableRiverAction,
  type ConfigurableRiverScenario,
} from "../src/lib/solver/river/configurable/game";
import {
  CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO,
  configurableRiverV1AdapterGame,
} from "../src/lib/solver/river/configurable/fixture";
import { riverV1Game } from "../src/lib/solver/river/fixture";

const DEAL = [parseRiverCombo("KhQh"), parseRiverCombo("KdQd")] as const;

function actions(history: readonly ConfigurableRiverAction[]) {
  const node = configurableRiverV1AdapterGame.node(
    configurableRiverState(configurableRiverV1AdapterGame, DEAL, history),
  );
  assert.equal(node.kind, "player");
  if (node.kind !== "player") throw new Error("Expected decision");
  return node.actions;
}

test("the configurable v1 adapter exactly preserves v1 tree counts", () => {
  assert.equal(configurableRiverV1AdapterGame.deals.length, riverV1Game.deals.length);
  assert.deepEqual(configurableRiverV1AdapterGame.preflight, {
    rangeEntries: [8, 8],
    compatibleDeals: 61,
    publicStatesPerDeal: 21,
    publicTerminalStatesPerDeal: 13,
    projectedFullStates: 1_282,
    projectedTerminalStates: 793,
    roughTreeMemoryBytes: 328_192,
    limits: {
      maxRangeEntriesPerPlayer: 128,
      maxCompatibleDeals: 500,
      maxProjectedStates: 50_000,
    },
  });
  const index = buildGameTreeIndex(configurableRiverV1AdapterGame);
  assert.deepEqual(
    [index.totalStates, index.decisionNodes, index.terminalNodes, index.informationSets.length],
    [1_282, 488, 793, 64],
  );
});

test("the v1 adapter generates the same finite betting menu", () => {
  assert.deepEqual(actions([]), ["check", "bet-to-50", "bet-to-100"]);
  assert.deepEqual(actions(["check"]), ["check", "bet-to-50", "bet-to-100"]);
  assert.deepEqual(actions(["bet-to-50"]), ["fold", "call", "raise-to-100"]);
  assert.deepEqual(actions(["bet-to-100"]), ["fold", "call"]);
  assert.deepEqual(actions(["bet-to-50", "raise-to-100"]), ["fold", "call"]);
});

test("unequal stacks cap an overbet at the effective all-in so every chip is callable", () => {
  const scenario: ConfigurableRiverScenario = {
    ...CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO,
    id: "river-short-call",
    stackBehind: [100, 60],
    openingBetSizes: [50, 100],
    raiseToSizes: [60, 100],
  };
  const game = createConfigurableRiverGame(scenario);
  const root = game.node(configurableRiverState(game, DEAL));
  assert.deepEqual(root.kind === "player" ? root.actions : [], ["check", "bet-to-50", "bet-to-60"]);
  assert.throws(() => configurableRiverState(game, DEAL, ["bet-to-100"]), /Illegal river action/);
  const state = configurableRiverState(game, DEAL, ["bet-to-60", "call"]);
  const result = game.settlement(state);
  assert.deepEqual(result.contributions, [110, 110]);
  assert.deepEqual(result.returnedUncalled, [0, 0]);
  assert.equal(result.contestablePot, 220);
  assert.equal(result.utility[0] + result.utility[1], 0);
});

test("minimum raises and short all-in raises are generated from public money state", () => {
  const game = createConfigurableRiverGame({
    ...CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO,
    id: "river-min-raise",
    stackBehind: [200, 120],
    openingBetSizes: [50],
    raiseToSizes: [75, 100, 120, 150],
  });
  const facing = game.node(configurableRiverState(game, DEAL, ["bet-to-50"]));
  assert.equal(facing.kind, "player");
  if (facing.kind !== "player") throw new Error("Expected response");
  assert.deepEqual(facing.actions, ["fold", "call", "raise-to-100", "raise-to-120"]);
  assert.throws(
    () => configurableRiverState(game, DEAL, ["bet-to-50", "raise-to-75"]),
    /Illegal river action/,
  );
});

test("preflight rejects oversized exact games before generic tree construction", () => {
  assert.throws(
    () => createConfigurableRiverGame(CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO, {
      maxCompatibleDeals: 60,
    }),
    /61 compatible deals; exact limit is 60/,
  );
  assert.throws(
    () => createConfigurableRiverGame(CONFIGURABLE_RIVER_V1_ADAPTER_SCENARIO, {
      maxProjectedStates: 1_281,
    }),
    /projects 1282 full states; exact limit is 1281/,
  );
});

test("configurable river terminal money is always exact and zero-sum", () => {
  fc.assert(fc.property(
    fc.constantFrom<readonly ConfigurableRiverAction[]>(
      ["check", "check"],
      ["bet-to-50", "fold"],
      ["bet-to-50", "call"],
      ["bet-to-50", "raise-to-100", "fold"],
      ["bet-to-50", "raise-to-100", "call"],
      ["bet-to-100", "fold"],
      ["bet-to-100", "call"],
      ["check", "bet-to-50", "fold"],
      ["check", "bet-to-50", "call"],
      ["check", "bet-to-50", "raise-to-100", "fold"],
      ["check", "bet-to-50", "raise-to-100", "call"],
      ["check", "bet-to-100", "fold"],
      ["check", "bet-to-100", "call"],
    ),
    history => {
      const state = configurableRiverState(configurableRiverV1AdapterGame, DEAL, history);
      const node = configurableRiverV1AdapterGame.node(state);
      assert.equal(node.kind, "terminal");
      if (node.kind !== "terminal") throw new Error("Expected terminal");
      assert.equal(node.utility[0] + node.utility[1], 0);
    },
  ));
});

test("information sets expose only the acting player's private cards", () => {
  const first = configurableRiverV1AdapterGame.informationSet(
    configurableRiverState(configurableRiverV1AdapterGame, [
      parseRiverCombo("KhQh"),
      parseRiverCombo("KdQd"),
    ]),
    0,
  );
  const second = configurableRiverV1AdapterGame.informationSet(
    configurableRiverState(configurableRiverV1AdapterGame, [
      parseRiverCombo("QhKh"),
      parseRiverCombo("8h8c"),
    ]),
    0,
  );
  assert.equal(first, second);
  assert.match(first, /hand=KhQh/);
  assert.ok(!first.includes("KdQd"));
  assert.ok(!first.includes("8h8c"));
});
