import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { kuhnGame } from "../src/lib/solver/toy/kuhn";

const ITERATIONS = 100_000;

test("deterministic full-tree CFR reaches the locked Kuhn value and exploitability", () => {
  const result = solveCfr(kuhnGame, {
    iterations: ITERATIONS,
    checkpointIterations: [100, 1_000, 10_000, ITERATIONS],
  });
  const grade = gradeStrategy(kuhnGame, result.averageStrategy, result.index);
  assert.ok(Math.abs(grade.value[0] + 1 / 18) <= 0.001, `player 0 value ${grade.value[0]}`);
  assert.ok(grade.exploitability <= 0.001, `exploitability ${grade.exploitability}`);

  const checkpointGrades = result.checkpoints.map(checkpoint => ({
    iteration: checkpoint.iteration,
    grade: gradeStrategy(kuhnGame, checkpoint.averageStrategy, result.index),
  }));
  assert.ok(
    checkpointGrades.at(-1)!.grade.exploitability < checkpointGrades[0].grade.exploitability,
    "a long solve should beat a deliberately short solve",
  );
});

test("CFR is reproducible and independent of target-player traversal order", () => {
  const forward = solveCfr(kuhnGame, { iterations: 2_000, updateOrder: [0, 1] });
  const repeated = solveCfr(kuhnGame, { iterations: 2_000, updateOrder: [0, 1] });
  const reversed = solveCfr(kuhnGame, { iterations: 2_000, updateOrder: [1, 0] });
  assert.deepEqual([...forward.averageStrategy], [...repeated.averageStrategy]);
  assert.deepEqual([...forward.averageStrategy], [...reversed.averageStrategy]);
  assert.deepEqual([...forward.cumulativeRegrets], [...reversed.cumulativeRegrets]);
});

test("CFR rejects invalid iteration and checkpoint settings", () => {
  assert.throws(() => solveCfr(kuhnGame, { iterations: 0 }), /positive safe integer/);
  assert.throws(
    () => solveCfr(kuhnGame, { iterations: 10, checkpointIterations: [11] }),
    /Invalid CFR checkpoint/,
  );
  assert.throws(
    () => solveCfr(kuhnGame, { iterations: 10, updateOrder: [0, 0] }),
    /exactly once/,
  );
});
