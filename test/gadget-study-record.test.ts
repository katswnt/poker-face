import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import record from "../tasks/artifacts/hu-play-p4-gadget-study.json";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { buildRiverStudyFixture, buildTurnStudyFixture, type GadgetStudyFixture } from "../scripts/gadget-study-fixtures";
import { gradeSubgameResponse } from "../src/lib/solver/river/resolving";

const hash = (x: unknown) => createHash("sha256").update(canonicalSolverJson(x)).digest("hex");
test("P4 report hashes exact source artifacts and policy replacements, not just displayed numbers", () => {
  const { payloadHash, ...payload } = record;
  assert.equal(hash(payload), payloadHash);
  assert.equal(record.safetyTargetChips, .0002);
  assert.deepEqual(record.checkpoints, [1000, 10000, 100000, 200000]);
  for (const f of record.fixtures) for (const ref of f.inputFiles) {
    const bytes = readFileSync(ref.path); assert.equal(bytes.length, ref.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.sha256);
  }
  assert.notEqual(hash({ ...payload, safetyTargetChips: 1 }), payloadHash);
});

test("saved policy replacements independently re-grade in the original chip-paying full games", () => {
  const verify = <S, C>(f: GadgetStudyFixture<S, C>) => {
    const rows = record.fixtures.find(row => row.name === f.name)!.rows;
    for (const row of rows) {
      const profile = new Map(f.problem.blueprint);
      for (const [key, values] of Object.entries(row.replacement)) {
        const entry = profile.get(key)!;
        profile.set(key, { actions: entry.actions, probabilities: entry.actions.map(a => values[a as keyof typeof values]!) });
      }
      assert.equal(hash(serializeBehavioralStrategy(profile)), row.policyHash);
      const grade = gradeStrategy(f.game, profile, f.problem.index);
      assert.ok(Math.abs(grade.exploitability - row.grade.exploitability) < 1e-9);
      for (const p of [0, 1]) {
        assert.ok(Math.abs(grade.value[p] - row.grade.value[p]) < 1e-9);
        assert.ok(Math.abs(grade.bestResponses[p].value - row.grade.bestResponseValues[p]) < 1e-9);
      }
      const constraints = gradeSubgameResponse(f.problem, profile);
      assert.equal(constraints.length, row.constraints.length);
      constraints.forEach((c, i) => assert.ok(Math.abs(c.gain - row.constraints[i].gain) < 1e-9));
    }
  };
  verify(buildRiverStudyFixture()); verify(buildTurnStudyFixture());
});
