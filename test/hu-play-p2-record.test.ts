import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

test("P2 release evidence replays every frozen case and independently recomputes all value/safety/browser gates", async () => {
  assert.ok(existsSync("scripts/audit-hu-play-p2.ts"), "P2 needs a reproducible release audit");
  const { readP2Evidence, checkP2Evidence } = await import("../scripts/audit-hu-play-p2");
  const evidence = readP2Evidence(), summary = await checkP2Evidence(evidence);
  assert.equal(summary.completed, 200); assert.equal(summary.translations, 12);
  assert.ok(summary.maxIndependentPctPot <= .3); assert.ok(summary.browser.every(b => b.p95Ms <= 2000));
  assert.equal(summary.safety.casesWithPositiveMarginVsTranslation, 134);
  const missing = { ...evidence, cases: evidence.cases.slice(1) };
  await assert.rejects(() => checkP2Evidence(missing), /200|case|length/i);
  const changed = structuredClone(evidence.cases[0]); Object.assign(changed.solves[0].result.exploitability, { reached: false });
  await assert.rejects(() => checkP2Evidence({ ...evidence, cases: [changed, ...evidence.cases.slice(1)] }), /hash|quality|target/i);
});
