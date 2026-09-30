import assert from "node:assert/strict";
import test from "node:test";
import { buildRiverStudyFixture, buildTurnStudyFixture, type GadgetStudyFixture } from "../scripts/gadget-study-fixtures";
import { gradeSubgameResponse } from "../src/lib/solver/river/resolving";
import { validateStrategy } from "../src/lib/solver/toy/game";

test("frozen expanded river and turn games have one added opponent action and no fabricated posterior", () => {
  const check = <S, C>(f: GadgetStudyFixture<S, C>) => {
    validateStrategy(f.problem.index, f.problem.blueprint);
    assert.ok(f.problem.roots.length > 0);
    assert.ok(f.problem.roots.every(r => r.counterfactualWeight > 0));
    assert.ok(f.problem.roots.some(r => r.modeledWeight > 0));
    for (const r of f.parent.roots) {
      const key = f.game.informationSet(r.state, 1), entry = f.problem.blueprint.get(key)!;
      assert.equal(entry.probabilities[entry.actions.indexOf(f.newAction)], 0);
    }
    const grade = gradeSubgameResponse(f.problem, f.problem.blueprint);
    assert.ok(grade.every(g => Math.abs(g.gain) < 1e-9));
    assert.equal(f.inputFiles.length, 1); assert.equal(f.inputFiles[0].sha256.length, 64);
    assert.ok(f.problem.index.totalStates <= 100_000);
    // Only the new branch is translated; every old AI information set is unchanged.
    for (const i of f.problem.index.informationSets) if (i.player === 0 && f.saved.has(i.key)) {
      assert.deepEqual(f.problem.blueprint.get(i.key), f.saved.get(i.key));
    }
  };
  const river = buildRiverStudyFixture(), turn = buildTurnStudyFixture();
  check(river); check(turn);
  assert.equal(river.lowerWeight, .4);
  assert.ok(Math.abs(turn.lowerWeight - 11 / 36) < 1e-15);
});

test("translation weights and compatible counterfactual roots independently reproduce by hand", () => {
  const check = <S, C>(f: GadgetStudyFixture<S, C>) => {
    const { lower, upper, actual, pot } = f.sizes;
    const lowerWeight = (upper - actual) * (pot + lower) / ((upper - lower) * (pot + actual));
    assert.ok(Math.abs(lowerWeight - f.lowerWeight) < 1e-15);
    for (const root of f.problem.roots) {
      const neighbors = f.neighborEntries(root.state), key = f.game.informationSet(root.state, 0);
      const entry = f.problem.blueprint.get(key)!;
      for (const [i, action] of entry.actions.entries()) {
        const read = (side: number) => {
          const ix = neighbors[side].actions.indexOf(action);
          return ix < 0 ? 0 : neighbors[side].probabilities[ix];
        };
        assert.ok(Math.abs(entry.probabilities[i] - (lowerWeight * read(0) + (1 - lowerWeight) * read(1))) < 1e-12);
      }
    }
  };
  check(buildRiverStudyFixture()); check(buildTurnStudyFixture());
});
