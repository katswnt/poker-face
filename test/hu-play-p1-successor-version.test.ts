import assert from "node:assert/strict";
import test from "node:test";
import { wideHash } from "../scripts/hu-play-wide-corpus";

test("P3 adds a new P1 source-proof generation without replacing its P2 archive", async () => {
  const records = await import("../scripts/hu-play-p1-successor");
  assert.ok(typeof records.readHistoricalP1Successor === "function", "Historical archive must remain independently readable");
  assert.equal(records.P1_P3_SUCCESSOR_STEM, "tasks/artifacts/hu-play-p1-p3-successor");
  assert.equal(records.P1_SUCCESSOR_STEM, "tasks/artifacts/hu-play-p1-p2-successor");
  const original = records.readHistoricalP1Successor(); assert.equal(original.version, 1);
  assert.match(wideHash(original), /^[a-f0-9]{64}$/);
  assert.throws(() => records.checkP1SuccessorParent({ ...original, version: 2, parentEvidenceHash: "0".repeat(64) }), /parent|historical/i);
  assert.doesNotThrow(() => records.checkP1SuccessorParent({ ...original, version: 2, parentEvidenceHash: wideHash(original) }));
});
