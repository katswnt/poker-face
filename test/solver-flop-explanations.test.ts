import assert from "node:assert/strict";
import { test } from "node:test";
import { handScore } from "../src/lib/poker/eval";
import { RIVER_DECK, riverCardObject, riverComboKey, type RiverCard } from "../src/lib/solver/river/cards";
import { FLOP_REFERENCE_REQUEST } from "../src/lib/solver/postflop/flop/fixtures";
import { compileVectorFlop } from "../src/lib/solver/postflop/flop/compiled";
import { createVectorFlopSession } from "../src/lib/solver/postflop/flop/session";
import { decodeFlopPolicy } from "../src/lib/solver/postflop/flop/policy";
import { createFlopReference, type FlopReferenceState } from "../src/lib/solver/postflop/flop/reference";
import { flopInformationKey } from "../src/lib/solver/postflop/flop/rules";
import { gradeVectorFlop } from "../src/lib/solver/postflop/flop/scorekeeper";
import { deriveFlopFront } from "../src/lib/solver/postflop/flop-library/derive";
import { FLOP_CONDITIONAL_MIN } from "../src/lib/solver/postflop/flop-library/model";
import { inspectSavedFlopRiver } from "../src/lib/solver/postflop/flop-library/river";
import type { FlopRangeContext } from "../src/lib/solver/postflop/flop-library/query";

const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < tolerance, `${a} != ${b}`);
const request = { ...FLOP_REFERENCE_REQUEST, stackBehind: [1, 2] as const, betSizes: [1, 1, 1] as const };
const inspectedRivers = new Set(["3c", "2s", "Kh"]); // Blank, flush completion, and a paired board/private blocker.

test("streamed flop/turn and worker river explanations match a separate repeated-state conditional evaluation", () => {
  const game = compileVectorFlop(request), session = createVectorFlopSession(game, { iterations: 3, algorithm: "cfr-plus", averagingDelay: 1 });
  session.advance(3); const flat = session.snapshot().policy, policy = decodeFlopPolicy(game, flat);
  const derived = deriveFlopFront(game, flat), reference = createFlopReference(request);
  const facts = new Map<string, { reach: number; actions: number[][]; equity: number }>();
  const equityCache = new Map<string, Map<string, number>>();
  const staticShare = (state: FlopReferenceState) => {
    const hands = state.hands!, id = hands.map(riverComboKey).join("/");
    if (state.public.river) {
      const board = [...request.board, state.public.turn!, state.public.river];
      return (1 + Math.sign(handScore(hands[0].map(riverCardObject), board.map(riverCardObject)) - handScore(hands[1].map(riverCardObject), board.map(riverCardObject)))) / 2;
    }
    if (!equityCache.has(id)) {
      const used = [...request.board, ...hands.flat()], deck = RIVER_DECK.filter(c => !used.includes(c));
      const sums = new Map<string, number>([["flop", 0]]), wins = new Map<string, number>();
      for (const turn of deck) for (const river of deck) if (turn !== river) {
        const key = [turn, river].sort().join("");
        if (!wins.has(key)) {
          const board = [...request.board, turn, river];
          wins.set(key, (1 + Math.sign(handScore(hands[0].map(riverCardObject), board.map(riverCardObject)) - handScore(hands[1].map(riverCardObject), board.map(riverCardObject)))) / 2);
        }
        const share = wins.get(key)!; sums.set(turn, (sums.get(turn) ?? 0) + share / 44); sums.set("flop", sums.get("flop")! + share / 1980);
      }
      equityCache.set(id, sums);
    }
    return equityCache.get(id)!.get(state.public.turn ?? "flop")!;
  };
  const walk = (state: FlopReferenceState, mass: number): number[] => {
    const node = reference.node(state);
    if (node.kind === "terminal") {
      const value = [node.utility[0], 0, 0, 0, 0, 0], folded = state.public.folded;
      value[folded === 0 ? 1 : folded === 1 ? 2 : node.utility[0] > 0 ? 3 : node.utility[0] === 0 ? 4 : 5] = 1; return value;
    }
    if (node.kind === "chance") {
      const result = Array<number>(6).fill(0);
      for (const chance of node.outcomes) { const next = walk(reference.nextChance(state, chance.outcome), mass * chance.probability); next.forEach((v, k) => { result[k] += chance.probability * v; }); }
      return result;
    }
    const key = reference.informationSet(state, node.player), row = policy.get(key)!.probabilities;
    const children = node.actions.map((action, a) => walk(reference.nextAction(state, action), mass * row[a]));
    if (state.public.street < 2 || state.public.turn === "2c" && inspectedRivers.has(state.public.river!)) {
      const fact = facts.get(key) ?? { reach: 0, equity: 0, actions: children.map(() => Array<number>(6).fill(0)) };
      fact.reach += mass; const share = staticShare(state); fact.equity += mass * (node.player === 0 ? share : 1 - share);
      children.forEach((values, a) => values.forEach((v, k) => { fact.actions[a][k] += mass * v; })); facts.set(key, fact);
    }
    return children[0].map((_, k) => children.reduce((sum, v, a) => sum + v[k] * row[a], 0));
  };
  const root = walk(reference.initialState(), 1); near(derived.rootValue0, root[0]); near(derived.rootValue0, gradeVectorFlop(game, flat).value[0]);
  const selected = new Map(game.states.flatMap((s, n) => s.street === 0 || s.turn === "2c" && (s.street === 1 || inspectedRivers.has(s.river!)) ? [[n, derived.node(n)] as const] : []));
  const context: FlopRangeContext = { request, hands: game.ranges.players.map(p => p.hands.map(riverComboKey)) as FlopRangeContext["hands"],
    weights: game.ranges.players.map(p => Array.from(p.weights)) as FlopRangeContext["weights"] };
  const inspected = new Map([...selected.values()].filter(n => n.state.street === 2 && selected.get(n.parent!)!.state.street === 1)
    .flatMap(n => inspectSavedFlopRiver(context, n, selected).nodes.map(n => [n.id, n] as const)));
  let checked = 0;
  for (const [n, state] of game.states.entries()) {
    if (state.street === 2 && !inspected.has(n)) continue;
    const view = inspected.get(n) ?? derived.node(n);
    if (state.phase === "card" && view.summary!.reach > FLOP_CONDITIONAL_MIN) {
      near(view.edges.reduce((sum, e) => sum + e.preview!.reach / view.summary!.reach, 0), 1);
      near(view.edges.reduce((sum, e) => sum + (e.preview!.value0 ?? 0) * e.preview!.reach / view.summary!.reach, 0), view.summary!.value0!);
    }
    for (const hand of view.hands) {
      const actor = state.actor!, key = flopInformationKey(request, state, actor, game.ranges.players[actor].hands[hand.hand]), expected = facts.get(key)!;
      checked++; near(hand.reach, expected.reach);
      if (hand.reach <= FLOP_CONDITIONAL_MIN) { assert.equal(hand.checkdownShare, null); hand.actions.forEach(a => assert.equal(a.ev, null)); continue; }
      near(hand.checkdownShare!, expected.equity / expected.reach);
      hand.actions.forEach((action, a) => {
        const values = expected.actions[a].map(v => v / expected.reach), outcomes = actor === 0 ? values.slice(1) : [values[2], values[1], values[5], values[4], values[3]];
        near(action.ev!, values[0] * (actor === 0 ? 1 : -1)); action.outcomes!.forEach((v, k) => near(v, outcomes[k])); near(action.outcomes!.reduce((x, y) => x + y, 0), 1);
      });
    }
  }
  assert.equal(checked, facts.size); assert.ok(checked > 100);
});

test("front slices keep the saved policy exact and do not store full river explanations", () => {
  const game = compileVectorFlop(request), session = createVectorFlopSession(game, { iterations: 1 }); session.advance(1);
  const policy = session.snapshot().policy, derived = deriveFlopFront(game, policy), roots = new Set<number>();
  for (const [n, state] of game.states.entries()) {
    const view = derived.node(n); if (state.street === 2) { assert.equal(view.summary, null); assert.equal(view.hands.length, 0); }
    if (view.policy) view.policy.forEach((row, h) => row.forEach((p, a) => assert.equal(p, policy[game.actionStarts[n] + 2 * h + a])));
    if (state.phase === "card" && state.street === 0) { assert.equal(view.edges.length, 49); roots.add(n); }
  }
  assert.ok(roots.size > 0); assert.ok(derived.workingBytes < 32 * 1024 ** 2);
  const root = derived.node(0); assert.equal(root.parent, null); assert.equal(root.summary!.support, 3);
  assert.equal(root.state.turn, null); assert.equal(root.state.river, null);
  const turns = game.ranges.deck as readonly RiverCard[]; assert.equal(turns.length, 49);
});
