import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGameTreeIndex, uniformStrategy } from "../src/lib/solver/toy/game";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCompactCfr } from "../src/lib/solver/river/compact/cfr";
import { compileCompactScorekeeper, gradeCompactStrategy } from "../src/lib/solver/river/compact/scorekeeper";
import { createTurnGame, type TurnState } from "../src/lib/solver/turn/game";
import { createFlopReference, type FlopReference, type FlopReferenceState } from "../src/lib/solver/postflop/flop/reference";
import { FLOP_REFERENCE_REQUEST } from "../src/lib/solver/postflop/flop/fixtures";
import { auditFlopReference } from "../src/lib/solver/postflop/flop/oracle";
import type { FlopAction } from "../src/lib/solver/postflop/flop/rules";
import { riverComboKey, type RiverCard } from "../src/lib/solver/river/cards";

const near = (a: number, b: number, t = 1e-9) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= t, `${a} != ${b}`);
function at(game: FlopReference, actions: readonly FlopAction[] = [], deal = 0) {
  let state = game.nextChance(game.initialState(), game.deals[deal].outcome);
  for (const action of actions) state = game.nextAction(state, action);
  return state;
}

test("flop preflight locks weighted deals and every physical two-card runout", () => {
  const game = createFlopReference(FLOP_REFERENCE_REQUEST);
  assert.deepEqual(game.preflight, { compatibleDeals: 3, rangeEntries: [2, 2], blockedCombos: [0, 0], legalTurnsPerDeal: 45,
    legalRiversPerTurn: 44, orderedRunoutsPerDeal: 1980, dealRunoutPairs: 5940, stateLimit: 1000000,
    totalStates: 484813, chanceNodes: 1225, decisionNodes: 215472, terminalNodes: 268116 });
  assert.deepEqual(game.deals.map(d => d.probability), [0.25, 0.5, 0.25]);
  const forced = createFlopReference({ ...FLOP_REFERENCE_REQUEST, stackBehind: [0, 75] });
  for (const deal of forced.deals) {
    const start = forced.nextChance(forced.initialState(), deal.outcome), turns = forced.node(start);
    assert.equal(turns.kind, "chance"); if (turns.kind !== "chance") throw Error("Expected turns");
    assert.equal(turns.outcomes.length, 45); let runouts = 0, mass = 0;
    for (const t of turns.outcomes) {
      const state = forced.nextChance(start, t.outcome), rivers = forced.node(state);
      assert.equal(rivers.kind, "chance"); if (rivers.kind !== "chance") throw Error("Expected rivers");
      assert.equal(rivers.outcomes.length, 44);
      for (const r of rivers.outcomes) { assert.equal(forced.node(forced.nextChance(state, r.outcome)).kind, "terminal"); mass += t.probability * r.probability; runouts++; }
    }
    assert.equal(runouts, 1980); near(mass, 1, 1e-12);
  }
  const index = buildGameTreeIndex(game);
  for (const k of ["totalStates", "chanceNodes", "decisionNodes", "terminalNodes"] as const) assert.equal(index[k], game.preflight[k]);
});

test("flop independent line, cash, runout and slow showdown audit checks every fixture terminal", () => {
  const audit = auditFlopReference(createFlopReference(FLOP_REFERENCE_REQUEST));
  assert.deepEqual(audit, { dealsChecked: 3, orderedRunoutsChecked: 5940, statesChecked: 484813, terminalsChecked: 268116,
    maximumProbabilityDifference: 0, maximumUtilityDifference: 0 });
});

test("flop all-ins, short calls, folds and zero stacks preserve returned chips and run out both cards", () => {
  const game = createFlopReference({ ...FLOP_REFERENCE_REQUEST, rangeText: ["AsQs", "9h9d"], stackBehind: [10, 40], betSizes: [30, 30, 30] });
  const short = at(game, ["check", "bet", "call"]);
  assert.deepEqual(short.public.put, [10, 30]);
  const turn = game.nextChance(short, { kind: "card", card: "2c" });
  assert.equal(turn.public.phase, "card"); assert.throws(() => game.nextAction(turn, "check"), /Illegal/);
  const river = game.nextChance(turn, { kind: "card", card: "3c" });
  assert.deepEqual(game.settlement(river).returnedUncalled, [0, 20]); assert.equal(game.settlement(river).contestablePot, 120);
  const fold = game.settlement(at(game, ["check", "bet", "fold"]));
  assert.deepEqual(fold.utility, [-50, 50]); assert.deepEqual(fold.returnedUncalled, [0, 30]);
  assert.equal(auditFlopReference(game).maximumUtilityDifference, 0);
  for (const stacks of [[0, 40], [1, 1], [40, 10]] as const) {
    const g = createFlopReference({ ...game.request, stackBehind: stacks });
    assert.equal(auditFlopReference(g).statesChecked, g.preflight.totalStates);
  }
});

test("flop information hides other hands and unrevealed cards, retaining full three-street recall", () => {
  const game = createFlopReference(FLOP_REFERENCE_REQUEST);
  assert.equal(game.informationSet(at(game, [], 1), 0), game.informationSet(at(game, [], 2), 0));
  const turn = (line: FlopAction[], card: RiverCard) => game.nextChance(at(game, line, 1), { kind: "card", card });
  const a = turn(["check", "check"], "2c"), b = turn(["bet", "call"], "2c");
  assert.notEqual(game.informationSet(a, 0), game.informationSet(b, 0));
  assert.notEqual(game.informationSet(a, 0), game.informationSet(turn(["check", "check"], "2d"), 0));
  assert.match(game.informationSet(a, 0), /river=hidden/); assert.ok(!game.informationSet(a, 0).includes("9h9d"));
  const finishTurn = (s: FlopReferenceState) => game.nextChance(game.nextAction(game.nextAction(s, "check"), "check"), { kind: "card", card: "3c" });
  assert.notEqual(game.informationSet(finishTurn(a), 0), game.informationSet(finishTurn(b), 0));
});

test("fixed flop histories and revealed turns reduce completely to unchanged turn-v1 rules", () => {
  const game = createFlopReference(FLOP_REFERENCE_REQUEST);
  for (const line of [["check", "check"], ["bet", "call"], ["check", "bet", "call"]] as const) for (const card of ["2c", "Ts", "9c"] as const) {
    const state = game.nextChance(at(game, line, 1), { kind: "card", card }), paid = state.public.put[0];
    const reduced = createTurnGame({ id: "flop-turn-reduction", board: [...game.request.board, card], rangeText: game.request.rangeText,
      committedPerPlayer: 50 + paid, stackBehind: [75 - paid, 75 - paid], betSizes: [25, 25] });
    const deal = reduced.deals.find(d => d.outcome.hands.map(riverComboKey).join("/") === state.hands!.map(riverComboKey).join("/"))!;
    const compare = (a: FlopReferenceState, b: TurnState): void => {
      const x = game.node(a), y = reduced.node(b); assert.equal(x.kind, y.kind);
      if (x.kind === "terminal" && y.kind === "terminal") assert.deepEqual(x.utility, y.utility);
      else if (x.kind === "player" && y.kind === "player") { assert.equal(x.player, y.player); assert.deepEqual(x.actions, y.actions); x.actions.forEach(action => compare(game.nextAction(a, action), reduced.nextAction(b, action))); }
      else if (x.kind === "chance" && y.kind === "chance") {
        assert.equal(x.outcomes.length, y.outcomes.length);
        x.outcomes.forEach((child, i) => { const other = y.outcomes[i]; assert.equal(child.probability, other.probability);
          if (child.outcome.kind !== "card" || other.outcome.kind !== "river") throw Error("Expected river");
          assert.equal(child.outcome.card, other.outcome.card); compare(game.nextChance(a, child.outcome), reduced.nextChance(b, other.outcome)); });
      } else throw Error("Node mismatch");
    };
    compare(state, reduced.nextChance(reduced.initialState(), deal.outcome));
  }
});

test("flop ordinary compact CFR matches readable updates before CFR+ acceptance", () => {
  // Both future cards and choices on all three streets; early all-ins keep this parity test bounded.
  const game = createFlopReference({ ...FLOP_REFERENCE_REQUEST, rangeText: ["AsQs", "9h9d"], stackBehind: [1, 1], betSizes: [1, 1, 1] });
  for (const iterations of [1, 2, 10]) {
    const slow = solveCfr(game, { iterations }), fast = solveCompactCfr(game, { iterations, algorithm: "vanilla" });
    for (const [key, row] of slow.averageStrategy) row.probabilities.forEach((v, i) => near(v, fast.averageStrategy.get(key)!.probabilities[i], 1e-12));
    for (const [key, row] of slow.cumulativeRegrets) row.forEach((v, i) => near(v, fast.cumulativeRegrets.get(key)![i], 1e-9 * iterations * 51));
    const a = gradeStrategy(game, slow.averageStrategy, slow.index), b = gradeCompactStrategy(compileCompactScorekeeper(fast.compiled), fast.averageStrategy);
    near(a.value[0], b.value[0]); near(a.exploitability, b.exploitability);
  }
  const plus = solveCompactCfr(game, { iterations: 20, algorithm: "cfr-plus", averagingDelay: 2 });
  assert.ok(gradeStrategy(game, plus.averageStrategy, plus.index).exploitability < gradeStrategy(game, uniformStrategy(plus.index), plus.index).exploitability);
});

test("flop requests, chance and admission reject invalid inputs before expansion", () => {
  const request = structuredClone(FLOP_REFERENCE_REQUEST), game = createFlopReference(request);
  (request.board as unknown as RiverCard[])[0] = "Ac"; assert.equal(game.request.board[0], "Ks");
  assert.throws(() => createFlopReference(FLOP_REFERENCE_REQUEST, 1000), /484813 states/);
  assert.throws(() => createFlopReference(FLOP_REFERENCE_REQUEST, 1000001), /limit/);
  assert.throws(() => createFlopReference({ ...FLOP_REFERENCE_REQUEST, board: ["Ks", "Ks", "4d"] }), /duplicate/);
  assert.throws(() => createFlopReference({ ...FLOP_REFERENCE_REQUEST, rangeText: ["AsQs", "AsQs"] }), /compatible/);
  assert.throws(() => createFlopReference({ ...FLOP_REFERENCE_REQUEST, rangeText: ["AsQs:1e-300 KdKh:1e300", "9h9d"] }), /underflow/);
  for (const n of [NaN, Infinity, -1, 0.5, 1000001]) assert.throws(() => createFlopReference({ ...FLOP_REFERENCE_REQUEST, stackBehind: [n, 1] }), /whole/);
  for (const [field, length] of [["board", 3], ["rangeText", 2], ["stackBehind", 2], ["betSizes", 3]] as const) {
    assert.throws(() => createFlopReference({ ...FLOP_REFERENCE_REQUEST, [field]: new Array(length) }));
  }
  const cardNode = at(game, ["check", "check"]);
  assert.throws(() => game.nextChance(cardNode, { kind: "card", card: "As" }), /blocked/);
  assert.throws(() => game.nextChance(at(game), { kind: "card", card: "2c" }), /chance/);
  assert.throws(() => game.nextAction(game.initialState(), "check"), /Deal/);
  const turn = game.nextChance(cardNode, { kind: "card", card: "2c" });
  const riverNode = game.nextAction(game.nextAction(turn, "check"), "check");
  assert.throws(() => game.nextChance(riverNode, { kind: "card", card: "2c" }), /blocked/);
});
