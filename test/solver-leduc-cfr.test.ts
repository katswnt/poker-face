import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { validateStrategy } from "../src/lib/solver/toy/game";
import { leducGame } from "../src/lib/solver/toy/leduc";

test("the generic CFR and information-set grader run on Leduc without game-specific branches", () => {
  const result = solveCfr(leducGame, {
    iterations: 25,
    checkpointIterations: [1, 25],
  });
  assert.equal(result.gameId, "leduc-v1");
  assert.equal(result.index.informationSets.length, 288);
  assert.equal(result.averageStrategy.size, 288);
  validateStrategy(result.index, result.averageStrategy);

  const grade = gradeStrategy(leducGame, result.averageStrategy, result.index);
  assert.ok(grade.value.every(Number.isFinite));
  assert.ok(Math.abs(grade.value[0] + grade.value[1]) < 1e-12);
  assert.ok(Number.isFinite(grade.nashGap));
  assert.ok(grade.nashGap >= 0);
  assert.equal(grade.bestResponses[0].method, "information-set");
  assert.equal(grade.bestResponses[1].method, "information-set");
  assert.equal(grade.bestResponses[0].informationSetsOptimized, 144);
  assert.equal(grade.bestResponses[1].informationSetsOptimized, 144);
});

test("a short Leduc solve is byte-for-byte reproducible", () => {
  const first = solveCfr(leducGame, { iterations: 5 });
  const second = solveCfr(leducGame, { iterations: 5 });
  assert.deepEqual([...first.averageStrategy], [...second.averageStrategy]);
  assert.deepEqual([...first.cumulativeRegrets], [...second.cumulativeRegrets]);
});
