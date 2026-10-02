import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

test("P3 release evidence retains every frozen case, exact replay, complete grades and unchanged browser gates", async () => {
  assert.ok(existsSync("scripts/audit-hu-play-p3.ts"), "P3 independent release audit required");
  const { readP3Evidence, checkP3Evidence } = await import("../scripts/audit-hu-play-p3");
  const evidence = readP3Evidence(), summary = await checkP3Evidence(evidence);
  assert.equal(summary.completed, 200); assert.equal(summary.hands, 1000);
  assert.ok(summary.rivers >= 20 && summary.completeTurns === 4);
  assert.ok(summary.browser[0].turn.p95Ms <= 10000 && summary.browser[0].river.p95Ms <= 2000);
  assert.deepEqual(summary.latencyGate, { browser: "chromium", turnP95Ms: 10000, riverP95Ms: 2000 });
  await assert.rejects(() => checkP3Evidence({ ...evidence, cases: evidence.cases.slice(1) }), /200|case|length/i);
  await assert.rejects(() => checkP3Evidence({ ...evidence, currentSources: evidence.currentSources.slice(1) }), /source|closure/i);
  const native = structuredClone(evidence.native); native.rows[0].logHash = "0".repeat(64);
  await assert.rejects(() => checkP3Evidence({ ...evidence, native }), /hash|replay/i);
});
