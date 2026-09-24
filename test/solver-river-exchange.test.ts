import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import fc from "fast-check";
import { canonicalSolverJson, deserializeBehavioralStrategy, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { uniformStrategy, type BehavioralStrategy } from "../src/lib/solver/toy/game";
import { riverComboKey } from "../src/lib/solver/river/cards";
import type { ConfigurableRiverAction } from "../src/lib/solver/river/configurable/game";
import acceptedV3 from "../src/lib/solver/river/configurable-v3/artifacts/configurable-river-v3.json";
import { oracleConfigurableRiverV3Utility } from "../src/lib/solver/river/configurable-v3/oracle";
import { FACTORIZED_RIVER_WIDE_REQUEST } from "../src/lib/solver/river/factorized/fixture";
import { solveCompiledFactorizedRiverCfr } from "../src/lib/solver/river/factorized/cfr";
import { RIVER_BENCHMARKS, RIVER_BENCHMARK_SUITE_VERSION, riverBenchmark } from "../src/lib/solver/river/exchange/catalog";
import { createRiverBenchmarkManifest } from "../src/lib/solver/river/exchange/benchmarks-node";
import {
  exportRiverPolicy, gradeRiverPolicy, hashRiverExchange, importRiverPolicy, prepareRiverExchange,
  stringifyRiverExchange, type PreparedRiverExchange,
} from "../src/lib/solver/river/exchange/exchange-node";
import type { RiverExchangeGame, RiverExchangePolicy } from "../src/lib/solver/river/exchange/types";

const near = (left: number, right: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(left - right) <= tolerance, `${left} != ${right}`);
const small = prepareRiverExchange(riverBenchmark("weighted-blockers").request);
const fresh = () => structuredClone(exportRiverPolicy(small, uniformStrategy(small.compiled.index)));
type MutablePolicy = {
  format: unknown; schemaVersion: unknown; gameFingerprint: unknown; units: unknown;
  strategy: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};
const mutable = () => fresh() as unknown as MutablePolicy;
const firstKey = small.compiled.index.informationSets[0].key;
const firstAction = small.compiled.index.informationSets[0].actions[0];

/** Consumer of the JSON contract only: no compiled arrays, game transitions, or evaluator. */
function exportedValue(game: RiverExchangeGame, policy: RiverExchangePolicy): number {
  const coordinates = new Map(game.informationSets.map(info => [
    `${info.publicNode}/${info.privateCards.join("")}`, info.key,
  ]));
  function visit(nodeId: number, dealId: number): number {
    const node = game.publicTree[nodeId];
    if (node.kind === "terminal") return node.utility0ByDeal[dealId];
    const ownCards = game.chanceDeals[dealId].hands[node.player].join("");
    const informationSet = coordinates.get(`${nodeId}/${ownCards}`)!;
    return node.edges.reduce((value, edge) => value +
      policy.strategy[informationSet][edge.action]! * visit(edge.child, dealId), 0);
  }
  return game.chanceDeals.reduce((value, deal, id) => value + deal.probability * visit(0, id), 0);
}

function mixedStrategy(prepared: PreparedRiverExchange, seed: number): BehavioralStrategy<ConfigurableRiverAction> {
  return new Map(prepared.compiled.index.informationSets.map((entry, index) => {
    const weights = entry.actions.map((_, action) => 1 + ((seed * 7 + index * 11 + action * 19) % 53));
    const total = weights.reduce((a, b) => a + b, 0);
    return [entry.key, { actions: entry.actions, probabilities: weights.map(weight => weight / total) }];
  }));
}

for (const benchmark of RIVER_BENCHMARKS) {
  test(`${benchmark.id}: every exported deal, edge, information set, and payoff agrees with the game and oracle`, () => {
    const { game, exported } = prepareRiverExchange(benchmark.request);
    const portable = JSON.parse(stringifyRiverExchange(exported)) as RiverExchangeGame;
    const { gameFingerprint, ...payload } = portable;
    assert.equal(hashRiverExchange(payload), gameFingerprint);
    near(portable.chanceDeals.reduce((sum, deal) => sum + deal.probability, 0), 1, 1e-12);
    assert.deepEqual(portable.counts, {
      compatibleDeals: game.deals.length, publicStates: game.preflight.publicStatesPerDeal,
      equivalentRepeatedStates: game.preflight.projectedFullStates,
      informationSets: portable.informationSets.length, terminalStates: game.preflight.projectedTerminalStates,
    });
    assert.deepEqual(portable.chanceDeals, game.deals.map(deal => ({ hands: deal.outcome.hands, probability: deal.probability })));
    for (const [dealIndex, deal] of portable.chanceDeals.entries()) {
      const cards = [...game.scenario.board, ...deal.hands.flat()];
      assert.equal(new Set(cards).size, 9);
      for (const [nodeIndex, publicNode] of portable.publicTree.entries()) {
        assert.equal(publicNode.id, nodeIndex);
        let state = game.nextChance(game.initialState(), { hands: deal.hands });
        for (const action of publicNode.history) state = game.nextAction(state, action);
        const node = game.node(state);
        assert.equal(node.kind, publicNode.kind);
        if (node.kind === "terminal" && publicNode.kind === "terminal") {
          near(publicNode.utility0ByDeal[dealIndex], node.utility[0]);
          const oracle = oracleConfigurableRiverV3Utility(game.scenario, deal.hands, publicNode.history);
          near(publicNode.utility0ByDeal[dealIndex], oracle[0]);
          near(-publicNode.utility0ByDeal[dealIndex], oracle[1]);
        } else if (node.kind === "player" && publicNode.kind === "player") {
          assert.equal(publicNode.player, node.player);
          assert.deepEqual(publicNode.edges.map(edge => edge.action), node.actions);
          for (const edge of publicNode.edges) {
            assert.deepEqual(portable.publicTree[edge.child].history, [...publicNode.history, edge.action]);
          }
          const info = portable.informationSets.filter(entry => entry.publicNode === publicNode.id &&
            riverComboKey(entry.privateCards) === riverComboKey(deal.hands[node.player]));
          assert.equal(info.length, 1); // The same own hand never splits by the opponent's cards.
          assert.equal(info[0].key, game.informationSet(state, node.player));
          assert.deepEqual(Object.keys(info[0]).sort(), ["actions", "key", "player", "privateCards", "publicNode"]);
          assert.deepEqual(info[0].actions, node.actions);
        }
      }
    }
  });

  test(`${benchmark.id}: generated imported policies match readable grades and a JSON-only consumer`, () => {
    const prepared = prepareRiverExchange(benchmark.request);
    fc.assert(fc.property(fc.integer({ min: 1, max: 100_000 }), seed => {
      const strategy = mixedStrategy(prepared, seed);
      const policy = exportRiverPolicy(prepared, strategy);
      const report = gradeRiverPolicy(prepared, JSON.parse(stringifyRiverExchange(policy)));
      const readable = gradeStrategy(prepared.game, strategy);
      report.value.forEach((value, player) => near(value, readable.value[player]));
      report.bestResponseValue.forEach((value, player) => near(value, readable.bestResponses[player].value));
      report.gains.forEach((value, player) => near(value, readable.gains[player]));
      near(report.exploitability, readable.exploitability);
      near(report.value[0], exportedValue(prepared.exported, policy));
      near(report.value[0] + report.value[1], 0);
      near(report.nashGap, report.gains[0] + report.gains[1]);
      near(report.exploitability, report.nashGap / 2);
    }), { numRuns: 8, seed: 20260922 });
  });
}

test("accepted v3 CPU policy survives JSON round trip with identical bytes and grade", () => {
  const benchmark = riverBenchmark("v3-two-raise");
  const prepared = prepareRiverExchange(benchmark.request);
  const result = solveCompiledFactorizedRiverCfr(prepared.compiled, benchmark.solver);
  const policy = exportRiverPolicy(prepared, result.averageStrategy);
  assert.equal(canonicalSolverJson(policy.strategy), canonicalSolverJson(acceptedV3.strategy));
  const imported = importRiverPolicy(prepared, JSON.parse(stringifyRiverExchange(policy)));
  assert.deepEqual(serializeBehavioralStrategy(imported), policy.strategy);
  const reference = deserializeBehavioralStrategy(prepared.compiled.index, acceptedV3.strategy);
  assert.deepEqual(gradeRiverPolicy(prepared, policy), gradeRiverPolicy(prepared, exportRiverPolicy(prepared, reference)));
  const grade = gradeRiverPolicy(prepared, policy);
  assert.deepEqual(grade.value, acceptedV3.value);
  assert.deepEqual(grade.gains, acceptedV3.gains);
  assert.equal(grade.exploitability, acceptedV3.exploitability);
});

test("benchmark manifest file name, suite version, and pinned tree sizes move together", () => {
  // A tree or solver change must bump RIVER_BENCHMARK_SUITE_VERSION, which renames the manifest.
  assert.deepEqual(readdirSync("src/lib/solver/river/exchange/artifacts"), [`benchmarks-v${RIVER_BENCHMARK_SUITE_VERSION}.json`]);
  const manifest = JSON.parse(readFileSync(`src/lib/solver/river/exchange/artifacts/benchmarks-v${RIVER_BENCHMARK_SUITE_VERSION}.json`, "utf8"));
  assert.equal(manifest.suiteVersion, RIVER_BENCHMARK_SUITE_VERSION);
  const statesBySuite: Record<number, Record<string, number>> = {
    // v2 (2026-09-24): uncallable overbets collapse to one bet-to-their-stack action.
    2: { "v3-two-raise": 11_089, "weighted-blockers": 169, "short-all-in": 121, "board-ties": 64 },
  };
  assert.deepEqual(
    Object.fromEntries(manifest.benchmarks.map((item: { id: string; counts: { equivalentRepeatedStates: number } }) =>
      [item.id, item.counts.equivalentRepeatedStates])),
    statesBySuite[RIVER_BENCHMARK_SUITE_VERSION],
  );
});

test("benchmark manifest reproduces twice, with fixed settings and no elapsed-time fields", () => {
  const expected = readFileSync(`src/lib/solver/river/exchange/artifacts/benchmarks-v${RIVER_BENCHMARK_SUITE_VERSION}.json`, "utf8");
  const first = stringifyRiverExchange(createRiverBenchmarkManifest());
  assert.equal(first, expected);
  assert.equal(stringifyRiverExchange(createRiverBenchmarkManifest()), first);
  assert.doesNotMatch(first, /elapsed|timestamp|duration|runtime/i);
});

test("exchange fingerprints bind cards, weights, stacks, sizes, raise limit, units, and payoffs", () => {
  const request = riverBenchmark("weighted-blockers").request;
  for (const changed of [
    { ...request, board: ["Ks", "8s", "4s", "2c", "9h"] as const },
    { ...request, rangeText: ["AsQs:4 AhAd:2 7h6h:1", request.rangeText[1]] as const },
    { ...request, stackBehind: [90, 100] as const },
    { ...request, openingBetSizes: [25, 50, 100] },
    { ...request, raiseToSizes: [90, 100] },
    { ...request, maxRaises: 0 as const },
    { ...request, committed: [40, 40] as const },
  ]) {
    const other = prepareRiverExchange(changed);
    assert.notEqual(other.exported.gameFingerprint, small.exported.gameFingerprint);
    assert.throws(() => importRiverPolicy(other, fresh()), /fingerprint/);
  }
  const { gameFingerprint, ...payload } = structuredClone(small.exported);
  assert.notEqual(hashRiverExchange({ ...payload, conventions: { ...payload.conventions, units: "bb" } }), gameFingerprint);
  const terminal = payload.publicTree.find(node => node.kind === "terminal")!;
  assert.equal(terminal.kind, "terminal");
  if (terminal.kind === "terminal") (terminal.utility0ByDeal as number[])[0] += 1;
  assert.notEqual(hashRiverExchange(payload), gameFingerprint);
});

test("reordering object keys does not change the policy identity or grade", () => {
  const policy = fresh();
  const reordered = { ...policy, strategy: Object.fromEntries(Object.entries(policy.strategy).reverse().map(
    ([key, actions]) => [key, Object.fromEntries(Object.entries(actions).reverse())],
  )) };
  assert.deepEqual(gradeRiverPolicy(small, reordered), gradeRiverPolicy(small, policy));
});

const corruptions: readonly [string, (policy: MutablePolicy) => void][] = [
  ["wrong format", p => { p.format = "value-predictions"; }],
  ["wrong version", p => { p.schemaVersion = 2; }],
  ["wrong fingerprint", p => { p.gameFingerprint = "0".repeat(64); }],
  ["wrong units", p => { p.units = "big-blinds"; }],
  ["extra root field", p => { p.selfReportedExploitability = 0; }],
  ["missing root field", p => { delete p.units; }],
  ["missing information set", p => { delete p.strategy[firstKey]; }],
  ["unknown information set", p => { p.strategy.cheating = { fold: 1 }; }],
  ["missing legal action", p => { delete p.strategy[firstKey][firstAction]; }],
  ["unknown legal action", p => { p.strategy[firstKey]["bet-to-999"] = 0; }],
  ["opponent cards in a decision", p => { p.strategy[firstKey].opponentCards = ["As", "Ts"]; }],
  ["array instead of probabilities", p => { p.strategy[firstKey] = [] as unknown as Record<string, unknown>; }],
  ["zero total", p => { for (const action of Object.keys(p.strategy[firstKey])) p.strategy[firstKey][action] = 0; }],
  ["rounded frequencies", p => { p.strategy[firstKey][firstAction] = Number(p.strategy[firstKey][firstAction]) + 1e-8; }],
];
for (const [label, corrupt] of corruptions) {
  test(`policy import rejects ${label} instead of returning a quality score`, () => {
    const policy = mutable();
    corrupt(policy);
    assert.throws(() => gradeRiverPolicy(small, policy));
  });
}

test("invalid probability types, non-finite numbers, and tiny out-of-bounds values are rejected", () => {
  for (const value of [NaN, Infinity, -Infinity, -1e-15, 1 + 1e-15, "0.5", null, undefined, [], {}, true]) {
    const policy = mutable();
    policy.strategy[firstKey][firstAction] = value;
    assert.throws(() => importRiverPolicy(small, policy), /finite number/);
  }
  for (const input of [null, [], 1, "policy", Object.create({ strategy: fresh().strategy })]) {
    assert.throws(() => importRiverPolicy(small, input));
  }
});

test("zero-probability actions and off-path decisions remain required but valid", () => {
  const pure = new Map(small.compiled.index.informationSets.map(entry => [
    entry.key, { actions: entry.actions, probabilities: entry.actions.map((_, i) => i === 0 ? 1 : 0) },
  ]));
  const policy = exportRiverPolicy(small, pure);
  const grade = gradeRiverPolicy(small, policy);
  const readable = gradeStrategy(small.game, pure);
  near(grade.exploitability, readable.exploitability);
  const last = small.compiled.index.informationSets.at(-1)!;
  const incomplete = structuredClone(policy) as unknown as MutablePolicy;
  delete incomplete.strategy[last.key];
  assert.throws(() => importRiverPolicy(small, incomplete), /information sets/);
});

test("a deliberately cheating per-deal policy cannot replace one choice per information set", () => {
  const policy = mutable();
  policy.strategy = Object.fromEntries(small.exported.chanceDeals.flatMap(deal =>
    small.exported.informationSets.map(info => [
      `${info.key}|opponent=${deal.hands[1 - info.player].join("")}`, { ...fresh().strategy[info.key] },
    ]),
  ));
  assert.throws(() => importRiverPolicy(small, policy), /information sets/);
});

test("prototype-like JSON keys cannot smuggle extra policy information", () => {
  const policy = mutable();
  policy.strategy[firstKey] = JSON.parse('{"__proto__":{"fold":1},"check":1}');
  assert.throws(() => importRiverPolicy(small, policy), /required keys/);
  assert.equal(Object.hasOwn({}, "fold"), false);
});

test("exchange keeps its smaller state cap and rejects unknown benchmark IDs", () => {
  assert.throws(() => prepareRiverExchange({ ...FACTORIZED_RIVER_WIDE_REQUEST, maxRaises: 1 }), /100000/);
  assert.throws(() => riverBenchmark("not-real"), /Unknown river benchmark/);
});
