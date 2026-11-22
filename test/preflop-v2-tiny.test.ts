import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGameTreeIndex, type BehavioralStrategy } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { riverHandScore } from "../src/lib/solver/river/cards";
import { tablePairValue } from "../src/lib/solver/preflop-v2/table";
import { TINY_INPUT, tinyGame, tinyFixedStrategy, tinyContinuationTable, tinyCollapsedGrade, type TinyAction, type TinyState } from "../src/lib/solver/preflop-v2/tiny-game";
import { tinyOracleGrade, tinyOracleWinner, tinyCheatingWitness } from "../src/lib/solver/preflop-v2/tiny-oracle";
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-10, `${a} != ${b}`);

test("tiny joint game preserves legal card support, dead money and hidden information sets", () => {
  const game = tinyGame(), root = game.node(game.initialState()); assert.equal(root.kind, "chance");
  if (root.kind !== "chance") throw Error("root"); assert.equal(root.outcomes.length, 7);
  near(root.outcomes.reduce((s, r) => s + r.probability, 0), 1);
  const info = new Map<string, Set<number>>(); let showdowns = 0, leaves = 0;
  const visit = (state: TinyState) => {
    const node = game.node(state);
    if (state.hands[0] >= 0) {
      const cards = [...TINY_INPUT.ranges[0][state.hands[0]].cards, ...TINY_INPUT.ranges[1][state.hands[1]].cards, ...state.board];
      assert.equal(new Set(cards).size, cards.length);
    }
    if (node.kind === "terminal") {
      leaves++; near(node.utility[0] + node.utility[1], 0); // .25 dead-money offset per player.
      if (state.folded === null) {
        showdowns++; const scores = ([0, 1] as const).map(p => riverHandScore(TINY_INPUT.ranges[p][state.hands[p]].cards, state.board));
        const winner = scores[0] === scores[1] ? "split" : scores[0] > scores[1] ? 0 : 1;
        assert.equal(winner, tinyOracleWinner(state.hands[0], state.hands[1]));
      } return;
    }
    if (node.kind === "chance") { near(node.outcomes.reduce((s, r) => s + r.probability, 0), 1); for (const o of node.outcomes) visit(game.nextChance(state, o.outcome)); return; }
    const p = node.player, publicKey = state.stage === "preflop" ? `pre|${p}|${state.hands[p]}`
      : `flop|${p}|${state.hands[p]}|${state.board.join("")}|${state.history}`;
    assert.equal(game.informationSet(state, p), publicKey);
    const hidden = info.get(publicKey) ?? new Set<number>(); hidden.add(state.hands[1 - p]); info.set(publicKey, hidden);
    for (const a of node.actions) visit(game.nextAction(state, a));
  }; visit(game.initialState());
  assert.ok(showdowns > 0 && leaves > showdowns); assert.ok([...info.values()].some(s => s.size > 1));
});

test("fixed profile, independent legal best responses and collapsed values agree, without a false global certificate", () => {
  for (const mode of ["bet", "checkdown", "allin"] as const) {
    const game = tinyGame(mode), strategy = tinyFixedStrategy(game), grade = gradeStrategy(game, strategy), oracle = tinyOracleGrade(strategy, mode);
    for (const p of [0, 1] as const) { near(grade.value[p], oracle.value[p]); near(grade.bestResponses[p].value, oracle.bestResponse[p]); }
    const table = tinyContinuationTable(game, strategy), collapsed = tinyCollapsedGrade(table, strategy);
    near(collapsed.value[0], grade.value[0]); near(collapsed.value[1], grade.value[1]);
    assert.ok(collapsed.ipPreflopBestResponse <= grade.bestResponses[1].value + 1e-10);
    if (mode === "bet") {
      assert.ok(grade.bestResponses[1].value - collapsed.ipPreflopBestResponse > 0.01);
      assert.ok(tablePairValue(table, 2, 0)[0] < 0); assert.ok(tablePairValue(table, 2, 0)[1] > 6.5);
    }
    if (mode === "checkdown") for (let h = 0; h < 3; h++) for (let k = 0; k < 3; k++) {
      if (table.oopGross[h][k] === null) continue; const winner = tinyOracleWinner(h, k);
      near(tablePairValue(table, h, k)[0], winner === "split" ? 3.25 : winner === 0 ? 6.5 : 0);
    }
  }
  const witness = tinyCheatingWitness(); assert.ok(witness.cheatingValue > witness.legalValue + 0.01); assert.equal(witness.hiddenStates, 2);
  near(witness.legalValue, -13 / 4); near(witness.cheatingValue, -135 / 52);
});

test("16,384-iteration tiny joint strategy is independently graded to the frozen chip gate", () => {
  const game = tinyGame(), solved = solveCfr(game, { iterations: 16384 }), index = buildGameTreeIndex(game);
  const strategy = solved.averageStrategy as BehavioralStrategy<TinyAction>, grade = gradeStrategy(game, strategy, index), oracle = tinyOracleGrade(strategy);
  for (const p of [0, 1] as const) {
    near(grade.value[p], oracle.value[p]); near(grade.bestResponses[p].value, oracle.bestResponse[p]);
    assert.ok(grade.gains[p] <= 0.01, `player ${p} gain ${grade.gains[p]}`);
  }
  const collapsed = tinyCollapsedGrade(tinyContinuationTable(game, strategy), strategy);
  near(collapsed.value[0], grade.value[0]); near(collapsed.value[1], grade.value[1]);
});

test("independent joint oracle agrees for varied policies, including unreachable own branches", () => {
  for (const mode of ["bet", "checkdown", "allin"] as const) {
    const game = tinyGame(mode), index = buildGameTreeIndex(game);
    for (let seed = 0; seed < 8; seed++) {
      const policy = new Map(index.informationSets.map((d, i) => {
        const probability = ((seed * 17 + i * 13) % 11) / 10;
        return [d.key, { actions: d.actions, probabilities: d.actions.length === 1 ? [1] : [probability, 1 - probability] }];
      }));
      const ours = gradeStrategy(game, policy, index), oracle = tinyOracleGrade(policy, mode);
      for (const p of [0, 1] as const) { near(ours.value[p], oracle.value[p]); near(ours.bestResponses[p].value, oracle.bestResponse[p]); }
    }
  }
});
