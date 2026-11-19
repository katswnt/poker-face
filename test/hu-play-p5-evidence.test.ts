import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("P5 retains every frozen UI hand and rejects changed outcomes or missing policies", async () => {
  assert.ok(existsSync("scripts/audit-hu-play-p5.ts"), "Need an executable saved-evidence gate, not a prose claim");
  const {readP5Evidence,checkP5Evidence} = await import("../scripts/audit-hu-play-p5");
  const e=readP5Evidence(), summary=await checkP5Evidence(e);
  assert.equal(summary.hands,200); assert.equal(summary.replayed,200); assert.equal(summary.solveAttempts,301);
  assert.equal(summary.turnHands,128); assert.equal(summary.riverHands,105);
  assert.equal(summary.humanNet+summary.aiNet,10000);
  const altered=structuredClone(e);altered.report.rows[0].ledger={...altered.report.rows[0].ledger,humanNet:altered.report.rows[0].ledger.humanNet+1};
  await assert.rejects(()=>checkP5Evidence(altered),/hash/);
  const missing=structuredClone(e); missing.solves.pop();
  await assert.rejects(()=>checkP5Evidence(missing),/policy|solve/i);
});

test("P5 honest claims and mandatory teaching do not depend on the protected trainer", () => {
  const page=readFileSync("src/app/play/PlayTable.tsx","utf8"), math=readFileSync("src/app/play/DecisionMath.tsx","utf8");
  for (const copy of [/Preflop is scripted/,/hand-written ranges/,/12 saved flops/,/not exact GTO/,/not a global guarantee/,
    /23\.4% of the subgame pot/,/not your expected win rate/,/Download corresponding AGPL engine source/]) assert.match(page,copy);
  for (const copy of [/Pot odds/,/Minimum defence/,/Polar bluff share/,/Exact all-in equity/,/Where this decision came from/,
    /not the full composed AI/,/Action EVs were not exported/,/no Monte Carlo sampling/]) assert.match(math,copy);
  assert.doesNotMatch(page+math+readFileSync("src/lib/hu-play/ui-controller.ts","utf8"),/poker\/session/);
});

test("P5 is discoverable without touching the trainer and its evidence/browser checks are mandatory CI steps", () => {
  for (const path of ["src/app/solver/lab/LeducLab.tsx","src/app/solver/live/LiveSolver.tsx","src/app/drills/Drills.tsx"])
    assert.match(readFileSync(path,"utf8"),/<a href="\/play">Play the AI<\/a>/);
  const pkg=JSON.parse(readFileSync("package.json","utf8")),ci=readFileSync(".github/workflows/ci.yml","utf8");
  assert.equal(pkg.scripts["audit:hu-play:p5"],"node --import tsx scripts/audit-hu-play-p5.ts --check");
  assert.match(ci,/run: npm run audit:hu-play:p5/);
  assert.match(ci,/run: npx playwright test --config playwright\.play\.config\.ts\s+env:\s+POKER_FACE_LIVE_REQUIRED: "1"/);
});
