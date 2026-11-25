import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { compareFullReachRows, fullReachContext } from "../scripts/build-full-reach-v2";
import { auditFullReachJournal } from "../scripts/audit-full-reach-v2";
import { FULL_REACH_EVIDENCE } from "../scripts/measure-full-reach-v2";
import { v2Roots } from "../src/lib/solver/bridge/formations/full-reach-library-v2";
import { hashJson } from "../src/lib/solver/preflop-v2/corpus";

const observation = () => JSON.parse(readFileSync(`${FULL_REACH_EVIDENCE}/experiment.json`, "utf8"));

test("full-reach evidence binds fixed inputs, charges every native attempt and retains reuse provenance", () => {
  const report = observation(), { payloadHash, ...payload } = report;
  assert.equal(hashJson(payload), payloadHash);
  assert.deepEqual(report.identity, fullReachContext().identity);
  const journal = auditFullReachJournal(report);
  assert.equal(journal.reusedGenerationInputs, 6);
  const measured = report.attempts.reduce((n: number, a: { budgetMs: number }) => n + a.budgetMs, report.identity.priorChargedNativeMs);
  assert.ok(Math.abs(measured - report.chargedNativeMs) < 1e-6);
  if (report.status === "complete") {
    assert.equal(journal.freshAttempts, 18);
    assert.deepEqual(report.reproduction.map((r: { id: string }) => r.id), v2Roots().map(r => r.id));
    report.generation.forEach((r: Parameters<typeof compareFullReachRows>[0], i: number) => compareFullReachRows(r, report.reproduction[i]));
  } else { assert.equal(report.status, "blocked"); assert.ok(report.error); }
});

test("native journal rejects reordered or hidden attempts and resource/provenance corruption", () => {
  const report = observation();
  assert.throws(() => auditFullReachJournal({ ...report, attempts: [...report.attempts].reverse() }));
  assert.throws(() => auditFullReachJournal({ ...report, attempts: [...report.attempts, report.attempts[0]] }));
  const bad = structuredClone(report); bad.generation[0].iterations = 0;
  assert.throws(() => auditFullReachJournal(bad));
  const provenance = structuredClone(report); provenance.generation[0].provenance = "fresh-generate";
  assert.throws(() => auditFullReachJournal(provenance));
});

test("fresh reproduction compares every data hash and the exact iteration count", () => {
  const report = observation(), row = report.generation[0];
  compareFullReachRows(row, structuredClone(row));
  assert.throws(() => compareFullReachRows(row, { ...row, iterations: row.iterations + 10 }));
  assert.throws(() => compareFullReachRows(row, { ...row, dataHashes: {} }));
  const changed = structuredClone(row); changed.dataHashes[Object.keys(changed.dataHashes)[0]] = "0".repeat(64);
  assert.throws(() => compareFullReachRows(row, changed));
});
