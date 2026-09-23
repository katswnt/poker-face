import assert from "node:assert/strict";
import { test } from "node:test";
import { compileTurnV2, preflightTurnV2 } from "../src/lib/solver/postflop/configurable-turn/game";
import { TURN_V2_CORPUS, TURN_V2_HELD_OUT } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { createReadableTurnV2 } from "../src/lib/solver/postflop/configurable-turn/readable";
import { replayTurnV2Money, oracleTurnV2Utility } from "../src/lib/solver/postflop/configurable-turn/oracle";
import { initialTurnV2State, nextTurnV2Action, nextTurnV2River, turnV2Actions, validateTurnV2Request,
  type TurnV2Action, type TurnV2Request } from "../src/lib/solver/postflop/configurable-turn/rules";
import { createVectorTurnSession, restoreVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { compileVectorTurn } from "../src/lib/solver/postflop/vector/game";
import { POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";
import { buildGameTreeIndex, uniformStrategy, type BehavioralStrategy } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";

const near = (a: number, b: number, tolerance = 1e-9) => {
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
  assert.ok(Math.abs(a - b) <= tolerance, `${a} versus ${b}, tolerance ${tolerance}`);
};
const samePolicy = (a: BehavioralStrategy<TurnV2Action>, b: BehavioralStrategy<TurnV2Action>) => {
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [key, row] of a) {
    assert.deepEqual(row.actions, b.get(key)!.actions);
    row.probabilities.forEach((p, i) => near(p, b.get(key)!.probabilities[i]));
  }
};
let seed = 347923;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 1) / (2 ** 32 + 1); };

for (const request of [...TURN_V2_CORPUS.slice(1), ...TURN_V2_HELD_OUT]) {
  test(`turn v2 independent ledger checks every public state/action: ${request.id}`, () => {
    const game = compileTurnV2(request);
    game.publicStates.forEach((state, n) => {
      const replay = replayTurnV2Money(request, state.histories, state.river);
      assert.deepEqual(state, replay.state);
      assert.deepEqual(game.actions[n], replay.legal);
      assert.equal(game.terminalScale[n], request.committedPerPlayer + state.carried + Math.min(...state.streetPaid));
      for (const p of [0, 1] as const) {
        assert.equal(replay.cash[p] + replay.gross[p] - replay.refunds[p], request.stackBehind[p]);
        assert.ok(replay.cash[p] >= 0);
      }
    });
  });
  test(`turn v2 readable index, chance and every endpoint agree with slow oracle: ${request.id}`, () => {
    const game = compileTurnV2(request), readable = createReadableTurnV2(request);
    assert.deepEqual(game.index, buildGameTreeIndex(readable, { maxStates: 100_000 }));
    // Cache only by complete public history/deal: every distinct endpoint is checked.
    const visit = (state: ReturnType<typeof readable.initialState>) => {
      const node = readable.node(state);
      if (node.kind === "terminal") {
        const expected = oracleTurnV2Utility(request, state.public.histories, state.public.river, state.hands!);
        node.utility.forEach((value, p) => near(value, expected[p], 0));
      } else if (node.kind === "chance") {
        near(node.outcomes.reduce((sum, row) => sum + row.probability, 0), 1, 1e-12);
        if (state.hands) { assert.equal(node.outcomes.length, 44); for (const row of node.outcomes) assert.equal(row.probability, 1 / 44); }
        node.outcomes.forEach(row => visit(readable.nextChance(state, row.outcome)));
      } else node.actions.forEach(action => visit(readable.nextAction(state, action)));
    };
    visit(readable.initialState());
  });
  test(`turn v2 mixed/pure/uniform profiles and responses equal readable: ${request.id}`, () => {
    const game = compileTurnV2(request), readable = createReadableTurnV2(request);
    const scale = request.committedPerPlayer + Math.min(...request.stackBehind);
    for (const kind of ["uniform", "pure", "mixed"]) {
      const policy = new Map(uniformStrategy(game.index));
      for (const [key, row] of policy) {
        const selected = Math.floor(random() * row.actions.length);
        const weights = row.actions.map((_, a) => kind === "pure" ? Number(a === selected) : kind === "uniform" ? 1 : random());
        const total = weights.reduce((a, b) => a + b, 0);
        policy.set(key, { actions: row.actions, probabilities: weights.map(w => w / total) });
      }
      const expected = gradeStrategy(readable, policy);
      for (const kernel of ["vector", "naive"] as const) {
        const actual = gradeVectorTurn(game, policy, kernel);
        for (const p of [0, 1] as const) {
          near(actual.value[p], expected.value[p], 1e-10 * scale);
          near(actual.bestResponses[p].value, expected.bestResponses[p].value, 1e-10 * scale);
        }
      }
    }
  });
}

// Small, nonuniform, blocker-overlapping game keeps the fully materialized oracle bounded.
const differential: TurnV2Request = validateTurnV2Request({ ...TURN_V2_HELD_OUT[0], stackBehind: [17, 11],
  streets: [{ openingTargets: [3, 5], raiseTargets: [8], raiseLimit: 1, includeAllIn: false },
    { openingTargets: [2], raiseTargets: [4], raiseLimit: 1, includeAllIn: false }] });
test("turn v2 vanilla CFR equals the independent readable solver at 1/2/10/100", () => {
  const game = compileTurnV2(differential), readable = createReadableTurnV2(differential);
  const session = createVectorTurnSession(game, { iterations: 100, algorithm: "vanilla" });
  for (const iteration of [1, 2, 10, 100]) {
    session.advance(iteration - session.iterations);
    const actual = session.snapshot(), expected = solveCfr(readable, { iterations: iteration });
    samePolicy(actual.currentStrategy, expected.currentStrategy); samePolicy(actual.averageStrategy, expected.averageStrategy);
    for (const [key, row] of actual.cumulativeRegrets) row.forEach((v, a) => near(v, expected.cumulativeRegrets.get(key)![a], 1e-9 * iteration * 61));
  }
});
for (const algorithm of ["vanilla", "cfr-plus"] as const) test(`turn v2 ${algorithm} vector/pair parity and bit-identical restore`, () => {
  const game = compileTurnV2(differential), options = { iterations: 100, algorithm, averagingDelay: algorithm === "vanilla" ? 0 : 20 };
  const vector = createVectorTurnSession(game, options), naive = createVectorTurnSession(game, { ...options, kernel: "naive" });
  for (const iteration of [1, 2, 10, 100]) {
    vector.advance(iteration - vector.iterations); naive.advance(iteration - naive.iterations);
    const a = vector.snapshot(), b = naive.snapshot();
    samePolicy(a.currentStrategy, b.currentStrategy); samePolicy(a.averageStrategy, b.averageStrategy);
    for (const field of ["cumulativeRegrets", "strategySums"] as const) for (const [key, row] of a[field]) {
      row.forEach((v, i) => near(v, b[field].get(key)![i], 1e-9 * iteration * 61));
    }
  }
  const split = createVectorTurnSession(game, options); split.advance(17);
  const restored = restoreVectorTurnSession(game, JSON.parse(JSON.stringify(split.checkpoint()))); restored.advance(83);
  assert.deepEqual(restored.checkpoint(), vector.checkpoint());
  assert.throws(() => restoreVectorTurnSession(compileVectorTurn(POSTFLOP_M2_PROBE), split.checkpoint()), /identity/);
});

test("turn v2 street-relative targets reset, call returns excess, and all-in players cannot be raised", () => {
  const request = validateTurnV2Request({ ...TURN_V2_CORPUS[1], stackBehind: [90, 60],
    streets: [{ openingTargets: [40], raiseTargets: [60, 90], raiseLimit: 1, includeAllIn: true }, TURN_V2_CORPUS[1].streets[1]] });
  const root = initialTurnV2State(request);
  const bet = nextTurnV2Action(request, root, "bet-to-40");
  assert.deepEqual(turnV2Actions(request, bet), ["fold", "call", "raise-to-60"]); // Short all-in: +20, less than 40.
  const raised = nextTurnV2Action(request, bet, "raise-to-60");
  assert.deepEqual(turnV2Actions(request, { ...raised, raisesUsed: 0 }), ["fold", "call"]); // Not merely the cap.
  const called = nextTurnV2Action(request, nextTurnV2Action(request, root, "bet-to-90"), "call");
  assert.equal(called.carried, 60); assert.deepEqual(called.returned, [30, 0]);
  assert.equal(nextTurnV2River(request, called, "3c").phase, "terminal");
  const matched = nextTurnV2Action(request, bet, "call"), river = nextTurnV2River(request, matched, "3c");
  assert.equal(river.carried, 40); assert.deepEqual(river.streetPaid, [0, 0]);
  assert.deepEqual(turnV2Actions(request, river), ["check", "bet-to-10", "bet-to-25"]);
  const riverBet = nextTurnV2Action(request, river, "bet-to-25");
  assert.deepEqual(riverBet.streetPaid, [25, 0]);
});
test("turn v2 skips out-of-stack normal targets instead of silently clipping them", () => {
  const request = validateTurnV2Request({ ...TURN_V2_CORPUS[1], stackBehind: [17, 5] });
  assert.deepEqual(turnV2Actions(request, initialTurnV2State(request)), ["check"]);
  const explicit = validateTurnV2Request({ ...request, streets: request.streets.map(menu => ({ ...menu, includeAllIn: true })) });
  assert.deepEqual(turnV2Actions(explicit, initialTurnV2State(explicit)), ["check", "bet-to-17"]);
});
test("turn v2 preflight admits the locked wide case and refuses malformed or excessive games", () => {
  const counts = preflightTurnV2(TURN_V2_CORPUS[0]);
  assert.equal(counts.compatibleDeals, 3773); assert.equal(counts.publicStates, 6699);
  assert.equal(counts.totalStates, 23177540); assert.ok(counts.estimatedPeakBytes < 2 * 1024 ** 3);
  assert.throws(() => createReadableTurnV2(TURN_V2_CORPUS[0]), /Readable/);
  for (const patch of [{ version: 1 }, { mystery: true }, { stackBehind: [-1, 100] }, { committedPerPlayer: 0.5 },
    { board: ["As", "As", "2c", "3d"] }, { rangeText: ["AcQc:1e-13 KdKh", "9h9d"] },
    { streets: [{ openingTargets: [1, 1], raiseTargets: [], raiseLimit: 0, includeAllIn: false }, TURN_V2_CORPUS[1].streets[1]] }]) {
    assert.throws(() => compileTurnV2({ ...TURN_V2_CORPUS[1], ...patch }));
  }
  assert.throws(() => compileTurnV2(TURN_V2_CORPUS[0], 1024), /estimates/);
  assert.throws(() => compileTurnV2({ ...TURN_V2_CORPUS[0], stackBehind: [1000, 1000], streets: [0, 1].map(() => ({
    openingTargets: [1, 2, 3], raiseTargets: [6, 8, 10], raiseLimit: 1, includeAllIn: true })) }), /limit|exceeds/);
});

test("turn v2 library validation rejects sparse arrays before any arithmetic or compilation", () => {
  const base = TURN_V2_CORPUS[1];
  for (const field of ["board", "rangeText", "stackBehind", "streets"] as const) {
    const sparse = [...base[field]]; delete sparse[0];
    assert.throws(() => validateTurnV2Request({ ...base, [field]: sparse }));
  }
  for (const field of ["openingTargets", "raiseTargets"] as const) {
    const sparse = [1, 2]; delete sparse[0];
    assert.throws(() => validateTurnV2Request({ ...base, streets: [{ ...base.streets[0], [field]: sparse }, base.streets[1]] }));
  }
});
