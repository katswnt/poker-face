import assert from "node:assert/strict";
import test from "node:test";
import { buildRiverStudyFixture, buildTurnStudyFixture } from "../scripts/gadget-study-fixtures";
import { runGadgetStudyFixture, P4_SAFETY_TARGET } from "../scripts/audit-gadget-study";

test("both frozen whole-game studies meet the unchanged per-hand and full-game gadget bars", () => {
  for (const report of [runGadgetStudyFixture(buildRiverStudyFixture()), runGadgetStudyFixture(buildTurnStudyFixture())]) {
    assert.equal(report.rows.length, 5);
    for (const row of report.rows) {
      assert.equal(row.policyHash.length, 64);
      assert.ok(Math.abs(row.grade.value[0] + row.grade.value[1]) < 1e-9);
      assert.ok(Math.abs(row.grade.exploitability - (row.grade.gains[0] + row.grade.gains[1]) / 2) < 1e-9);
      if (row.mode === "resolve" || row.mode === "max-margin") {
        assert.equal(row.accepted, true);
        assert.ok(row.maximumGain <= P4_SAFETY_TARGET);
        assert.ok(row.opponentWholeGameGain <= P4_SAFETY_TARGET);
        assert.ok(row.constraints.every(c => c.gain <= P4_SAFETY_TARGET));
        assert.equal(row.attempts.at(-1)!.iterations, row.iterations);
        for (const earlier of row.attempts.slice(0, -1)) assert.ok(
          earlier.maximumGain > P4_SAFETY_TARGET || earlier.opponentWholeGameGain > P4_SAFETY_TARGET,
          "Every skipped checkpoint records the failed gate; do not hide an earlier passing result");
      }
    }
  }
});
