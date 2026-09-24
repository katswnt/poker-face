import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRiverCombo } from "../src/lib/solver/river/cards";
import {
  configurableRiverState,
  createConfigurableRiverGame,
  type ConfigurableRiverAction,
  type ConfigurableRiverPublicState,
  type ConfigurableRiverScenario,
} from "../src/lib/solver/river/configurable/game";
import {
  configurableRiverV3State,
  createConfigurableRiverV3Game,
  type ConfigurableRiverV3PublicState,
  type ConfigurableRiverV3Scenario,
} from "../src/lib/solver/river/configurable-v3/game";
import { createRiverGame } from "../src/lib/solver/river/game";
import { auditRiverRules } from "../src/lib/solver/river/oracle";
import { RIVER_V1_SCENARIO } from "../src/lib/solver/river/fixture";

const BOARD = ["Ks", "8s", "4s", "2c", "9d"] as const;
const one = (combo: string) => [{ cards: parseRiverCombo(combo), weight: 1 }];

function v2Scenario(overrides: Partial<ConfigurableRiverScenario>): ConfigurableRiverScenario {
  return {
    id: "audit-v2",
    version: 2,
    board: BOARD,
    ranges: [one("AhAd"), one("QhQd")],
    committed: [50, 50],
    stackBehind: [200, 200],
    positions: ["out-of-position", "in-position"],
    actionOrder: [0, 1],
    openingBetSizes: [50],
    raiseToSizes: [150],
    maxRaises: 1,
    ...overrides,
  };
}

function v3Scenario(overrides: Partial<ConfigurableRiverV3Scenario>): ConfigurableRiverV3Scenario {
  return {
    id: "audit-v3",
    version: 3,
    board: BOARD,
    ranges: [one("AhAd"), one("QhQd")],
    committed: [50, 50],
    stackBehind: [200, 200],
    positions: ["out-of-position", "in-position"],
    actionOrder: [0, 1],
    openingBetSizes: [50],
    raiseToSizes: [150],
    maxRaises: 1,
    ...overrides,
  };
}

type AnyPublic = ConfigurableRiverPublicState | ConfigurableRiverV3PublicState;

/** Walks every public decision node and checks the no-duplicate / no-uncallable-chip invariants. */
function assertNoUncallableOrDuplicateSizes(
  label: string,
  stacks: readonly [number, number],
  legal: (history: readonly ConfigurableRiverAction[]) => { public: AnyPublic; actions: readonly ConfigurableRiverAction[] },
): number {
  let decisions = 0;
  const visit = (history: readonly ConfigurableRiverAction[]): void => {
    const { public: view, actions } = legal(history);
    if (view.terminal || view.actingPlayer === null) return;
    decisions += 1;
    const actor = view.actingPlayer;
    const opponent = 1 - actor;
    assert.equal(new Set(actions).size, actions.length, `${label}: duplicate actions after ${history.join("-")}`);
    // Chips on the table facing the actor must all be matchable by the actor (no uncallable excess).
    assert.ok(
      view.streetContributions[opponent] <= stacks[actor],
      `${label}: ${view.streetContributions[opponent]} uncallable by a ${stacks[actor]} stack after ${history.join("-")}`,
    );
    for (const action of actions) {
      if (action.startsWith("bet-to-") || action.startsWith("raise-to-")) {
        const target = Number(action.slice(action.lastIndexOf("-") + 1));
        assert.ok(target <= stacks[opponent], `${label}: ${action} exceeds opponent stack ${stacks[opponent]}`);
      }
      visit([...history, action]);
    }
  };
  visit([]);
  return decisions;
}

test("v2 does not let a player raise an opponent who is already all-in", () => {
  const game = createConfigurableRiverGame(v2Scenario({
    id: "audit-v2-allin", stackBehind: [50, 200], openingBetSizes: [50], raiseToSizes: [150],
  }));
  const hands = game.deals[0].outcome.hands;
  const facing = game.node(configurableRiverState(game, hands, ["bet-to-50"]));
  assert.equal(facing.kind, "player");
  assert.deepEqual(facing.kind === "player" ? facing.actions : [], ["fold", "call"]);
});

test("v1 rules oracle derives bet sizes from the scenario instead of a 100-chip pot", () => {
  const game = createRiverGame({
    ...RIVER_V1_SCENARIO,
    id: "audit-v1-pot200",
    committed: [100, 100],
    stackBehind: [200, 200],
    betSizes: { halfPot: 100, pot: 200 },
  });
  const audit = auditRiverRules(game);
  assert.equal(audit.maximumUtilityDifference, 0);
  assert.equal(auditRiverRules(createRiverGame(RIVER_V1_SCENARIO)).maximumUtilityDifference, 0);
});

test("v2 and v3 collapse bets above the opponent's stack into one effective all-in", () => {
  const v2 = createConfigurableRiverGame(v2Scenario({
    id: "audit-v2-overbet", stackBehind: [200, 80], openingBetSizes: [100, 200], raiseToSizes: [300],
  }));
  const v3 = createConfigurableRiverV3Game(v3Scenario({
    id: "audit-v3-overbet", stackBehind: [200, 80], openingBetSizes: [100, 200], raiseToSizes: [300],
  }));
  const v2Root = v2.node(configurableRiverState(v2, v2.deals[0].outcome.hands));
  const v3Root = v3.node(configurableRiverV3State(v3, v3.deals[0].outcome.hands));
  assert.deepEqual(v2Root.kind === "player" ? v2Root.actions : [], ["check", "bet-to-80"]);
  assert.deepEqual(v3Root.kind === "player" ? v3Root.actions : [], ["check", "bet-to-80"]);
});

test("v3 collapses raises above the opponent's stack into one effective all-in raise", () => {
  const game = createConfigurableRiverV3Game(v3Scenario({
    id: "audit-v3-overraise", stackBehind: [300, 120], openingBetSizes: [50],
    raiseToSizes: [100, 200, 300], maxRaises: 2,
  }));
  const hands = game.deals[0].outcome.hands;
  const node = game.node(configurableRiverV3State(game, hands, ["bet-to-50", "raise-to-100"]));
  assert.deepEqual(node.kind === "player" ? node.actions : [], ["fold", "call", "raise-to-120"]);
});

test("unequal-stack v2 and v3 trees never offer uncallable chips or duplicate sizes", () => {
  const cases: [number, number][] = [[200, 80], [80, 200], [120, 200], [300, 120], [50, 200]];
  for (const stacks of cases) {
    const v2 = createConfigurableRiverGame(v2Scenario({
      id: "audit-v2-walk", stackBehind: stacks, openingBetSizes: [50, 100, 200], raiseToSizes: [100, 150, 200, 300],
    }));
    const v2Hands = v2.deals[0].outcome.hands;
    assert.ok(assertNoUncallableOrDuplicateSizes(`v2 ${stacks}`, stacks, history => {
      const state = configurableRiverState(v2, v2Hands, history);
      return { public: state.public, actions: v2.legalActions(state.public) };
    }) > 0);
    const v3 = createConfigurableRiverV3Game(v3Scenario({
      id: "audit-v3-walk", stackBehind: stacks, openingBetSizes: [50, 100, 200],
      raiseToSizes: [100, 150, 200, 300], maxRaises: 2,
    }));
    const v3Hands = v3.deals[0].outcome.hands;
    assert.ok(assertNoUncallableOrDuplicateSizes(`v3 ${stacks}`, stacks, history => {
      const state = configurableRiverV3State(v3, v3Hands, history);
      return { public: state.public, actions: v3.legalActions(state.public) };
    }) > 0);
  }
});
