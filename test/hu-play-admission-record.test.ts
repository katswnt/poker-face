import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import record from "../tasks/artifacts/hu-play-p1-admission.json";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { LIVE_LIMITS } from "../src/lib/solver/bridge/live/admission";

const hash = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
test("frozen P1 diagnostic is hash-bound and cannot be read as a passing play gate", () => {
  const { payloadHash, ...payload } = record;
  assert.equal(hash(payload), payloadHash);
  assert.equal(record.decision.status, "blocked-before-solving");
  assert.equal(record.decision.nativeFullPrunedComparison, null);
  assert.equal(record.decision.independentFullRangeExploitability, null);
  assert.equal(record.decision.productionHandsTested, 0);
  assert.equal(record.limits.maxHandsPerPlayer, LIVE_LIMITS.rangeHands);
  assert.equal(record.limits.minimumRetainedMass, .99);
  assert.equal(record.limits.medianLocalExploitabilityPctPotGate, 1);
  assert.equal(record.cohort.hands, 4096);
  assert.equal(record.cohort.completedUsingSavedPoliciesOnly + record.cohort.stoppedUnavailable, 4096);
  assert.equal(record.corpus.length, 64);
  for (const street of ["turn", "river"]) assert.equal(record.corpus.filter(r => r.street === street).length, 32);
  for (const row of record.corpus) {
    assert.equal(row.capacity.every(c => c.possible), false);
    for (const p of row.capacity) assert.equal(p.possible, p.retainedMass >= .99);
    assert.ok(row.spotHash.length === 64);
  }
  assert.equal(record.cohort.byStreet.every(s => s.bothRangesFit99Within64 === 0), true);
});

test("the frozen corpus identifies the exact published inputs it measured", () => {
  assert.equal(record.inputFilesHash, hash(record.inputFiles));
  for (const ref of record.inputFiles) {
    const bytes = readFileSync(`public${ref.url}`);
    assert.equal(bytes.length, ref.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.sha256);
  }
  const mutated = { ...record, limits: { ...record.limits, minimumRetainedMass: .5 } };
  const { payloadHash, ...payload } = mutated;
  assert.notEqual(hash(payload), payloadHash, "lowering retention invalidates the record");
});
