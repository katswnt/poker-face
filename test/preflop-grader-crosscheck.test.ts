// Preflop solver v1, spec §5 cross-check 1: grader.ts agrees with toy/best-response.ts on a reduced
// game (13 pairs + 7 suited aces, DISJOINT chance weights), built as a toy ExtensiveFormGame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handIndex } from "../src/lib/solver/hands";
import type { ExtensiveFormGame, BehavioralStrategy } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { makeSpot, SIX_MAX_BTN_BB, V1_MENU } from "../src/lib/solver/preflop/contract";
import { PreflopCfr } from "../src/lib/solver/preflop/cfr";
import { evaluatePreflopProfile } from "../src/lib/solver/preflop/grader";
import { defaultRealizationTable, mapRealizationTable } from "../src/lib/solver/preflop/realization";
import { buildPreflopGame, terminalUtility, type PreflopGame } from "../src/lib/solver/preflop/terminal";
import type { PreflopNode, PreflopProfile } from "../src/lib/solver/preflop/tree";

const REDUCED = [
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44", "33", "22",
  "AKs", "AQs", "AJs", "ATs", "A9s", "A5s", "A2s",
].map(handIndex).sort((a, b) => a - b);

type State = { readonly deal: readonly [number, number] | null; readonly node: PreflopNode | null };

/** The same game in toy form: chance deals (h, k) ∝ DISJOINT, then the public tree; utilities shifted by −dead/2 to be zero-sum. */
function toyGame(game: PreflopGame): ExtensiveFormGame<State, string, readonly [number, number]> {
  const shift = game.spot.structure.dead / 2;
  const outcomes: { outcome: readonly [number, number]; probability: number }[] = [];
  for (let h = 0; h < game.n; h++) for (let k = 0; k < game.n; k++) {
    outcomes.push({ outcome: [h, k], probability: game.deal[h * game.n + k] / game.dealTotal });
  }
  return {
    id: "preflop-reduced",
    initialState: () => ({ deal: null, node: null }),
    node: state => {
      if (!state.deal) return { kind: "chance", outcomes };
      const node = state.node!;
      if (node.kind === "terminal") {
        const [u0, u1] = terminalUtility(game.spot, node, game.classes[state.deal[0]], game.classes[state.deal[1]]);
        return { kind: "terminal", utility: [u0 - shift, u1 - shift] };
      }
      return { kind: "player", player: node.player, actions: node.actions };
    },
    nextChance: (_state, outcome) => ({ deal: outcome, node: game.tree.root }),
    nextAction: (state, action) => {
      const node = state.node!;
      if (node.kind !== "decision") throw new Error("action at a terminal");
      return { deal: state.deal, node: node.children[node.actions.indexOf(action)] };
    },
    informationSet: (state, player) => `${state.node!.id}|${state.deal![player]}`,
  };
}

function toyStrategy(game: PreflopGame, profile: PreflopProfile): BehavioralStrategy<string> {
  const out = new Map<string, { actions: readonly string[]; probabilities: readonly number[] }>();
  for (const node of game.tree.decisions) {
    const freq = profile.get(node.id)!;
    for (let h = 0; h < game.n; h++) out.set(`${node.id}|${h}`, { actions: node.actions, probabilities: freq.map(row => row[h]) });
  }
  return out;
}

for (const [label, iterations] of [["early CFR+ iterate", 7], ["converging iterate", 300]] as const) {
  test(`grader.ts = toy/best-response.ts within 1e-9 on the reduced 6-max game (${label})`, () => {
    const realization = mapRealizationTable(defaultRealizationTable(), "class-varying test R", (p, _t, c, v) => v * (p === "ip" ? 1 + (c % 5) / 20 : 1 - (c % 3) / 20));
    const game = buildPreflopGame(makeSpot({ label: "reduced", structure: SIX_MAX_BTN_BB, menu: V1_MENU, realization, classes: REDUCED }));
    const cfr = new PreflopCfr(game);
    cfr.run(iterations);
    const profile = cfr.averageStrategy();
    const ours = evaluatePreflopProfile(game, profile).grade;
    const toy = gradeStrategy(toyGame(game), toyStrategy(game, profile));
    const shift = game.spot.structure.dead / 2;
    assert.ok(Math.abs(toy.value[0] + shift - ours.value[0]) < 1e-9, `value ${toy.value[0] + shift} vs ${ours.value[0]}`);
    assert.ok(Math.abs(toy.value[1] + shift - ours.value[1]) < 1e-9);
    assert.ok(Math.abs(toy.gains[0] - ours.gains[0]) < 1e-9, `gain0 ${toy.gains[0]} vs ${ours.gains[0]}`);
    assert.ok(Math.abs(toy.gains[1] - ours.gains[1]) < 1e-9, `gain1 ${toy.gains[1]} vs ${ours.gains[1]}`);
    assert.ok(Math.abs(toy.exploitability - ours.exploitability) < 1e-9);
    if (iterations > 100) assert.ok(ours.exploitability < 0.01, `${ours.exploitability}`);
  });
}

test("grader detects a corrupted strategy (AA folding to the open raises BB's exploitability)", () => {
  const game = buildPreflopGame(makeSpot({ label: "reduced", structure: SIX_MAX_BTN_BB, menu: V1_MENU, realization: defaultRealizationTable(), classes: REDUCED }));
  const cfr = new PreflopCfr(game);
  cfr.run(500);
  const profile = cfr.averageStrategy();
  const before = evaluatePreflopProfile(game, profile).grade;
  const corrupted = new Map(profile);
  const bb = profile.get("r2.5")!.map(row => [...row]);
  const aa = game.classes.indexOf(handIndex("AA"));
  bb.forEach((row, a) => { row[aa] = a === 0 ? 1 : 0; });
  corrupted.set("r2.5", bb);
  const after = evaluatePreflopProfile(game, corrupted).grade;
  assert.ok(after.gains[1] > before.gains[1] + 1e-4, `${after.gains[1]} vs ${before.gains[1]}`);
  assert.throws(() => evaluatePreflopProfile(game, new Map([...profile].slice(1))), /missing node/);
});
