// Preflop solver v1, spec §6: structural checks and the model-comparison validation table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handIndex } from "../src/lib/solver/hands";
import { makeSpot, SIX_MAX_BTN_BB, V1_MENU, type PreflopResultV1 } from "../src/lib/solver/preflop/contract";
import { validateProfile } from "../src/lib/solver/preflop/grader";
import { defaultRealizationTable } from "../src/lib/solver/preflop/realization";
import { premiumFolds, rangeL1, validationTable } from "../src/lib/solver/preflop/report";
import { profileFromResult, solvePreflop, validatePreflopResult } from "../src/lib/solver/preflop/solve";
import { pf2Spot } from "../src/lib/solver/preflop/published";
import { aggregateStats } from "../src/lib/solver/preflop/stats";
import { buildPreflopGame } from "../src/lib/solver/preflop/terminal";

const load = (name: string) => JSON.parse(readFileSync(`src/lib/solver/preflop/artifacts/${name}`, "utf8")) as PreflopResultV1;

for (const name of ["pf2-default-r.json", "pf3-measured-r.json"]) {
  test(`${name}: frequencies in [0,1] summing to 1, AA/KK never fold, BB defend ≥ 37.5% MDF bound`, () => {
    const saved = load(name);
    const game = validatePreflopResult(saved);
    validateProfile(game, profileFromResult(saved));
    assert.deepEqual(premiumFolds(saved), []);
    assert.ok(saved.stats.bbDefendPct >= 37.5);
    const rows = validationTable(saved);
    assert.equal(rows.find(r => r.metric.startsWith("BB defend ≥"))!.status, "pass");
    for (const r of rows) assert.ok(r.model === null || (r.model >= 0 && r.model <= 100));
    // AA and KK open 100% (root) and never fold at any node they reach.
    const open = saved.strategy[""];
    for (const label of ["AA", "KK"]) assert.equal(open.freq[open.actions.indexOf("r2.5")][saved.classes.indexOf(label)], 1);
  });
}

test("aggregate stats definitions on a hand-built profile", () => {
  const game = buildPreflopGame(makeSpot({ label: "stats", structure: SIX_MAX_BTN_BB, menu: V1_MENU, realization: defaultRealizationTable() }));
  const pure = (actions: readonly string[], pick: (h: number) => string) =>
    actions.map(a => Array.from({ length: game.n }, (_, h) => (pick(h) === a ? 1 : 0)));
  const aa = handIndex("AA"), kk = handIndex("KK");
  const profile = new Map(game.tree.decisions.map(d => {
    if (d.id === "") return [d.id, pure(d.actions, h => (h === aa || h === kk ? "r2.5" : "fold"))];   // opens 12 combos
    if (d.id === "r2.5") return [d.id, pure(d.actions, h => (h === aa ? "r11" : h === kk ? "call" : "fold"))];
    if (d.id === "r2.5/r11") return [d.id, pure(d.actions, h => (h === aa ? "jam" : "fold"))];
    return [d.id, pure(d.actions, () => "call")];
  }));
  const s = aggregateStats(game, profile);
  assert.ok(Math.abs(s.btnOpenPct - (100 * 12) / 1326) < 1e-12);
  assert.ok(Math.abs(s.bbDefendPct - (100 * 12) / 1326) < 1e-12);
  assert.ok(Math.abs(s.bb3betPct - (100 * 6) / 1326) < 1e-12);
  assert.ok(Math.abs(s.btn4betOfOpenPct - 50) < 1e-12, "AA jams, KK folds: half of the opening combos");
  assert.ok(Math.abs(s.btnFoldVs3betOfOpenPct - 50) < 1e-12);
});

test("PF3 vs PF2 range diff is reported in combos and is zero against itself", () => {
  const pf2 = load("pf2-default-r.json"), pf3 = load("pf3-measured-r.json");
  assert.equal(rangeL1(pf2, pf2, "", "r2.5"), 0);
  const d = rangeL1(pf2, pf3, "", "r2.5");
  assert.ok(d > 0 && d < 1326);
});

test("rake stub direction: 5% rake (cap 3bb, no flop no drop) does not widen BTN opens or BB defence", () => {
  const base = load("pf2-default-r.json");
  const { result } = solvePreflop(pf2Spot(defaultRealizationTable(), { pct: 0.05, capBb: 3, noFlopNoDrop: true }, "rake direction test"));
  assert.ok(result.stats.btnOpenPct <= base.stats.btnOpenPct, `${result.stats.btnOpenPct} vs ${base.stats.btnOpenPct}`);
  assert.ok(result.stats.bbDefendPct <= base.stats.bbDefendPct, `${result.stats.bbDefendPct} vs ${base.stats.bbDefendPct}`);
});
