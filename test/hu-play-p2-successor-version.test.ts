import assert from "node:assert/strict";
import test from "node:test";
import { wideHash } from "../scripts/hu-play-wide-corpus";

test("P3 P2 evidence is a separately versioned successor bound to the untouched river corpus", async () => {
  const records = await import("../scripts/audit-hu-play-p2");
  assert.ok(typeof records.readHistoricalP2Evidence === "function", "Keep the original river evidence independently readable");
  assert.equal(records.P2_P3_SUCCESSOR_STEM, "tasks/artifacts/hu-play-p2-p3-successor");
  assert.equal(records.P2_EVIDENCE_STEM, "tasks/artifacts/hu-play-p2-river");
  const historical = records.readHistoricalP2Evidence(); assert.equal(historical.version, 1);
  assert.throws(() => records.checkP2SuccessorParent({ ...historical, version: 2, parentEvidenceHash: "0".repeat(64) }), /parent|historical/i);
  const current = { ...historical, version: 2 as const, parentEvidenceHash: wideHash(historical) };
  assert.doesNotThrow(() => records.checkP2SuccessorParent(current));
  const first = current.inputs.cases[0];
  const changed = { ...current, inputs: { ...current.inputs, cases: [
    { ...first, spot: { ...first.spot, startingPot: first.spot.startingPot + 1 } }, ...current.inputs.cases.slice(1)] } };
  assert.throws(() => records.checkP2SuccessorParent(changed), /frozen|historical|hash/i);
});
