import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

test("enabled E1 evidence retains frozen hands, full browser gates and independent action values", async () => {
  assert.ok(existsSync("scripts/audit-hu-play-e1.ts"), "Independent E1 release evidence checker required");
  const { readE1Evidence, checkE1Evidence } = await import("../scripts/audit-hu-play-e1");
  const evidence = readE1Evidence(), summary = await checkE1Evidence(evidence);
  assert.equal(summary.hands, 1000); assert.equal(summary.turnCases, 200); assert.equal(summary.uiHands, 200);
  assert.ok(summary.browser[0].turn.p95Ms <= 10000 && summary.browser[0].river.p95Ms <= 2000);
  assert.equal(summary.memory.length, 3); assert.equal(summary.references.length, 3);
  assert.ok(summary.references.every(r => r.maxAbsoluteError <= .0002));
  const missing = { ...evidence, cases: evidence.cases.slice(1) };
  await assert.rejects(() => checkE1Evidence(missing), /200|case|coverage/i);
  const stale = { ...evidence, sourceFreeze: { ...evidence.sourceFreeze, sourceFiles: evidence.sourceFreeze.sourceFiles.slice(1) } };
  await assert.rejects(() => checkE1Evidence(stale), /source|closure/i);
  const falseMode = { ...evidence, browser: { ...evidence.browser, decisionValues: false as const } };
  await assert.rejects(() => checkE1Evidence(falseMode), /enabled|capability|hash/i);
});
