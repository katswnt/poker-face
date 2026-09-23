import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { buildGameTreeIndex, uniformStrategy, type BehavioralStrategy, type ExtensiveFormGame } from "../src/lib/solver/toy/game";
import { evaluateStrategy, gradeStrategy } from "../src/lib/solver/toy/best-response";
import { deserializeBehavioralStrategy, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { riverComboKey, type RiverCard } from "../src/lib/solver/river/cards";
import { prepareConfigurableRiverV3 } from "../src/lib/solver/river/configurable-v3/solve";
import { createTurnGame, type TurnAction, type TurnChance, type TurnGame, type TurnState } from "../src/lib/solver/turn/game";
import { TURN_DEMO_REQUEST, turnDemoGame } from "../src/lib/solver/turn/fixture";
import { auditTurnRules } from "../src/lib/solver/turn/oracle";
import { solveTurn } from "../src/lib/solver/turn/solve";

function at(game: TurnGame, actions: readonly TurnAction[], deal = 0): TurnState {
  let state = game.nextChance(game.initialState(), game.deals[deal].outcome);
  for (const action of actions) state = game.nextAction(state, action);
  return state;
}
const near = (a: number, b: number, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("turn fixture locks full tree, weighted compatible deals, and all physical river cards", () => {
  const game = turnDemoGame;
  const index = buildGameTreeIndex(game);
  assert.equal(index.totalStates, 3592);
  assert.equal(index.chanceNodes, 10);
  assert.equal(index.decisionNodes, 1596);
  assert.equal(index.terminalNodes, 1986);
  assert.equal(index.informationSets.length, 1088);
  for (const key of ["totalStates", "chanceNodes", "decisionNodes", "terminalNodes"] as const) {
    assert.equal(index[key], game.preflight[key]);
  }
  assert.deepEqual(game.deals.map(deal => [deal.outcome.hands.map(riverComboKey).join("/"), deal.probability]), [
    ["AsQs/9h9d", 0.25], ["KhKd/9h9d", 0.5], ["KhKd/QsJs", 0.25],
  ]);
  game.deals.forEach((deal, i) => {
    const chance = game.node(at(game, ["check", "check"], i));
    assert.equal(chance.kind, "chance");
    if (chance.kind !== "chance") throw new Error("Expected river draw");
    assert.equal(chance.outcomes.length, 44);
    const cards = chance.outcomes.map(child => {
      assert.equal(child.probability, 1 / 44);
      assert.equal(child.outcome.kind, "river");
      if (child.outcome.kind !== "river") throw new Error("Not river");
      assert.ok(![...game.request.board, ...deal.outcome.hands.flat()].includes(child.outcome.card));
      return child.outcome.card;
    });
    assert.equal(new Set(cards).size, 44);
  });
});

test("turn rules independently enumerate and grade every fixture terminal", () => {
  assert.deepEqual(auditTurnRules(turnDemoGame), {
    dealsChecked: 3, dealRiverPairsChecked: 132, terminalsChecked: 1986,
    maximumProbabilityDifference: 0, maximumUtilityDifference: 0, maximumZeroSumError: 0,
  });
});

test("turn actions, stack carryover, short calls, returns, and automatic all-in runouts", () => {
  const game = createTurnGame({ ...TURN_DEMO_REQUEST, stackBehind: [60, 150], betSizes: [100, 100] });
  const shortCall = at(game, ["check", "bet", "call"]);
  assert.deepEqual(shortCall.put, [60, 100]);
  assert.equal(shortCall.phase, "river-card");
  const terminal = game.nextChance(shortCall, { kind: "river", card: "3c" });
  assert.equal(game.node(terminal).kind, "terminal");
  assert.deepEqual(game.settlement(terminal).returnedUncalled, [0, 40]);
  assert.equal(game.settlement(terminal).contestablePot, 220);
  assert.throws(() => game.nextAction(terminal, "bet"), /Illegal/);
  assert.throws(() => game.nextAction(at(game, ["bet"]), "bet"), /Illegal/);
  const fold = at(game, ["bet", "fold"]);
  assert.equal(fold.river, null);
  assert.deepEqual(game.settlement(fold).utility, [50, -50]);
  assert.deepEqual(game.settlement(fold).returnedUncalled, [60, 0]);
  const regular = turnDemoGame;
  const river = regular.nextChance(at(regular, ["bet", "call"]), { kind: "river", card: "3c" });
  assert.equal(river.actor, 0);
  assert.deepEqual(regular.nextAction(river, "bet").put, [150, 50]);
  assert.equal(auditTurnRules(game).maximumUtilityDifference, 0);
  const zero = createTurnGame({ ...TURN_DEMO_REQUEST, stackBehind: [0, 150] });
  assert.equal(at(zero, []).phase, "river-card");
  assert.equal(zero.preflight.decisionNodes, 0);
  assert.equal(auditTurnRules(zero).maximumUtilityDifference, 0);
});

test("preflight and oracle agree across unequal/short/zero-stack and tie games", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 10 }),
    fc.integer({ min: 1, max: 15 }), (a, b, bet) => {
      const game = createTurnGame({ ...TURN_DEMO_REQUEST, rangeText: ["AsQs", "9h9d"], stackBehind: [a, b], betSizes: [bet, bet] });
      const index = buildGameTreeIndex(game);
      assert.equal(index.totalStates, game.preflight.totalStates);
      assert.equal(index.terminalNodes, game.preflight.terminalNodes);
      assert.equal(auditTurnRules(game).maximumUtilityDifference, 0);
    }), { numRuns: 12, seed: 20260922 });
  const tie = createTurnGame({ ...TURN_DEMO_REQUEST, board: ["As", "Ks", "Qs", "Js"], rangeText: ["2c3c", "4d5d"] });
  let state = tie.nextChance(at(tie, ["check", "check"]), { kind: "river", card: "Ts" });
  state = tie.nextAction(tie.nextAction(state, "bet"), "call");
  assert.deepEqual(tie.settlement(state).utility, [0, 0]);
  assert.equal(auditTurnRules(tie).maximumUtilityDifference, 0);
});

test("turn input is copied, bounded, and rejects malformed games and illegal chance edges", () => {
  const input = structuredClone(TURN_DEMO_REQUEST);
  const game = createTurnGame(input);
  (input.board as unknown as RiverCard[])[0] = "Ac";
  assert.equal(game.request.board[0], "Ks");
  assert.throws(() => createTurnGame({ ...TURN_DEMO_REQUEST, board: ["Ks", "Ks", "4d", "2c"] }), /duplicate/);
  assert.throws(() => createTurnGame({ ...TURN_DEMO_REQUEST, rangeText: ["AA KK", "QQ"] }), /8 combinations/);
  assert.throws(() => createTurnGame({ ...TURN_DEMO_REQUEST, rangeText: ["AA", "QQ"] }), /16 compatible/);
  assert.throws(() => createTurnGame({ ...TURN_DEMO_REQUEST, rangeText: ["AsQs", "AsQs"] }), /no compatible/);
  assert.throws(() => createTurnGame(TURN_DEMO_REQUEST, 100), /3592 states/);
  assert.throws(() => createTurnGame(TURN_DEMO_REQUEST, 25001), /limit/);
  for (const n of [-1, 0.5, Infinity, NaN, 1000001]) {
    assert.throws(() => createTurnGame({ ...TURN_DEMO_REQUEST, stackBehind: [n, 1] }), /whole/);
  }
  const extreme = createTurnGame({ ...TURN_DEMO_REQUEST, rangeText: ["AsQs:1e300 KdKh:1e300", "9h9d:1e300"] });
  assert.deepEqual(extreme.deals.map(deal => deal.probability), [0.5, 0.5]);
  assert.throws(() => auditTurnRules(extreme), /finite positive raw weight mass/);
  assert.throws(() => createTurnGame({ ...TURN_DEMO_REQUEST, rangeText: ["AsQs:1e-300 KdKh:1e300", "9h9d"] }), /underflow/);
  assert.throws(() => game.nextChance(game.initialState(), { kind: "river", card: "3c" }), /phase/);
  assert.throws(() => game.nextChance(at(game, ["check", "check"]), { kind: "river", card: "Qs" }), /Blocked/);
  assert.throws(() => game.informationSet(at(game, []), 1), /Not this player/);
  for (const iterations of [0, -1, 0.5, 100001, Infinity]) {
    assert.throws(() => solveTurn(TURN_DEMO_REQUEST, { iterations }), /iterations/);
  }
  assert.throws(() => solveTurn(TURN_DEMO_REQUEST, { iterations: 100, checkpointIterations: Array(17).fill(1) }), /16 saved/);
});

test("information sets hide the other hand, remember turn actions, and reveal only the dealt river", () => {
  const game = turnDemoGame;
  // First player's kings are compatible with two different opponent hands.
  const left = at(game, [], 1), right = at(game, [], 2);
  assert.equal(game.informationSet(left, 0), game.informationSet(right, 0));
  assert.equal(left.river, null);
  const onRiver = (turn: TurnAction[], card: RiverCard) => game.nextChance(at(game, turn, 1), { kind: "river", card });
  const afterChecks = onRiver(["check", "check"], "3c");
  const afterBet = onRiver(["bet", "call"], "3c");
  assert.notEqual(game.informationSet(afterChecks, 0), game.informationSet(afterBet, 0));
  assert.notEqual(game.informationSet(afterChecks, 0), game.informationSet(onRiver(["check", "check"], "3d"), 0));
  assert.ok(!game.informationSet(afterChecks, 0).includes("9h9d"));
});

test("river continuations reduce to v3 no-raise money, actions, and terminal values", () => {
  const game = turnDemoGame;
  for (const turn of [["check", "check"], ["bet", "call"], ["check", "bet", "call"]] as const) {
    const draw = at(game, turn, 1);
    for (const card of ["3c", "Ts", "9c"] as const) {
      const river = game.nextChance(draw, { kind: "river", card });
      const { game: v3 } = prepareConfigurableRiverV3({ id: "turn-reduction", board: [...game.request.board, card],
        rangeText: game.request.rangeText, committed: [50 + river.put[0], 50 + river.put[1]],
        stackBehind: [150 - river.put[0], 150 - river.put[1]], openingBetSizes: [100], raiseToSizes: [100], maxRaises: 0 });
      const fixed = v3.nextChance(v3.initialState(), { hands: river.hands! });
      const visit = (a: TurnState, b: typeof fixed): void => {
        const x = game.node(a), y = v3.node(b);
        assert.equal(x.kind, y.kind);
        if (x.kind === "terminal" && y.kind === "terminal") assert.deepEqual(x.utility, y.utility);
        else if (x.kind === "player" && y.kind === "player") {
          assert.equal(x.player, y.player);
          assert.deepEqual(x.actions.map(action => action === "bet" ? "bet-to-100" : action), y.actions);
          x.actions.forEach((action, i) => visit(game.nextAction(a, action), v3.nextAction(b, y.actions[i])));
        } else throw new Error("Unexpected continuation chance");
      };
      visit(river, fixed);
    }
  }
});

// Independent restricted-action experiment: opener must shove. The responder still
// cannot know the private opposing cards or future public card. Only 4 pure responses.
function allInResponseGame(): TurnGame {
  const base = createTurnGame({ ...TURN_DEMO_REQUEST, id: "turn-all-in-response", stackBehind: [50, 50] });
  return { ...base, node(state) {
    const node = base.node(state);
    return node.kind === "player" && state.histories[0].length === 0 ? { ...node, actions: ["bet"] } : node;
  } };
}
type PredealtState = { readonly base: TurnState; readonly future: RiverCard | null };
type PredealtChance = { readonly kind: "predeal"; readonly deal: TurnChance; readonly card: RiverCard }
  | { readonly kind: "reveal"; readonly card: RiverCard };
function predealtGame(base: TurnGame, cheat: boolean): ExtensiveFormGame<PredealtState, TurnAction, PredealtChance> {
  return {
    id: `${base.id}-${cheat ? "cheating" : "hidden"}`,
    initialState: () => ({ base: base.initialState(), future: null }),
    node(state) {
      const node = base.node(state.base);
      if (node.kind !== "chance") return node;
      if (state.future) return { kind: "chance", outcomes: [{ outcome: { kind: "reveal", card: state.future }, probability: 1 }] };
      return { kind: "chance", outcomes: base.deals.flatMap(deal => {
        const runout = base.node(at(base, ["bet", "call"], base.deals.indexOf(deal)));
        if (runout.kind !== "chance") throw new Error("Expected runout");
        return runout.outcomes.map(child => {
          if (child.outcome.kind !== "river") throw new Error("Expected river");
          return { outcome: { kind: "predeal" as const, deal: deal.outcome, card: child.outcome.card }, probability: deal.probability / 44 };
        });
      }) };
    },
    nextChance(state, outcome) {
      return outcome.kind === "predeal"
        ? { base: base.nextChance(state.base, outcome.deal), future: outcome.card }
        : { base: base.nextChance(state.base, { kind: "river", card: outcome.card }), future: state.future };
    },
    nextAction: (state, action) => ({ ...state, base: base.nextAction(state.base, action) }),
    informationSet: (state, player) => base.informationSet(state.base, player) + (cheat ? `:future=${state.future}` : ""),
  };
}

test("best response agrees with exhaustive hidden-information choices; future-card peeking gains illegally", () => {
  const game = allInResponseGame();
  const index = buildGameTreeIndex(game);
  const profile = uniformStrategy(index);
  const normal = gradeStrategy(game, profile, index);
  const exhaustive = gradeStrategy(game, profile, index, { bestResponseMethod: "exhaustive", maxPureStrategies: 4 });
  near(normal.bestResponses[0].value, exhaustive.bestResponses[0].value);
  near(normal.bestResponses[1].value, exhaustive.bestResponses[1].value);
  assert.equal(exhaustive.bestResponses[1].pureStrategiesChecked, 4);
  const hidden = predealtGame(game, false);
  const hiddenGrade = gradeStrategy(hidden, profile);
  near(hiddenGrade.value[0], normal.value[0]);
  near(hiddenGrade.bestResponses[1].value, normal.bestResponses[1].value);
  const cheating = predealtGame(game, true);
  const cheatingGrade = gradeStrategy(cheating, uniformStrategy(buildGameTreeIndex(cheating)));
  assert.ok(cheatingGrade.bestResponses[1].value > normal.bestResponses[1].value + 5,
    "revealing the future card must create a detectable unattainable advantage");
});

test("earlier action probabilities and revealed blockers change joint range reach", () => {
  const game = turnDemoGame;
  const index = buildGameTreeIndex(game);
  const profile = new Map(uniformStrategy(index));
  for (const deal of game.deals) {
    const state = game.nextChance(game.initialState(), deal.outcome);
    const betChance = riverComboKey(deal.outcome.hands[0]) === "AsQs" ? 0.8 : 0.2;
    profile.set(game.informationSet(state, 0), { actions: ["check", "bet"], probabilities: [1 - betChance, betChance] });
  }
  const posterior = (river: RiverCard) => {
    const found: { hand: string; mass: number }[] = [];
    function visit(state: TurnState, reach: number) {
      const node = game.node(state);
      if (node.kind === "terminal") return;
      if (node.kind === "chance") {
        node.outcomes.forEach(child => visit(game.nextChance(state, child.outcome), reach * child.probability)); return;
      }
      if (state.river === river && state.histories[0].join("/") === "bet/call" && state.histories[1].join("/") === "check" && riverComboKey(state.hands![1]) === "9h9d") {
        found.push({ hand: riverComboKey(state.hands![0]), mass: reach }); return;
      }
      const entry = profile.get(game.informationSet(state, node.player))!;
      node.actions.forEach((action, i) => visit(game.nextAction(state, action), reach * entry.probabilities[i]));
    }
    visit(game.initialState(), 1);
    const total = found.reduce((sum, entry) => sum + entry.mass, 0);
    return found.map(entry => ({ hand: entry.hand, probability: entry.mass / total }));
  };
  // Prior given nines: AsQs 1/3, kings 2/3; an 80% vs 20% bet changes that to 2/3 vs 1/3.
  const unblocked = posterior("3c");
  near(unblocked.find(entry => entry.hand === "AsQs")!.probability, 2 / 3);
  assert.deepEqual(posterior("As"), [{ hand: "KhKd", probability: 1 }]);
});

test("ordinary CFR is deterministic with real convergence and policy validation", () => {
  const left = solveTurn(TURN_DEMO_REQUEST, { iterations: 80, checkpointIterations: [1, 80] });
  const right = solveTurn(TURN_DEMO_REQUEST, { iterations: 80, updateOrder: [1, 0] });
  assert.deepEqual(left.result.averageStrategy, right.result.averageStrategy);
  assert.deepEqual(left.grade.value, right.grade.value);
  assert.ok(left.grade.exploitability < gradeStrategy(left.game, uniformStrategy(left.result.index)).exploitability);
  assert.equal(left.result.checkpoints.length, 2);
  const serialized = serializeBehavioralStrategy(left.result.averageStrategy);
  const decoded: BehavioralStrategy<TurnAction> = deserializeBehavioralStrategy(left.result.index, serialized);
  assert.deepEqual(evaluateStrategy(left.game, decoded), left.grade.value);
  const [key] = Object.keys(serialized);
  assert.throws(() => deserializeBehavioralStrategy(left.result.index, { ...serialized, [`${key}:future=As`]: serialized[key] }), /information sets/);
  const action = left.result.index.informationSetByKey.get(key)!.actions[0];
  assert.throws(() => deserializeBehavioralStrategy(left.result.index, { ...serialized, [key]: { ...serialized[key], [action]: NaN } }), /finite/);
});
