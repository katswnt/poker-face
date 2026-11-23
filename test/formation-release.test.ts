import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { checkFormationObservation } from "../scripts/audit-formation-release";

test("published quality and cost are tied to the accepted observation, not just in range", () => {
  const row = { id: "example", status: "passed", elapsedMs: 123.45, iterations: 160, pctPot: .25, peakRssBytes: 123456 };
  const entry = { id: "example", solveMs: 123, iterations: 160, exploitability: { chips: 1.25, pctPot: .25 }, peakRssBytes: 123456 };
  checkFormationObservation(row, entry);
  for (const change of [{ solveMs: 124 }, { iterations: 170 }, { exploitability: { chips: 1, pctPot: .2 } },
    { peakRssBytes: 123457 }, { id: "another" }]) assert.throws(() => checkFormationObservation(row, { ...entry, ...change }));
  for (const change of [{ status: "failed" }, { elapsedMs: null }, { iterations: null }, { pctPot: null }, { peakRssBytes: null }])
    assert.throws(() => checkFormationObservation({ ...row, ...change }, entry));
});

test("the frozen CO-BTN export failure remains blocked despite a converged native checkpoint", () => {
  const report = JSON.parse(readFileSync("tasks/artifacts/formation-libraries-v1/generate.json", "utf8"));
  assert.equal(report.payloadHash, "f3ce16febc3894af832190f6366412632c3a3399c668ffa48f6e665be98454ad");
  const group = report.groups.find((g: { formation: string }) => g.formation === "co-btn-srp-v1");
  assert.equal(group.status, "blocked"); assert.equal(group.rows.length, 6);
  assert.equal(group.rows.filter((r: { status: string }) => r.status === "passed").length, 5);
  const row = group.rows[5];
  assert.equal(row.id, "co-btn-srp-v1-td7d3c"); assert.equal(row.status, "failed");
  assert.equal(row.resultHash, null); assert.equal(row.dataHashes, null);
  assert.equal(row.lastCheckpoint.iteration, 160);
  assert.ok(row.lastCheckpoint.exploitability < row.lastCheckpoint.target);
  const differences = [...(row.error as string).matchAll(/opponent EV of \w+ ([0-9.]+) ≠ ([0-9.]+)/g)]
    .map(m => Math.abs(Number(m[1]) - Number(m[2])));
  assert.equal(differences.length, 14); assert.ok(Math.abs(Math.min(...differences) - 29.3) < 1e-9);
  assert.equal(Math.max(...differences), 258.25);
});
