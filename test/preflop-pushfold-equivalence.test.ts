// Preflop solver v1, PF1: the all-in-only heads-up game reproduces pushfold.ts as a special case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { comparePushFold, huJamFoldSpot } from "../src/lib/solver/preflop/pushfold-oracle";
import { defaultRealizationTable, mapRealizationTable, unitRealizationTable } from "../src/lib/solver/preflop/realization";
import { solvePreflop } from "../src/lib/solver/preflop/solve";

const DEPTHS = [2, 5, 8, 10, 13, 17.5, 20]; // all 37 depths: src/lib/solver/preflop/artifacts/pf1-pushfold-equivalence.json

for (const stack of DEPTHS) {
  test(`PF1 ${stack}bb: game value, pushfold Nash gap, shove/call % and per-class frequencies`, () => {
    const c = comparePushFold(stack);
    assert.ok(c.exploitability <= 1e-6, `our exploitability ${c.exploitability}`);
    assert.ok(Math.abs(c.valueDiff) <= 1e-4, `value ${c.value} vs pushfold ${c.pushfoldValue}`);
    assert.ok(c.pushfoldNashGap <= 5e-4, `pushfold.ts's own best responses find a gap of ${c.pushfoldNashGap}`);
    assert.ok(Math.abs(c.shovePct - c.pushfoldShovePct) <= 0.5, `shove ${c.shovePct} vs ${c.pushfoldShovePct}`);
    assert.ok(Math.abs(c.callPct - c.pushfoldCallPct) <= 0.5, `call ${c.callPct} vs ${c.pushfoldCallPct}`);
    // Documented threshold hands: any class differing by > 0.05 must be (near-)indifferent. The
    // largest gap over all 37 depths is Q8s calling at 13bb (0.017 bb): pushfold.ts's
    // fictitious-play residue (its Nash gap tolerance is 5e-4; ours is 1e-6).
    for (const d of c.differing) assert.ok(d.evGap < 0.02, `${d.hand} ${d.node}: ours ${d.ours}, pushfold ${d.pushfold}, EV gap ${d.evGap}`);
    assert.ok(c.differing.length <= 3, `${c.differing.length} differing classes`);
  });
}

test("PF1: changing any R leaves the jam/fold solution bit-identical (no flop terminals)", () => {
  const strategyJson = (realization = defaultRealizationTable()) => {
    const { result } = solvePreflop(huJamFoldSpot(10, realization));
    return canonicalSolverJson({ strategy: result.strategy, grade: result.grade, iterations: result.iterations, curve: result.exploitabilityCurve });
  };
  const base = strategyJson();
  assert.equal(strategyJson(unitRealizationTable()), base);
  assert.equal(strategyJson(mapRealizationTable(defaultRealizationTable(), "perturbed", (_p, _t, c, v) => v * (1 + (c % 7) / 10))), base);
});
