// Preflop solver v1, PF2/PF3: saved results re-grade ≤ 1 mbb/hand and re-solve byte-identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { handIndex } from "../src/lib/solver/hands";
import { makeSpot, SIX_MAX_BTN_BB, V1_MENU, type PreflopResultV1 } from "../src/lib/solver/preflop/contract";
import { evaluatePreflopProfile } from "../src/lib/solver/preflop/grader";
import { hashPreflopSpot } from "../src/lib/solver/preflop/hash";
import { defaultRealizationTable } from "../src/lib/solver/preflop/realization";
import { profileFromResult, solvePreflop, validatePreflopResult } from "../src/lib/solver/preflop/solve";
import { pf2Spot } from "../src/lib/solver/preflop/published";

const ART = "src/lib/solver/preflop/artifacts";
const text = (name: string) => readFileSync(`${ART}/${name}`, "utf8");
const load = (name: string) => JSON.parse(text(name)) as PreflopResultV1;

for (const name of ["pf2-default-r.json", "pf3-measured-r.json"]) {
  test(`${name}: independent re-grade ≤ 1 mbb/hand, equal to the saved grade`, () => {
    const saved = load(name);
    const game = validatePreflopResult(saved);
    const { grade } = evaluatePreflopProfile(game, profileFromResult(saved));
    assert.ok(grade.exploitability <= 0.001, `${grade.exploitability}`);
    assert.ok(saved.converged);
    assert.ok(Math.abs(grade.exploitability - saved.grade.exploitability) < 1e-12);
    assert.ok(Math.abs(grade.value[0] + grade.value[1] - 0.5) < 1e-9, "constant-sum: values add to the dead 0.5");
    assert.equal(hashPreflopSpot(saved.spot), saved.spotHash);
  });

  test(`${name}: re-solving the saved spot reproduces the file byte for byte`, () => {
    const saved = load(name);
    const { result } = solvePreflop(saved.spot);
    assert.equal(canonicalSolverJson(result) + "\n", text(name));
  });
}

test("PF2 spot built from code equals the saved spot (config hash)", () => {
  assert.equal(hashPreflopSpot(pf2Spot()), load("pf2-default-r.json").spotHash);
});

test("DCFR flag: converges on a reduced 6-max game, deterministically", () => {
  const classes = ["AA", "KK", "QQ", "JJ", "TT", "AKs", "AQs", "AKo", "KQs", "JTs", "T9s", "76s", "A5s", "K9o", "72o"].map(handIndex).sort((a, b) => a - b);
  const spot = makeSpot({
    label: "reduced dcfr", structure: SIX_MAX_BTN_BB, menu: V1_MENU, realization: defaultRealizationTable(), classes,
    solver: { algorithm: "dcfr", targetExploitability: 0.001, maxIterations: 20_000 },
  });
  const a = solvePreflop(spot).result, b = solvePreflop(spot).result;
  assert.ok(a.converged, `${a.grade.exploitability} after ${a.iterations}`);
  assert.equal(canonicalSolverJson(a), canonicalSolverJson(b));
  const cfrPlus = solvePreflop({ ...spot, solver: { ...spot.solver, algorithm: "cfr+" } }).result;
  assert.ok(cfrPlus.converged);
  // Same game, both near equilibrium: game values agree closely.
  assert.ok(Math.abs(a.grade.value[0] - cfrPlus.grade.value[0]) < 0.005);
});
