import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGameTreeIndex, uniformStrategy, type ExtensiveFormGame } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { solveCompactCfr } from "../src/lib/solver/river/compact/cfr";
import { compileCompactScorekeeper, gradeCompactStrategy } from "../src/lib/solver/river/compact/scorekeeper";
import { deserializeBehavioralStrategy, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { RIVER_DECK, riverComboKey, type RiverCard } from "../src/lib/solver/river/cards";
import { createFlopReference, type FlopChance, type FlopReference, type FlopReferenceState } from "../src/lib/solver/postflop/flop/reference";
import { FLOP_REFERENCE_REQUEST } from "../src/lib/solver/postflop/flop/fixtures";
import type { FlopAction } from "../src/lib/solver/postflop/flop/rules";
const near = (a: number, b: number) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-8, `${a} != ${b}`);

function responseGame(onTurn = false): FlopReference {
  const base = createFlopReference({ ...FLOP_REFERENCE_REQUEST, stackBehind: [50, 50], betSizes: [50, 50, 50] });
  return { ...base, node(state) {
    const n = base.node(state), p = state.public;
    if (n.kind !== "player") return n;
    if (onTurn && p.street === 0) return { ...n, actions: ["check"] };
    return p.histories[p.street].length === 0 ? { ...n, actions: ["bet"] } : n;
  } };
}
type PredealtState = { base: FlopReferenceState; future: readonly [RiverCard, RiverCard] | null };
type PredealtChance = { kind: "predeal"; deal: FlopChance; future: readonly [RiverCard, RiverCard] } | { kind: "reveal"; card: RiverCard };
function predealt(base: FlopReference, cheat: "none" | "turn" | "river" | "both" | "opponent"): ExtensiveFormGame<PredealtState, FlopAction, PredealtChance> {
  return { id: `flop-predeal-${cheat}`, initialState: () => ({ base: base.initialState(), future: null }),
    node(state) {
      const n = base.node(state.base);
      if (n.kind !== "chance") return n;
      if (state.future) {
        if (state.base.public.street === 2) throw Error("No future card after river");
        return { kind: "chance", outcomes: [{ outcome: { kind: "reveal", card: state.future[state.base.public.street] }, probability: 1 }] };
      }
      return { kind: "chance", outcomes: base.deals.flatMap(deal => {
        const deck = RIVER_DECK.filter(c => ![...base.request.board, ...deal.outcome.hands.flat()].includes(c));
        return deck.flatMap(turn => deck.filter(c => c !== turn).map(river => ({
          outcome: { kind: "predeal" as const, deal: deal.outcome, future: [turn, river] as const }, probability: deal.probability / 1980 })));
      }) };
    },
    nextChance(state, outcome) { return outcome.kind === "predeal"
      ? { base: base.nextChance(state.base, outcome.deal), future: outcome.future }
      : { ...state, base: base.nextChance(state.base, { kind: "card", card: outcome.card }) }; },
    nextAction: (s, a) => ({ ...s, base: base.nextAction(s.base, a) }),
    informationSet(state, player) {
      const p = state.base.public, key = base.informationSet(state.base, player);
      const futureTurn = (cheat === "turn" || cheat === "both") && p.street === 0 ? `:peek-turn=${state.future![0]}` : "";
      const futureRiver = (cheat === "river" || cheat === "both") && p.street < 2 ? `:peek-river=${state.future![1]}` : "";
      return key + futureTurn + futureRiver + (cheat === "opponent" ? `:peek-hand=${riverComboKey(state.base.hands![1 - player])}` : "");
    },
  };
}

test("flop legal best responses equal exhaustive policies; invisible predealing changes nothing", () => {
  const game = responseGame(), index = buildGameTreeIndex(game), profile = uniformStrategy(index);
  const normal = gradeStrategy(game, profile, index);
  const exhaustive = gradeStrategy(game, profile, index, { bestResponseMethod: "exhaustive", maxPureStrategies: 4 });
  assert.equal(exhaustive.bestResponses[1].pureStrategiesChecked, 4);
  for (const p of [0, 1]) near(normal.bestResponses[p].value, exhaustive.bestResponses[p].value);
  const hidden = gradeStrategy(predealt(game, "none"), profile);
  near(normal.value[0], hidden.value[0]); near(normal.exploitability, hidden.exploitability);
  const compact = solveCompactCfr(game, { iterations: 1 });
  const grade = gradeCompactStrategy(compileCompactScorekeeper(compact.compiled), profile);
  near(grade.value[0], normal.value[0]); near(grade.exploitability, normal.exploitability);
});

test("seeing either future card or the opposing hand grants an unattainable flop advantage", () => {
  const game = responseGame(), normal = gradeStrategy(game, uniformStrategy(buildGameTreeIndex(game)));
  for (const mode of ["turn", "river", "both", "opponent"] as const) {
    const cheating = predealt(game, mode), grade = gradeStrategy(cheating, uniformStrategy(buildGameTreeIndex(cheating)));
    assert.ok(grade.bestResponses[1].value > normal.bestResponses[1].value + 1, `${mode} peeking must have a positive detectable advantage`);
  }
});

test("after flop actions, turn decisions still cannot peek at the river", () => {
  const game = responseGame(true), profile = uniformStrategy(buildGameTreeIndex(game));
  const normal = gradeStrategy(game, profile), hidden = gradeStrategy(predealt(game, "none"), profile);
  near(hidden.bestResponses[1].value, normal.bestResponses[1].value);
  const cheating = predealt(game, "river"), grade = gradeStrategy(cheating, uniformStrategy(buildGameTreeIndex(cheating)));
  assert.ok(grade.bestResponses[1].value > normal.bestResponses[1].value + 1);
});

test("flop policies reject hidden-card keys, incomplete entries, NaNs and wrong probabilities", () => {
  const game = responseGame(), index = buildGameTreeIndex(game), profile = uniformStrategy(index), rows = serializeBehavioralStrategy(profile);
  assert.deepEqual(deserializeBehavioralStrategy(index, rows), profile);
  const key = Object.keys(rows)[0], action = index.informationSetByKey.get(key)!.actions[0];
  assert.throws(() => deserializeBehavioralStrategy(index, { ...rows, [`${key}:future=As`]: rows[key] }), /information sets/);
  for (const bad of [NaN, -1, 2]) assert.throws(() => deserializeBehavioralStrategy(index, { ...rows, [key]: { ...rows[key], [action]: bad } }));
  const missing = { ...rows }; delete missing[key]; assert.throws(() => deserializeBehavioralStrategy(index, missing));
});

test("flop all-in values are invariant to common weight scales and suit relabeling; board ties split", () => {
  const input = { ...FLOP_REFERENCE_REQUEST, stackBehind: [0, 75] as const };
  const grade = (g: FlopReference) => gradeStrategy(g, uniformStrategy(buildGameTreeIndex(g))).value[0];
  near(grade(createFlopReference(input)), grade(createFlopReference({ ...input, rangeText: ["AsQs:5 KdKh:10", "QsJs:7 9h9d:14"] })));
  const swap = (s: string) => s.replace(/[sc]/g, c => c === "s" ? "c" : "s");
  near(grade(createFlopReference(input)), grade(createFlopReference({ ...input, board: input.board.map(swap) as unknown as typeof input.board,
    rangeText: input.rangeText.map(swap) as unknown as typeof input.rangeText })));
  const tie = createFlopReference({ ...input, board: ["As", "Ks", "Qs"], rangeText: ["2c3c", "4d5d"] });
  let state = tie.nextChance(tie.initialState(), tie.deals[0].outcome);
  state = tie.nextChance(state, { kind: "card", card: "Js" }); state = tie.nextChance(state, { kind: "card", card: "Ts" });
  assert.deepEqual(tie.settlement(state).utility, [0, 0]); assert.deepEqual(tie.settlement(state).awards, [50, 50]);
});
