import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGameTreeIndex, type BehavioralStrategy } from "../src/lib/solver/toy/game";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { compileCompactGame, solveCompiledCompactCfr } from "../src/lib/solver/river/compact/cfr";
import { createTurnGame, type TurnRequest, type TurnState } from "../src/lib/solver/turn/game";
import { compileCompactTurn, compactTurnInformationSet, compactTurnNodeIsLive, compactTurnUtility0,
  preflightCompactTurn, TURN_CHANCE, TURN_PLAYER, TURN_TERMINAL } from "../src/lib/solver/postflop/compact-turn";
import { createCompactTurnSession, type CompactTurnOptions } from "../src/lib/solver/postflop/session";
import { COMPACT_TURN_FIXTURES, POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";

function near(a: number, b: number, tolerance = 1e-9) {
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
  assert.ok(Math.abs(a - b) <= tolerance, `${a} versus ${b} (tolerance ${tolerance})`);
}
function policies(a: BehavioralStrategy<string>, b: BehavioralStrategy<string>) {
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [key, entry] of a) {
    assert.deepEqual(entry.actions, b.get(key)!.actions);
    entry.probabilities.forEach((p, i) => near(p, b.get(key)!.probabilities[i]));
  }
}

for (const request of COMPACT_TURN_FIXTURES) {
  test(`shared turn compiles every physical state faithfully: ${request.id}`, () => {
    const compact = compileCompactTurn(request), source = compact.source;
    assert.deepEqual(compact.index, buildGameTreeIndex(source));
    assert.equal(compact.riverCards.length, 48);
    let visited = 1;
    source.deals.forEach((deal, d) => {
      assert.equal([...compact.dealRiverSigns.subarray(d * 48, (d + 1) * 48)].filter(sign => sign !== 2).length, 44);
      const visit = (state: TurnState, n: number) => {
        visited++;
        assert.ok(compactTurnNodeIsLive(compact, d, n));
        assert.deepEqual({ ...state, hands: null }, compact.publicStates[n]);
        const node = source.node(state), start = compact.nodeEdgeStarts[n];
        if (node.kind === "terminal") {
          assert.equal(compact.nodeKinds[n], TURN_TERMINAL);
          near(compactTurnUtility0(compact, d, n), node.utility[0], 0);
        } else if (node.kind === "chance") {
          assert.equal(compact.nodeKinds[n], TURN_CHANCE);
          assert.equal(node.outcomes.length, 44);
          let mass = 0;
          for (const { outcome, probability } of node.outcomes) {
            const childState = source.nextChance(state, outcome);
            const river = compact.riverCards.indexOf(childState.river!);
            near(probability, 1 / 44, 0); mass += probability;
            visit(childState, compact.edgeChildren[start + river]);
          }
          near(mass, 1, 1e-14);
        } else {
          assert.equal(compact.nodeKinds[n], TURN_PLAYER);
          const info = compact.index.informationSets[compactTurnInformationSet(compact, d, n)];
          assert.equal(info.key, source.informationSet(state, node.player));
          assert.deepEqual(compact.actions[n], node.actions);
          for (const [i, action] of node.actions.entries()) visit(source.nextAction(state, action), compact.edgeChildren[start + i]);
        }
      };
      visit(source.nextChance(source.initialState(), deal.outcome), 0);
    });
    assert.equal(visited, compact.index.totalStates);
  });

  for (const algorithm of ["vanilla", "cfr-plus"] as const) {
    for (const delay of algorithm === "vanilla" ? [0] : [0, 20]) {
      test(`shared turn ${algorithm}, delay ${delay}, matches reference: ${request.id}`, () => {
        const game = compileCompactTurn(request), repeated = compileCompactGame(game.source);
        for (const iterations of [1, 2, 10, 100]) {
          const options = { iterations, algorithm, averagingDelay: delay, checkpointIterations: [1, ...(iterations > 1 ? [iterations] : [])] };
          const session = createCompactTurnSession(game, options);
          session.advance(iterations);
          const actual = session.snapshot(), expected = solveCompiledCompactCfr(repeated, options);
          policies(actual.averageStrategy, expected.averageStrategy);
          policies(actual.currentStrategy, expected.currentStrategy);
          const scale = request.committedPerPlayer + Math.min(...request.stackBehind);
          for (const [key, regrets] of actual.cumulativeRegrets) regrets.forEach((r, i) =>
            near(r, expected.cumulativeRegrets.get(key)![i], 1e-9 * Math.max(1, iterations * scale)));
          actual.checkpoints.forEach((checkpoint, i) => policies(checkpoint.averageStrategy, expected.checkpoints[i].averageStrategy));
          if (algorithm === "vanilla") policies(actual.averageStrategy, solveCfr(game.source, options).averageStrategy);
          if (iterations === 100) {
            const a = gradeStrategy(game.source, actual.averageStrategy, game.index);
            const b = gradeStrategy(game.source, expected.averageStrategy, repeated.index);
            near(a.exploitability, b.exploitability, 1e-10 * Math.max(1, scale));
            a.value.forEach((value, i) => near(value, b.value[i], 1e-10 * Math.max(1, scale)));
            a.gains.forEach((value, i) => near(value, b.gains[i], 1e-10 * Math.max(1, scale)));
          }
        }
      });
    }
  }
}

test("shared public rivers are not chosen from the first private pair; turn keys conceal future cards", () => {
  const game = compileCompactTurn(COMPACT_TURN_FIXTURES[0]);
  assert.ok(game.riverCards.some((_, r) => game.dealRiverSigns[r] === 2
    && game.source.deals.some((_, d) => game.dealRiverSigns[d * 48 + r] !== 2)));
  for (const definition of game.index.informationSets) {
    if (definition.key.includes("street=0:")) assert.ok(definition.key.includes("river=hidden:"));
  }
  const sharedRoot = new Map<string, number>();
  game.source.deals.forEach((deal, d) => {
    const key = deal.outcome.hands[0].join("");
    const info = compactTurnInformationSet(game, d, 0);
    if (sharedRoot.has(key)) assert.equal(info, sharedRoot.get(key));
    sharedRoot.set(key, info);
  });
});

for (const algorithm of ["vanilla", "cfr-plus"] as const) {
  test(`${algorithm} chunking, snapshots and interleaved sessions are bit-identical`, () => {
    const game = compileCompactTurn(COMPACT_TURN_FIXTURES[0]);
    const options = { iterations: 100, algorithm, averagingDelay: algorithm === "vanilla" ? 0 : 20, checkpointIterations: [1, 10, 50, 100] };
    const single = createCompactTurnSession(game, options), chunked = createCompactTurnSession(game, options);
    const unrelated = createCompactTurnSession(game, { iterations: 30 });
    assert.equal(chunked.snapshot().iterations, 0);
    single.advance(100);
    for (const chunk of [1, 9, 7, 33, 50]) {
      chunked.advance(chunk); unrelated.advance(3);
      const snapshot = chunked.snapshot();
      (snapshot.averageStrategy as Map<string, unknown>).clear();
      (snapshot.currentStrategy.values().next().value!.probabilities as number[])[0] = 123;
      (snapshot.cumulativeRegrets.values().next().value as number[])[0] = 123;
      for (const checkpoint of snapshot.checkpoints) (checkpoint.averageStrategy as Map<string, unknown>).clear();
    }
    assert.deepEqual(chunked.snapshot(), single.snapshot());
    assert.equal(chunked.advance(1), 100);
    assert.equal(chunked.done, true);
    assert.equal(chunked.snapshot().regretPasses, algorithm === "vanilla" ? 100 : 200);
    assert.throws(() => chunked.advance(0));
  });
}

test("compact turn validates options, retains v1 caps and meets structural storage gate", () => {
  const game = compileCompactTurn(COMPACT_TURN_FIXTURES[1]);
  assert.ok(game.typedStorageBytes <= compileCompactGame(game.source).storageBytes / 2);
  assert.throws(() => compileCompactTurn(POSTFLOP_M2_PROBE));
  assert.throws(() => preflightCompactTurn(COMPACT_TURN_FIXTURES[0], 1));
  assert.throws(() => preflightCompactTurn(COMPACT_TURN_FIXTURES[0], Number.NaN));
  for (const input of [null, { iterations: 0 }, { iterations: 100001 }, { iterations: 1.5 },
    { iterations: 1, algorithm: "oops" }, { iterations: 1, averagingDelay: 1 },
    { iterations: 2, checkpointIterations: [1, 1] }, { iterations: 2, checkpointIterations: [3] },
    { iterations: 20, checkpointIterations: Array.from({ length: 17 }, (_, i) => i + 1) },
    { iterations: 1, algorithm: "cfr-plus", averagingDelay: Infinity }]) {
    assert.throws(() => createCompactTurnSession(game, input as CompactTurnOptions));
  }
  for (const bad of [NaN, Infinity, -1, 0, 0.5]) assert.throws(() => createCompactTurnSession(game, { iterations: 1 }).advance(bad));
});

test("deterministic generated short/asymmetric games match ordinary CFR", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const request: TurnRequest = { ...COMPACT_TURN_FIXTURES[0], id: `compact-generated-${seed}`,
      committedPerPlayer: seed, stackBehind: [seed % 5, (seed * 7) % 13], betSizes: [seed * 3, seed + 1] };
    const game = compileCompactTurn(request), session = createCompactTurnSession(game, { iterations: 10 });
    session.advance(10);
    policies(session.snapshot().averageStrategy, solveCfr(createTurnGame(request), { iterations: 10 }).averageStrategy);
  }
});

test("failed numeric updates poison the session rather than exposing partial iterations", () => {
  const game = compileCompactTurn(COMPACT_TURN_FIXTURES[0]);
  const session = createCompactTurnSession(game, { iterations: 2 });
  // Deliberate violation of the trusted compiler's read-only array contract.
  game.dealProbabilities[0] = NaN;
  assert.throws(() => session.advance(1), /Non-finite/);
  assert.equal(session.done, false);
  assert.throws(() => session.advance(1), /session failed/);
  assert.throws(() => session.snapshot(), /session failed/);
});

test("independent grader rejects missing, malformed and hidden-card-conditioned policies", () => {
  const game = compileCompactTurn(COMPACT_TURN_FIXTURES[0]);
  const session = createCompactTurnSession(game, { iterations: 1 });
  session.advance(1);
  const policy = new Map(session.snapshot().averageStrategy);
  const key = policy.keys().next().value!;
  const entry = policy.get(key)!;
  policy.set(`${key}:opponent=9h9d`, entry);
  assert.throws(() => gradeStrategy(game.source, policy, game.index));
  policy.delete(`${key}:opponent=9h9d`); policy.delete(key);
  assert.throws(() => gradeStrategy(game.source, policy, game.index));
  policy.set(key, { ...entry, probabilities: [NaN, NaN] });
  assert.throws(() => gradeStrategy(game.source, policy, game.index));
});

test("range reordering and common weight rescaling preserve the strategy", () => {
  const original = COMPACT_TURN_FIXTURES[0];
  const run = (request: TurnRequest) => {
    const game = compileCompactTurn(request), session = createCompactTurnSession(game, { iterations: 100 });
    session.advance(100); return session.snapshot();
  };
  policies(run(original).averageStrategy, run({ ...original, rangeText: ["KdKh:2 AsQs", "9h9d:6 QsJs:3"] }).averageStrategy);
});
