import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { wideHash } from "../scripts/hu-play-wide-corpus";

test("checked-in production P1 observations recompute all unchanged gates and reject altered evidence", async () => {
  assert.ok(existsSync("scripts/audit-hu-play-p1.ts"), "P1 needs a reproducible production-gate record");
  const { checkP1Reports } = await import("../scripts/audit-hu-play-p1");
  const reports = ["hands", "corpus", "browser"].map(n => JSON.parse(readFileSync(`tasks/artifacts/hu-play-p1-production-${n}.json`, "utf8")));
  const summary = checkP1Reports(reports[0], reports[1], reports[2]);
  assert.equal(summary.hands, 1000); assert.equal(summary.roots, 64); assert.ok(summary.productionRiverGrades >= 20);
  assert.equal(summary.minimumRetainedReachMass, 1); assert.equal(summary.maxPerHandEvDifferenceChips, 0);
  assert.ok(summary.medianIndependentPctPot <= 1);
  for (const index of [0, 1, 2]) {
    const changed = structuredClone(reports); changed[index].payloadHash = "0".repeat(64);
    assert.throws(() => checkP1Reports(changed[0], changed[1], changed[2]), /hash/i);
  }
  // Re-hashing a failed gate must not make it acceptable evidence.
  for (const [index, alter] of [
    [0, (r: typeof reports[number]) => { r.hands[99].ledger.finalStacks[0]++; }],
    [1, (r: typeof reports[number]) => { r.rows[0].retainedReachMass[0] = .99; }],
    [2, (r: typeof reports[number]) => { r.rows[0].exactNativeParity = false; }],
  ] as const) {
    const changed = structuredClone(reports); alter(changed[index]);
    const { payloadHash, ...payload } = changed[index]; void payloadHash;
    changed[index].payloadHash = wideHash(payload);
    assert.throws(() => checkP1Reports(changed[0], changed[1], changed[2]));
  }
});
