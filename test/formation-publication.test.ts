import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNativeGap } from "../src/lib/solver/bridge/formations/publication";

test("native float32 chip reporting reproduces the exact float64 percentage without a tolerance", () => {
  const chips = 1.4154626, pctPot = 0.2830925226211548;
  assert.notEqual(chips / 500 * 100, pctPot);
  checkNativeGap({ chips, pctPot }, 500);
  for (const changed of [{ chips: 1.4154627, pctPot }, { chips, pctPot: chips / 500 * 100 },
    { chips, pctPot: pctPot + 1e-12 }, { chips: NaN, pctPot }, { chips: -1, pctPot: -.2 },
    { chips: 1.5000001, pctPot: Math.fround(1.5000001) / 500 * 100 }])
    assert.throws(() => checkNativeGap(changed, 500));
  checkNativeGap({ chips: 1.5, pctPot: .3 }, 500);
  for (const pot of [0, -1, Infinity, NaN]) assert.throws(() => checkNativeGap({ chips, pctPot }, pot));
});
