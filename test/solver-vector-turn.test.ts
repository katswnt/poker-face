import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPACT_TURN_FIXTURES, POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";
import { compileCompactTurn } from "../src/lib/solver/postflop/compact-turn";
import { createCompactTurnSession } from "../src/lib/solver/postflop/session";
import { compileVectorTurn, preflightVectorTurn } from "../src/lib/solver/postflop/vector/game";
import { createVectorKernelScratch, naiveTerminalValues, vectorTerminalValues } from "../src/lib/solver/postflop/vector/kernels";
import { createVectorTurnSession, restoreVectorTurnSession, type VectorCheckpoint } from "../src/lib/solver/postflop/vector/session";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { buildGameTreeIndex, uniformStrategy, type BehavioralStrategy } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { createTurnGame, type TurnAction, type TurnRequest } from "../src/lib/solver/turn/game";

const close = (a: number, b: number, tolerance = 1e-9) => {
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
  assert.ok(Math.abs(a - b) <= tolerance, `${a} versus ${b}; difference ${Math.abs(a - b)} exceeds ${tolerance}`);
};
const policies = (a: BehavioralStrategy<TurnAction>, b: BehavioralStrategy<TurnAction>) => {
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [key, row] of a) {
    assert.deepEqual(row.actions, b.get(key)!.actions);
    row.probabilities.forEach((p, i) => close(p, b.get(key)!.probabilities[i]));
  }
};
const compareGrades = (a: ReturnType<typeof gradeVectorTurn>, b: ReturnType<typeof gradeStrategy>, scale = 200) => {
  for (const p of [0, 1] as const) {
    close(a.value[p], b.value[p], 1e-10 * scale);
    close(a.bestResponses[p].value, b.bestResponses[p].value, 1e-10 * scale);
    close(a.gains[p], b.gains[p], 1e-10 * scale);
  }
  close(a.exploitability, b.exploitability, 1e-10 * scale);
};
let seed = 912345;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };

for (const request of [...COMPACT_TURN_FIXTURES, POSTFLOP_M2_PROBE]) {
  test(`vector rank/blocker kernels equal explicit pairs: ${request.id}`, () => {
    const game = compileVectorTurn(request);
    for (const p of [0, 1] as const) {
      const own = game.ranges.players[p], other = game.ranges.players[1 - p];
      const out = new Float64Array(own.hands.length), expected = new Float64Array(out.length);
      const scratch = createVectorKernelScratch(other.hands.length);
      for (let sample = 0; sample < 3; sample++) {
        const weights = Float64Array.from(other.weights, (w, i) => sample === 0 ? 0 : sample === 1 ? w : i % 3 === 0 ? 1e-12 : w * random());
        for (let river = -1; river < 48; river++) for (const sign of river < 0 ? [-1, 1] : [-1, 0, 1]) {
          vectorTerminalValues(game.ranges, p, river, weights, 200, sign, out, scratch);
          naiveTerminalValues(game.ranges, p, river, weights, 200, sign, expected);
          out.forEach((v, i) => close(v, expected[i], 1e-10 * 200 * game.rootNormalizer));
        }
      }
    }
    let count = 0, normalizer = 0;
    for (const [i, a] of game.ranges.players[0].hands.entries()) for (const [j, b] of game.ranges.players[1].hands.entries()) {
      if (a.some(card => b.includes(card))) continue;
      count++; normalizer += game.ranges.players[0].weights[i] * game.ranges.players[1].weights[j];
    }
    assert.equal(count, game.preflight.compatibleDeals); close(normalizer, game.rootNormalizer, 1e-12 * Math.max(1, normalizer));
  });
}

for (const request of COMPACT_TURN_FIXTURES) {
  test(`vector public information index equals readable/M1: ${request.id}`, () => {
    const game = compileVectorTurn(request), source = createTurnGame(request);
    assert.deepEqual(game.index, buildGameTreeIndex(source));
    assert.deepEqual(game.publicStates, compileCompactTurn(request).publicStates);
    assert.equal(game.ranges.rivers.length, 48);
  });
  test(`independent vector and naive grades equal readable on mixed policies: ${request.id}`, () => {
    const game = compileVectorTurn(request), source = createTurnGame(request);
    for (let sample = 0; sample < 4; sample++) {
      const policy = new Map(game.index.informationSets.map(info => {
        const p = sample === 0 ? 0.5 : sample === 1 ? Number(random() > 0.5) : random();
        return [info.key, { actions: info.actions, probabilities: [p, 1 - p] }];
      }));
      const expected = gradeStrategy(source, policy);
      compareGrades(gradeVectorTurn(game, policy), expected);
      compareGrades(gradeVectorTurn(game, policy, "naive"), expected);
    }
  });
  for (const algorithm of ["vanilla", "cfr-plus"] as const) for (const delay of algorithm === "vanilla" ? [0] : [0, 20]) {
    test(`vector ${algorithm}, delay ${delay}, follows M1 at 1/2/10/100: ${request.id}`, () => {
      const game = compileVectorTurn(request), reference = compileCompactTurn(request);
      const options = { iterations: 100, algorithm, averagingDelay: delay };
      const actual = createVectorTurnSession(game, options), expected = createCompactTurnSession(reference, options);
      for (const count of [1, 1, 8, 90]) {
        actual.advance(count); expected.advance(count);
        const a = actual.snapshot(), b = expected.snapshot();
        policies(a.currentStrategy, b.currentStrategy); policies(a.averageStrategy, b.averageStrategy);
        for (const [key, row] of a.cumulativeRegrets) row.forEach((value, i) =>
          close(value, b.cumulativeRegrets.get(key)![i], 1e-9 * Math.max(1, actual.iterations * (request.committedPerPlayer + Math.min(...request.stackBehind)))));
      }
      compareGrades(gradeVectorTurn(game, actual.snapshot().averageStrategy), gradeStrategy(reference.source, actual.snapshot().averageStrategy));
    });
  }
}

for (const algorithm of ["vanilla", "cfr-plus"] as const) {
  test(`${algorithm} regrets and averaging sums agree with explicit-pair kernels at 1/2/10/100`, () => {
    const game = compileVectorTurn(COMPACT_TURN_FIXTURES[1]);
    const options = { iterations: 100, algorithm, averagingDelay: algorithm === "vanilla" ? 0 : 20 };
    const vector = createVectorTurnSession(game, options), naive = createVectorTurnSession(game, { ...options, kernel: "naive" });
    for (const count of [1, 1, 8, 90]) {
      vector.advance(count); naive.advance(count);
      const a = vector.snapshot(), b = naive.snapshot();
      policies(a.currentStrategy, b.currentStrategy); policies(a.averageStrategy, b.averageStrategy);
      for (const field of ["strategySums", "cumulativeRegrets"] as const) for (const [key, row] of a[field]) {
        row.forEach((value, i) => close(value, b[field].get(key)![i], 1e-9 * Math.max(1, vector.iterations * 200)));
      }
    }
  });
  test(`${algorithm} is bit-identical through chunking and JSON checkpoint restore`, () => {
    const game = compileVectorTurn(COMPACT_TURN_FIXTURES[0]);
    const options = { iterations: 100, algorithm, averagingDelay: algorithm === "vanilla" ? 0 : 20 };
    const single = createVectorTurnSession(game, options), chunks = createVectorTurnSession(game, options);
    single.advance(100); chunks.advance(17);
    const saved = JSON.parse(JSON.stringify(chunks.checkpoint()));
    const restored = restoreVectorTurnSession(game, saved);
    (chunks.snapshot().averageStrategy as Map<string, unknown>).clear();
    chunks.advance(83); restored.advance(8); restored.snapshot(); restored.advance(75);
    assert.deepEqual(restored.checkpoint(), single.checkpoint()); assert.deepEqual(chunks.checkpoint(), single.checkpoint());
    policies(restored.snapshot().averageStrategy, single.snapshot().averageStrategy);
    saved.regrets[0] = 123; assert.deepEqual(restored.checkpoint(), single.checkpoint());
    assert.equal(restored.advance(1), 100); assert.throws(() => restored.advance(0));
  });
}

test("vector limits, numeric conditioning, malformed policies and corrupt checkpoints fail closed", () => {
  const game = compileVectorTurn(COMPACT_TURN_FIXTURES[0]);
  const session = createVectorTurnSession(game, { iterations: 100, algorithm: "cfr-plus", averagingDelay: 20 });
  session.advance(10);
  const change = (fn: (c: VectorCheckpoint) => void) => { const c = structuredClone(session.checkpoint()); fn(c); assert.throws(() => restoreVectorTurnSession(game, c)); };
  for (const field of ["regrets", "strategySums"] as const) {
    change(c => { (c[field] as number[]).pop(); }); change(c => { (c[field] as number[])[0] = NaN; });
    change(c => { (c[field] as number[])[0] = -1; }); change(c => { (c[field] as number[])[0] = 1e20; });
  }
  assert.throws(() => restoreVectorTurnSession(compileVectorTurn({ ...COMPACT_TURN_FIXTURES[0], betSizes: [51, 100] }), session.checkpoint()));
  assert.throws(() => preflightVectorTurn(COMPACT_TURN_FIXTURES[0], 1));
  assert.throws(() => compileVectorTurn({ ...POSTFLOP_M2_PROBE, rangeText: [POSTFLOP_M2_PROBE.rangeText[0] + " AsAh", POSTFLOP_M2_PROBE.rangeText[1]] }));
  assert.throws(() => compileVectorTurn({ ...COMPACT_TURN_FIXTURES[0], rangeText: ["AsQs:1e-13 KdKh", "9h9d"] }), /relative weights/);
  const policy = new Map(uniformStrategy(game.index)); policy.set("future-card-cheat", policy.values().next().value!);
  assert.throws(() => gradeVectorTurn(game, policy)); policy.delete("future-card-cheat");
  const first = policy.keys().next().value!; policy.set(first, { ...policy.get(first)!, probabilities: [NaN, NaN] });
  assert.throws(() => gradeVectorTurn(game, policy));
});

test("root-unsupported hands and identical cross-range combinations never become legal deals", () => {
  const request: TurnRequest = { ...COMPACT_TURN_FIXTURES[0], rangeText: ["AsQs KdKh", "AsQs"] };
  const game = compileVectorTurn(request);
  assert.equal(game.preflight.compatibleDeals, 1);
  assert.deepEqual(game.index, buildGameTreeIndex(createTurnGame(request)));
  compareGrades(gradeVectorTurn(game, uniformStrategy(game.index)), gradeStrategy(createTurnGame(request), uniformStrategy(game.index)));
});

test("the wide target is represented without allocating equivalent repeated states", () => {
  const game = compileVectorTurn(POSTFLOP_M2_PROBE);
  assert.equal(game.preflight.compatibleDeals, 3773);
  assert.equal(game.preflight.publicStates, 1305);
  assert.equal(game.preflight.totalStates, 1 + 3773 * 1197);
  assert.ok(game.typedStorageBytes < 5 * 1024 * 1024);
  const grade = gradeVectorTurn(game, uniformStrategy(game.index));
  assert.ok(grade.workingStorageBytes < 1024 * 1024);
});

test("tiny surviving root mass stays accurate instead of inheriting cancellation error", () => {
  const request: TurnRequest = { ...COMPACT_TURN_FIXTURES[0], rangeText: ["AsQs AdQd:1e-12", "AsAd AsQs:1e-12"] };
  const game = compileVectorTurn(request), source = createTurnGame(request);
  assert.equal(game.preflight.compatibleDeals, 1);
  assert.equal(game.rootNormalizer, 1e-24);
  const actual = createVectorTurnSession(game, { iterations: 100 }), expected = createCompactTurnSession(compileCompactTurn(request), { iterations: 100 });
  actual.advance(100); expected.advance(100);
  policies(actual.snapshot().averageStrategy, expected.snapshot().averageStrategy);
  compareGrades(gradeVectorTurn(game, actual.snapshot().averageStrategy), gradeStrategy(source, actual.snapshot().averageStrategy));
  const scratch = createVectorKernelScratch(2), out = new Float64Array(2);
  vectorTerminalValues(game.ranges, 0, -1, game.ranges.players[1].weights, 1, 1, out, scratch);
  assert.ok(scratch.fallbackQueries > 0);
});

test("the legal vector response cannot take an opponent-card or future-card peeking advantage", () => {
  const request: TurnRequest = { ...COMPACT_TURN_FIXTURES[0], stackBehind: [50, 50] };
  const game = compileVectorTurn(request), source = createTurnGame(request);
  const profile = new Map(uniformStrategy(game.index));
  for (const info of game.index.informationSets) if (info.player === 0) {
    profile.set(info.key, { actions: info.actions, probabilities: info.actions[0] === "check" ? [0, 1] : [0.5, 0.5] });
  }
  const normal = gradeVectorTurn(game, profile);
  // Against forced opening shove, enumerate the responder's four turn fold/call
  // policies independently. River/other branches have zero opponent reach.
  const responseKeys = game.index.informationSets.filter(info => info.player === 1 && info.key.endsWith("turn=bet:river-actions=start")).map(info => info.key);
  assert.equal(responseKeys.length, 2);
  let exhaustive = -Infinity;
  for (let bits = 0; bits < 4; bits++) {
    const pure = new Map(profile);
    responseKeys.forEach((key, i) => pure.set(key, { actions: ["fold", "call"], probabilities: bits & (1 << i) ? [0, 1] : [1, 0] }));
    exhaustive = Math.max(exhaustive, gradeStrategy(source, pure).value[1]);
  }
  close(normal.bestResponses[1].value, exhaustive, 2e-8);
  let futureCheat = 0, privateCheat = 0;
  for (const deal of source.deals) {
    const start = source.nextChance(source.initialState(), deal.outcome);
    const bet = source.nextAction(start, "bet"), fold = source.node(source.nextAction(bet, "fold"));
    const called = source.nextAction(bet, "call"), rivers = source.node(called);
    assert.equal(fold.kind, "terminal"); assert.equal(rivers.kind, "chance");
    if (fold.kind !== "terminal" || rivers.kind !== "chance") throw new Error("Expected all-in reduction");
    let callValue = 0;
    for (const outcome of rivers.outcomes) {
      const ending = source.node(source.nextChance(called, outcome.outcome));
      if (ending.kind !== "terminal") throw new Error("Expected showdown");
      callValue += outcome.probability * ending.utility[1];
      futureCheat += deal.probability * outcome.probability * Math.max(fold.utility[1], ending.utility[1]);
    }
    privateCheat += deal.probability * Math.max(fold.utility[1], callValue);
  }
  assert.ok(futureCheat > normal.bestResponses[1].value + 5);
  assert.ok(privateCheat > normal.bestResponses[1].value + 1);
});

test("seeded asymmetric stack/weight games and suit/weight relabelings preserve numerical meaning", () => {
  for (let i = 1; i <= 8; i++) {
    const request: TurnRequest = { ...COMPACT_TURN_FIXTURES[0], committedPerPlayer: i,
      stackBehind: [i % 5, i * 2], betSizes: [i + 1, i * 3], rangeText: [`AsQs:${i / 13} KdKh`, `QsJs 9h9d:${i / 7}`] };
    const game = compileVectorTurn(request), source = createTurnGame(request);
    const session = createVectorTurnSession(game, { iterations: 10 }); session.advance(10);
    const reference = createCompactTurnSession(compileCompactTurn(request), { iterations: 10 }); reference.advance(10);
    policies(session.snapshot().averageStrategy, reference.snapshot().averageStrategy);
    compareGrades(gradeVectorTurn(game, session.snapshot().averageStrategy), gradeStrategy(source, session.snapshot().averageStrategy));
  }
  const request = COMPACT_TURN_FIXTURES[0], base = compileVectorTurn(request);
  const swapped = (text: string) => text.replace(/[cdhs]/g, suit => ({ c: "s", s: "c", d: "h", h: "d" })[suit]!);
  const other = compileVectorTurn({ ...request, board: request.board.map(card => swapped(card)) as unknown as TurnRequest["board"],
    rangeText: [swapped(request.rangeText[0]), swapped(request.rangeText[1])] });
  const a = gradeVectorTurn(base, uniformStrategy(base.index)), b = gradeVectorTurn(other, uniformStrategy(other.index));
  a.value.forEach((value, p) => close(value, b.value[p])); a.gains.forEach((gain, p) => close(gain, b.gains[p]));
  const rescaled = compileVectorTurn({ ...request, rangeText: ["KdKh:2 AsQs", "9h9d:6 QsJs:3"] });
  const x = createVectorTurnSession(base, { iterations: 100 }), y = createVectorTurnSession(rescaled, { iterations: 100 });
  x.advance(100); y.advance(100); policies(x.snapshot().averageStrategy, y.snapshot().averageStrategy);
});
