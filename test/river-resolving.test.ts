import assert from "node:assert/strict";
import test from "node:test";
import { buildGameTreeIndex, uniformStrategy } from "../src/lib/solver/toy/game";
import { exhaustiveBestResponse, informationSetBestResponse, gradeStrategy } from "../src/lib/solver/toy/best-response";
import { prepareSubgame, createGadgetGame, gradeSubgameResponse, solveGadgetSubgame } from "../src/lib/solver/river/resolving";
import { coinFixture, correlatedFixture } from "./resolving-helpers";

const options = { iterations: 10_000, averagingDelay: 20 };
test("counterfactual roots exclude opponent action reach, not chance or AI reach", () => {
  const p = prepareSubgame(coinFixture());
  assert.deepEqual(p.roots.map(r => [r.key, r.counterfactualWeight, r.modeledWeight]), [["H", .5, .375], ["T", .5, .25]]);
  assert.deepEqual(p.bounds, [{ key: "H", mass: .5, value: 0 }, { key: "T", mass: .5, value: .5 }]);
});
test("unsafe re-solving loses whole-game protection; Resolve and Max-margin preserve it", () => {
  const f = coinFixture(), p = prepareSubgame(f);
  const old = exhaustiveBestResponse(f.game, f.blueprint, 1).value;
  assert.equal(old, .5);
  const unsafe = solveGadgetSubgame(p, "unsafe", options);
  assert.ok(exhaustiveBestResponse(f.game, unsafe.strategy, 1).value > old + .24);
  for (const mode of ["resolve", "max-margin"] as const) {
    const result = solveGadgetSubgame(p, mode, options);
    assert.ok(result.maximumGain <= .0002, `${mode}: ${result.maximumGain}`);
    const exact = exhaustiveBestResponse(f.game, result.strategy, 1).value;
    assert.ok(exact <= old + .0002);
    assert.ok(Math.abs(exact - informationSetBestResponse(f.game, result.strategy, 1).value) < 1e-9);
    assert.deepEqual(result.strategy.get("opponent-H"), f.blueprint.get("opponent-H"));
    assert.deepEqual(result.strategy.get("opponent-T"), f.blueprint.get("opponent-T"));
  }
});
test("Max-margin matches the analytic 5/8, 3/8 policy and 1/4 conditional margin", () => {
  const result = solveGadgetSubgame(prepareSubgame(coinFixture()), "max-margin", options);
  const [h, t, f] = result.strategy.get("ai-guess")!.probabilities;
  assert.ok(Math.abs(h - .625) < .0002); assert.ok(Math.abs(t - .375) < .0002); assert.ok(f < .0002);
  assert.ok(Math.abs(result.minimumMargin - .25) < .0002);
});
test("zero modeled opponent reach is protected and gadget hand choices are hidden from AI", () => {
  const p = prepareSubgame(coinFixture(0, 0));
  assert.equal(p.bounds.length, 2); assert.equal(p.roots[1].modeledWeight, 0);
  for (const mode of ["resolve", "max-margin"] as const) {
    const game = createGadgetGame(p, mode), index = buildGameTreeIndex(game);
    assert.deepEqual(index.informationSets.filter(i => i.player === 0).map(i => i.key), ["ai-guess"]);
    assert.ok(solveGadgetSubgame(p, mode, options).maximumGain <= .0002);
  }
});
test("seat reversal preserves bounds and solutions; each solve replays exactly", () => {
  const a = solveGadgetSubgame(prepareSubgame(coinFixture()), "max-margin", options);
  const b = solveGadgetSubgame(prepareSubgame(coinFixture(1)), "max-margin", options);
  assert.ok(b.maximumGain <= .0002);
  assert.ok(Math.abs(a.minimumMargin - b.minimumMargin) < .0002);
  assert.deepEqual(a, solveGadgetSubgame(prepareSubgame(coinFixture()), "max-margin", options));
});
test("invalid cuts and zero-total modeled posteriors fail instead of inventing a policy", () => {
  const f = coinFixture();
  assert.throws(() => prepareSubgame({ ...f, cut: s => f.cut(s) && s.coin === "H" }), /split.*information set/i);
  assert.throws(() => prepareSubgame({ ...f, cut: () => false }), /empty|roots/i);
  assert.throws(() => prepareSubgame({ ...f, opponentKey: () => "" }), /key/i);
  const p = prepareSubgame({ ...f, modeledWeight: () => 0 });
  assert.throws(() => solveGadgetSubgame(p, "unsafe", options), /modeled.*mass/i);
  assert.deepEqual(gradeSubgameResponse(p, f.blueprint).map(r => r.gain), [0, 0]);
});

test("blocker-correlated roots use chance times AI reach and conditional Max-margin deals", () => {
  const p = prepareSubgame(correlatedFixture());
  assert.deepEqual(p.roots.map(r => r.counterfactualWeight), [.05, .075, .4]);
  const modeled = [0, .0075, .04];
  p.roots.forEach((r, i) => assert.ok(Math.abs(r.modeledWeight - modeled[i]) < 1e-15));
  const game = createGadgetGame(p, "max-margin"), first = game.node(game.initialState());
  assert.equal(first.kind, "player");
  if (first.kind !== "player") return;
  const y = game.node(game.nextAction(game.initialState(), first.actions[1]));
  assert.equal(y.kind, "chance");
  if (y.kind !== "chance") return;
  assert.equal(y.outcomes.length, 2);
  assert.ok(Math.abs(y.outcomes[0].probability - 3 / 19) < 1e-15);
  assert.ok(Math.abs(y.outcomes[1].probability - 16 / 19) < 1e-15);
  for (const mode of ["resolve", "max-margin"] as const) {
    assert.ok(solveGadgetSubgame(p, mode, options).maximumGain <= .0002);
  }
});

test("positive counterfactual reach may not silently underflow out of the protected hand set", () => {
  assert.throws(() => prepareSubgame(correlatedFixture(Number.MIN_VALUE)), /underflow/i);
});

test("negative probabilities inside a generic grading tolerance are not valid reach factors", () => {
  const f = coinFixture();
  const blueprint = new Map(f.blueprint);
  blueprint.set("opponent-H", { actions: ["sell", "play"], probabilities: [-1e-13, 1 + 1e-13] });
  assert.throws(() => prepareSubgame({ ...f, blueprint }), /probabilit|reach/i);
});

test("a tiny aggregate gadget gap is not a per-hand safety certificate for rare hands", () => {
  const f = coinFixture(), game = { ...f.game, node: (s: Parameters<typeof f.game.node>[0]) => s.phase === "deal"
    ? { kind: "chance" as const, outcomes: [{ outcome: "H", probability: 1 - 1e-12 }, { outcome: "T", probability: 1e-12 }] }
    : f.game.node(s) };
  const p = prepareSubgame({ ...f, game }), bad = new Map(f.blueprint);
  bad.set("ai-guess", { actions: ["H", "T", "forfeit"], probabilities: [1, 0, 0] });
  const constraints = gradeSubgameResponse(p, bad);
  assert.equal(constraints.find(c => c.key === "T")!.gain, .5);
  const gadget = createGadgetGame(p, "resolve"), ix = buildGameTreeIndex(gadget), profile = new Map(uniformStrategy(ix));
  profile.set("ai-guess", bad.get("ai-guess")!);
  for (const i of ix.informationSets.filter(i => i.player === 1)) {
    profile.set(i.key, { actions: i.actions, probabilities: i.key.endsWith("/H") ? [1, 0] : [0, 1] });
  }
  assert.ok(gradeStrategy(gadget, profile, ix).nashGap < 1e-10);
});
