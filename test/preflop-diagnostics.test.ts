import assert from "node:assert/strict";
import { test } from "node:test";
import saved from "../src/lib/solver/preflop/artifacts/pf3-measured-r.json";
import savedFit from "../src/lib/solver/preflop/artifacts/pf3-realization-fit.json";
import { COMBOS } from "../src/lib/solver/comboCounts";
import type { PreflopResultV1 } from "../src/lib/solver/preflop/contract";
import { bbCallTrace, defenceCoverage, fitResiduals, ratioAdjustmentCounterexample } from "../src/lib/solver/preflop/diagnostics";
import type { RealizationFit } from "../src/lib/solver/preflop/realization-fit";
import { flopShareIp } from "../src/lib/solver/preflop/terminal";

const result = saved as unknown as PreflopResultV1, fit = savedFit as unknown as RealizationFit;
const near = (a: number, b: number, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("diagnostic exposes original-target residuals hidden by pins and adjusted-target stopping", () => {
  const ip = fitResiduals(fit, "ip"), oop = fitResiduals(fit, "oop");
  assert.equal(ip.measuredClasses, 87); assert.equal(oop.bucketClasses, 68);
  assert.ok(ip.maxAdjustedTargetErrorUnpinned < 0.005);
  assert.ok(ip.maxOriginalTargetError > 0.39);
  const aa = ip.worstOriginalTargets.find(r => r.hand === "AA")!;
  assert.ok(aa.measuredShare! > 1.39 && aa.originalTarget > 1.29 && aa.achieved < 0.902);
  assert.equal(aa.pinned, true); near(aa.adjustedTarget, aa.achieved);
});

test("blocker-conditioned defence matches an independent enumeration of physical combo pairs", () => {
  const d = defenceCoverage(result, fit), node = result.strategy["r2.5"];
  const open = result.strategy[""].freq[result.strategy[""].actions.indexOf("r2.5")], fold = node.actions.indexOf("fold");
  let total = 0, defend = 0;
  for (const a of COMBOS) for (const b of COMBOS) {
    if (a.c1 === b.c1 || a.c1 === b.c2 || a.c2 === b.c1 || a.c2 === b.c2) continue;
    total += open[a.cls]; defend += open[a.cls] * (1 - node.freq[fold][b.cls]);
  }
  near(d.conditionalDefendPct, 100 * defend / total, 1e-7);
  near(d.chartDefendPct, result.stats.bbDefendPct);
  assert.ok(d.conditionalDefendPct > 99);
  assert.equal(Object.values(d.groups).reduce((n, g) => n + g.combos, 0), 1326);
});

test("call-minus-fold trace reproduces the independently graded saved action values", () => {
  for (const h of result.classes) {
    const row = bbCallTrace(result, h);
    near(row.callMinusFoldBb, row.savedCallMinusFoldBb, 0.000006);
    near(row.breakEvenShare, 1.5 / 5.5);
  }
  assert.ok(bbCallTrace(result, "72o").callMinusFoldBb > 0.03);
  assert.throws(() => bbCallTrace({ ...result, spot: { ...result.spot, rake: { ...result.spot.rake, pct: 0.05 } } }, "72o"), /no rake/);
});

test("bounded normalized shares cannot express future-betting transfers and identify only relative R", () => {
  for (const e of [0, 0.2, 0.5, 0.8, 1]) for (const a of [0.1, 1, 10]) for (const b of [0.1, 1, 10]) {
    const s = flopShareIp(e, a, b);
    assert.ok(s >= 0 && s <= 1);
    near(s, flopShareIp(e, 0.5 * a, 0.5 * b));
  }
  const ex = ratioAdjustmentCounterexample();
  near(ex.trueMeanShare, 0.65); near(ex.adjustedShare, 0.75); near(ex.bias, 0.1);
});
