import assert from "node:assert/strict";
import { test } from "node:test";
import { createTurnGame, type TurnAction, type TurnState } from "../src/lib/solver/turn/game";
import { COMPACT_TURN_FIXTURES } from "../src/lib/solver/postflop/fixtures";
import { compileVectorTurn } from "../src/lib/solver/postflop/vector/game";
import { compileTurnV2 } from "../src/lib/solver/postflop/configurable-turn/game";
import { TURN_V2_CORPUS } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { createReadableTurnV2, type ReadableTurnV2State } from "../src/lib/solver/postflop/configurable-turn/readable";
import { initialTurnV2State, nextTurnV2Action, nextTurnV2River, turnV2Actions, turnV2InformationKey, validateTurnV2Request,
  type TurnV2Action, type TurnV2State, type TurnV2Request } from "../src/lib/solver/postflop/configurable-turn/rules";
import { oracleTurnV2Utility } from "../src/lib/solver/postflop/configurable-turn/oracle";
import { createVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { buildGameTreeIndex, uniformStrategy, type BehavioralStrategy, type ExtensiveFormGame } from "../src/lib/solver/toy/game";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { createConfigurableRiverV3Game, type ConfigurableRiverV3State, type ConfigurableRiverV3Scenario } from "../src/lib/solver/river/configurable-v3/game";
import { riverComboKey } from "../src/lib/solver/river/cards";
import { parseConfigurableRiverRange } from "../src/lib/solver/river/configurable/range";

const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${a} versus ${b}`);
const legacyAction = (action: TurnV2Action): TurnAction => action.startsWith("bet-") ? "bet" : action as TurnAction;
const legacyKey = (key: string) => key.replace("turn-v2:", "turn-v1:").replace(/bet-to-\d+/g, "bet");

for (const request of COMPACT_TURN_FIXTURES) test(`turn v1 reduction explicitly adapts each capped bet: ${request.id}`, () => {
  const old = createTurnGame(request);
  const modern: TurnV2Request = validateTurnV2Request({ id: request.id, version: 2, board: request.board, rangeText: request.rangeText,
    committedPerPlayer: request.committedPerPlayer, stackBehind: request.stackBehind,
    streets: request.betSizes.map(size => ({ openingTargets: [size], raiseTargets: [], raiseLimit: 0, includeAllIn: false })) });
  // ONLY the legacy adapter caps a target. The normal v2 menu still never clips.
  const at = (state: TurnV2State) => validateTurnV2Request({ ...modern, streets: modern.streets.map((menu, street) => ({ ...menu,
    openingTargets: [street === state.street && state.actor !== null
      ? Math.min(request.betSizes[street], request.stackBehind[state.actor] - state.carried - state.streetPaid[state.actor]) : request.betSizes[street]] })) });
  const visit = (a: TurnState, b: TurnV2State) => {
    const node = old.node(a);
    assert.equal(a.phase, b.phase); assert.equal(a.street, b.street); assert.equal(a.river, b.river); assert.equal(a.actor, b.actor);
    assert.deepEqual(a.histories, b.histories.map(line => line.map(legacyAction)));
    assert.equal(Math.min(...a.put), b.carried + Math.min(...b.streetPaid));
    if (node.kind === "terminal") {
      // Legacy payouts defer refunds; v2 refunds at closure. Compare NET risk, not gross state fields.
      const oracleRequest = { ...modern, streets: modern.streets.map((menu, street) => ({ ...menu,
        openingTargets: [...new Set(b.histories[street].filter(action => action.startsWith("bet-to-")).map(action => Number(action.slice(7))))] })) };
      // Oracle accepts an audit menu directly; a no-bet street uses its declared original target.
      const patched = { ...oracleRequest, streets: oracleRequest.streets.map((menu, street) => ({ ...menu,
        openingTargets: menu.openingTargets.length ? menu.openingTargets : modern.streets[street].openingTargets })) } as unknown as TurnV2Request;
      const expected = oracleTurnV2Utility(patched, b.histories, b.river, a.hands!);
      node.utility.forEach((v, p) => near(v, expected[p], 0)); return;
    }
    if (node.kind === "chance") {
      for (const row of node.outcomes) {
        if (row.outcome.kind !== "river") throw new Error("Expected river chance");
        visit(old.nextChance(a, row.outcome), nextTurnV2River(modern, b, row.outcome.card));
      }
      return;
    }
    const adapted = at(b), menu = turnV2Actions(adapted, b);
    assert.deepEqual(node.actions, menu.map(legacyAction));
    assert.equal(old.informationSet(a, node.player), legacyKey(turnV2InformationKey(modern, b, node.player, a.hands![node.player])));
    node.actions.forEach((action, i) => visit(old.nextAction(a, action), nextTurnV2Action(adapted, b, menu[i])));
  };
  for (const deal of old.deals) visit(old.nextChance(old.initialState(), deal.outcome), initialTurnV2State(modern));
});

test("unclipped single-size v2 reduces numerically to v1 through 100 ordinary CFR iterations", () => {
  const request = { ...COMPACT_TURN_FIXTURES[0], stackBehind: [200, 200] as const, betSizes: [25, 50] as const };
  const old = compileVectorTurn(request), modern = compileTurnV2({ id: request.id, version: 2, board: request.board,
    rangeText: request.rangeText, committedPerPlayer: request.committedPerPlayer, stackBehind: request.stackBehind,
    streets: request.betSizes.map(size => ({ openingTargets: [size], raiseTargets: [], raiseLimit: 0, includeAllIn: false })) });
  const a = createVectorTurnSession(old, { iterations: 100 }), b = createVectorTurnSession(modern, { iterations: 100 });
  const map = (policy: BehavioralStrategy<TurnV2Action>): BehavioralStrategy<TurnAction> => new Map([...policy].map(([key, row]) =>
    [legacyKey(key), { actions: row.actions.map(legacyAction), probabilities: row.probabilities }]));
  for (const n of [1, 2, 10, 100]) {
    a.advance(n - a.iterations); b.advance(n - b.iterations);
    const x = a.snapshot(), y = b.snapshot();
    for (const field of ["currentStrategy", "averageStrategy"] as const) for (const [key, row] of map(y[field])) {
      assert.deepEqual(row.actions, x[field].get(key)!.actions);
      row.probabilities.forEach((v, i) => near(v, x[field].get(key)!.probabilities[i]));
    }
    for (const [key, row] of y.cumulativeRegrets) row.forEach((v, i) => near(v, x.cumulativeRegrets.get(legacyKey(key))![i], 1e-9 * n * 250));
    const left = gradeVectorTurn(old, x.averageStrategy), right = gradeVectorTurn(modern, y.averageStrategy);
    near(left.exploitability, right.exploitability, 2.5e-8);
  }
});

test("joint-turn continuations reduce to river v3 with action-conditioned weights and river blockers", () => {
  const request = TURN_V2_CORPUS[1], readable = createReadableTurnV2(request);
  const originalIndex = buildGameTreeIndex(readable, { maxStates: 100_000 });
  const policy = new Map(uniformStrategy(originalIndex));
  let seed = 831;
  for (const [key, row] of policy) {
    const weights = row.actions.map(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 0.05 + seed / 2 ** 32; });
    const sum = weights.reduce((a, b) => a + b, 0);
    policy.set(key, { actions: row.actions, probabilities: weights.map(w => w / sum) });
  }
  for (const history of [["check", "check"], ["bet-to-25", "call"], ["check", "bet-to-50", "call"]] as const) {
    for (const river of ["3c", "Ah", "Qd"] as const) {
      let end = initialTurnV2State(request);
      for (const action of history) end = nextTurnV2Action(request, end, action);
      const root = nextTurnV2River(request, end, river);
      const ranges = request.rangeText.map((text, p) => parseConfigurableRiverRange(text, request.board).entries
        .filter(entry => !entry.cards.includes(river)).map(entry => {
          let state = initialTurnV2State(request), weight = entry.weight;
          for (const action of history) {
            if (state.actor === p) {
              const row = policy.get(turnV2InformationKey(request, state, p as 0 | 1, entry.cards))!;
              weight *= row.probabilities[row.actions.indexOf(action)];
            }
            state = nextTurnV2Action(request, state, action);
          }
          return { ...entry, weight };
        })) as unknown as ConfigurableRiverV3Scenario["ranges"];
      const v3 = createConfigurableRiverV3Game({ id: "turn-v2-river-reduction", version: 3, board: [...request.board, river], ranges,
        committed: [request.committedPerPlayer + end.carried, request.committedPerPlayer + end.carried],
        stackBehind: [request.stackBehind[0] - end.carried, request.stackBehind[1] - end.carried],
        positions: ["out-of-position", "in-position"], actionOrder: [0, 1], openingBetSizes: request.streets[1].openingTargets,
        raiseToSizes: request.streets[1].raiseTargets, maxRaises: 1 });
      // Independently condition the original deal distribution on both action reaches AND the river.
      const raw = readable.deals.filter(deal => !deal.outcome.hands.some(hand => hand.includes(river))).map(deal => {
        let state = readable.nextChance(readable.initialState(), deal.outcome), mass = deal.probability;
        for (const action of history) {
          const actor = state.public.actor!, row = policy.get(readable.informationSet(state, actor))!;
          mass *= row.probabilities[row.actions.indexOf(action)]; state = readable.nextAction(state, action);
        }
        return { outcome: deal.outcome, probability: mass };
      });
      const mass = raw.reduce((sum, row) => sum + row.probability, 0);
      const outcomes = raw.map(row => ({ ...row, probability: row.probability / mass }));
      for (const deal of v3.deals) {
        const match = outcomes.find(row => row.outcome.hands.map(riverComboKey).join("/") === deal.outcome.hands.map(riverComboKey).join("/"))!;
        near(deal.probability, match.probability, 1e-12);
      }
      const continuation: ExtensiveFormGame<ReadableTurnV2State, TurnV2Action, typeof outcomes[number]["outcome"]> = {
        id: "conditional-turn-v2", initialState: () => ({ public: root, hands: null }),
        node(state) {
          if (!state.hands) return { kind: "chance", outcomes };
          const node = readable.node(state);
          if (node.kind === "chance") throw new Error("No further chance after the fixed river");
          return node;
        },
        nextChance: (_, outcome) => ({ public: root, hands: outcome.hands }),
        nextAction: readable.nextAction, informationSet: readable.informationSet,
      };
      const v2Index = buildGameTreeIndex(continuation), v2Policy = new Map(v2Index.informationSets.map(info => [info.key, policy.get(info.key)!]));
      const mapped = new Map<string, { actions: readonly TurnV2Action[]; probabilities: readonly number[] }>();
      const compare = (a: ReadableTurnV2State, b: ConfigurableRiverV3State) => {
        const left = continuation.node(a), right = v3.node(b);
        assert.equal(left.kind, right.kind);
        if (left.kind === "terminal" && right.kind === "terminal") left.utility.forEach((v, p) => near(v, right.utility[p], 0));
        else if (left.kind === "player" && right.kind === "player") {
          assert.deepEqual(left.actions, right.actions);
          mapped.set(v3.informationSet(b, right.player), v2Policy.get(continuation.informationSet(a, left.player))!);
          left.actions.forEach(action => compare(continuation.nextAction(a, action), v3.nextAction(b, action)));
        }
      };
      for (const deal of v3.deals) compare({ public: root, hands: deal.outcome.hands }, v3.nextChance(v3.initialState(), deal.outcome));
      const a = gradeStrategy(continuation, v2Policy), b = gradeStrategy(v3, mapped);
      for (const p of [0, 1] as const) {
        near(a.value[p], b.value[p], 1.5e-8); near(a.bestResponses[p].value, b.bestResponses[p].value, 1.5e-8);
      }
    }
  }
});
