import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { auditSavedPreflight, auditSavedCalibration, buildTinyReference } from "../scripts/audit-preflop-v2-research";
import { hashJson } from "../src/lib/solver/preflop-v2/corpus";

test("saved preflight evidence is source-bound and cannot be upgraded by changing its summary", () => {
  const report = JSON.parse(readFileSync("tasks/artifacts/preflop-v2-preflight.json", "utf8"));
  assert.equal(auditSavedPreflight(report).admitted, 504);
  report.summary.maximumReservedBytes = 0;
  assert.throws(() => auditSavedPreflight(report));
});

test("a timeout checkpoint cannot become a passing calibration or a fitted/held-out result", () => {
  const preflight = JSON.parse(readFileSync("tasks/artifacts/preflop-v2-preflight.json", "utf8"));
  const report = JSON.parse(readFileSync("tasks/artifacts/preflop-v2-calibration.json", "utf8"));
  assert.deepEqual([auditSavedCalibration(report, preflight).attempted, report.passed, report.complete], [1, 0, false]);
  for (const mutation of [
    { complete: true }, { fittedModels: 1 }, { heldoutObservations: 1 }, { productionRangePromotion: true },
    { rows: [{ ...report.rows[0], status: "passed" }] },
    { rows: [{ ...report.rows[0], lastCheckpoint: { ...report.rows[0].lastCheckpoint, exploitability: 0 } }] },
  ]) {
    const altered = { ...report, ...mutation }; delete altered.payloadHash; altered.payloadHash = hashJson(altered);
    assert.throws(() => auditSavedCalibration(altered, preflight));
  }
});
test("tiny reference reproduces saved strategies, accounting and independently computed legal gains", () => {
  const saved = JSON.parse(readFileSync("tasks/artifacts/preflop-v2-tiny.json", "utf8"));
  assert.deepEqual(buildTinyReference(), saved);
  assert.ok(Math.max(...saved.solved.gains) <= 0.01);
  assert.ok(saved.witness.cheatingValue > saved.witness.legalValue);
});
