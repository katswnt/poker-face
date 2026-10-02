import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { mulberry32 } from "../src/lib/poker/equity";
import { type BridgeAction } from "../src/lib/solver/bridge/contract";
import { type HumanModelRequest } from "../src/lib/hu-play/hand";
import { actionToken, applyPublicEvent, initialPublicState } from "../src/lib/hu-play/public-state";
import { applyStrategy, rangeFromBridge } from "../src/lib/hu-play/reach";
import { fnv1a } from "../src/lib/hu-play/rng";
import { loadLibraryPolicySource } from "../src/lib/hu-play/sources/library";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import type { NodePolicy } from "../src/lib/hu-play/sources/policy";

const fetcher: typeof fetch = async input => {
  assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/);
  assert.ok(!String(input).includes("..")); return new Response(readFileSync(`public${input}`));
};
async function setup(aiSeat: 0 | 1 = 1, seed = 7) {
  assert.ok(existsSync("src/lib/hu-play/sources/flop-play.ts"), "P4 needs a public-only translated flop source");
  const { FlopPlaySource } = await import("../src/lib/hu-play/sources/flop-play");
  const catalog = await loadPlayCatalog(undefined, fetcher);
  const library = await loadLibraryPolicySource(catalog, catalog.library.spots[0].id, undefined, fetcher);
  const request: HumanModelRequest = { publicState: initialPublicState({ startingPot: 550, startingStack: 9750,
    minimumBet: 100, flop: library.spot.board.flop }), aiSeat,
    ranges: { ai: rangeFromBridge(library.spot.ranges[aiSeat]), human: rangeFromBridge(library.spot.ranges[1 - aiSeat]) } };
  return { library, source: new FlopPlaySource(library, seed), request };
}
function step(q: HumanModelRequest, a: BridgeAction, likelihood: (h: string) => number): HumanModelRequest {
  const actor = q.publicState.toAct!, side = actor === q.aiSeat ? "ai" : "human";
  return { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: actor, action: a }),
    ranges: { ...q.ranges, [side]: applyStrategy(q.ranges[side], likelihood) } };
}
function snapshot(p: NodePolicy, q: HumanModelRequest) {
  const hands = q.publicState.toAct === q.aiSeat ? q.ranges.ai : q.ranges.human;
  return { actions: p.actions, provenance: p.provenance, basis: p.actionEvBasis,
    rows: hands.entries.map(h => [p.distribution(h.combo), p.actionEvs(h.combo)]) };
}
function passiveSeed(path: readonly string[], action: BridgeAction) {
  for (let seed = 0; seed < 10000; seed++) {
    const draw = mulberry32(fnv1a(`hu-flop-translation|${seed}|${path.join(",")}|${actionToken(action)}`))();
    if (draw < 0.01) return seed;
  }
  throw new Error("No seeded small translation draw");
}

test("P4 flop adapter reduces exactly to the saved on-tree policy, EVs and reaches", async () => {
  const { source, library, request } = await setup(); let q = request;
  for (const action of [{ type: "check" }, { type: "bet", to: 363 }, { type: "raise", to: 1129 }] as BridgeAction[]) {
    await source.prepare(q); const actual = source.policy(q);
    await library.prepare(q); assert.deepEqual(snapshot(actual, q), snapshot(library.policy(q), q));
    if (q.publicState.toAct !== q.aiSeat) assert.equal(await source.prepareHumanAction(q, action), "on-tree");
    q = step(q, action, h => actual.probability(action, h));
  }
  await source.prepare(q); await library.prepare(q);
  assert.deepEqual(snapshot(source.policy(q), q), snapshot(library.policy(q), q));
  const forged = { ...q, ranges: { ...q.ranges, ai: { ...q.ranges.ai,
    entries: q.ranges.ai.entries.map((h, i) => i === 0 ? { ...h, weight: 0.123 } : h) } } };
  await assert.rejects(() => source.prepare(forged), /reach|played policy/i);
  await assert.rejects(() => source.prepare({ ...q, humanHand: "AsKs" } as HumanModelRequest), /unexpected|public/i);
});

test("P4 tiny opening bet maps a public likelihood once, projects AI prices, and withholds old EVs", async () => {
  const action: BridgeAction = { type: "bet", to: 100 }, seed = passiveSeed([], action);
  const { source, library, request: q } = await setup(1, seed);
  await library.prepare(q); const reference = library.policy(q);
  assert.equal(await source.prepareHumanAction(q, action), "translation");
  const model = source.humanModel(q, action);
  assert.deepEqual(q.ranges.human.entries.map(h => model(h.combo)),
    q.ranges.human.entries.map(h => reference.probability({ type: "check" }, h.combo)));
  const next = step(q, action, model); await source.prepare(next);
  const p = source.policy(next);
  assert.deepEqual(p.actions, [{ type: "call" }, { type: "raise", to: 595 }]);
  assert.equal(next.publicState.pot, 650); assert.deepEqual(next.publicState.streetPut, [100, 0]);
  assert.equal(p.provenance.source, "translation"); assert.equal(p.actionEvBasis, "not-exported");
  assert.ok(q.ranges.ai.entries.every(h => p.actionEvs(h.combo).every(v => v === null)));
  const again = await setup(1, seed); await again.source.prepare(next);
  assert.deepEqual(snapshot(p, next), snapshot(again.source.policy(next), next));
});

test("P4 ended saved street has an explicit passive response, not a fabricated saved solver node", async () => {
  const action: BridgeAction = { type: "bet", to: 100 }, seed = passiveSeed(["x"], action);
  const { source, request } = await setup(0, seed);
  await source.prepare(request); const root = source.policy(request);
  const q = step(request, { type: "check" }, h => root.probability({ type: "check" }, h));
  assert.equal(await source.prepareHumanAction(q, action), "translation");
  const next = step(q, action, source.humanModel(q, action)); await source.prepare(next);
  const p = source.policy(next), description = source.description(next);
  assert.deepEqual(p.actions, [{ type: "call" }]);
  assert.equal(description.passiveContinuation, true); assert.deepEqual(description.savedPath, ["x", "x"]);
  assert.equal(p.actionEvBasis, "not-exported");
  assert.ok(next.ranges.ai.entries.every(h => p.probability({ type: "call" }, h.combo) === 1));
  const called = step(next, { type: "call" }, h => p.probability({ type: "call" }, h));
  assert.equal(called.publicState.status, "chance"); assert.equal(called.publicState.pot, 750);
  assert.deepEqual(called.ranges.ai, next.ranges.ai);
});

test("P4 real all-in merges every saved call/raise probability without raising an all-in", async () => {
  const { source, library, request: q } = await setup();
  const action: BridgeAction = { type: "bet", to: 9750 };
  await source.prepareHumanAction(q, action);
  const next = step(q, action, source.humanModel(q, action)); await source.prepare(next);
  const p = source.policy(next), info = source.description(next);
  assert.deepEqual(info.savedPath, ["b363"]);
  const saved = { ...next, publicState: applyPublicEvent(q.publicState,
    { kind: "action" as const, player: 0 as const, action: { type: "bet" as const, to: 363 } }) };
  await library.prepare(saved); const old = library.policy(saved);
  assert.deepEqual(p.actions, [{ type: "fold" }, { type: "call" }]);
  for (const h of next.ranges.ai.entries) {
    const sum = old.actions.filter(a => a.type !== "fold").reduce((s, a) => s + Math.round(1000 * old.probability(a, h.combo)), 0) / 1000;
    assert.equal(p.probability({ type: "call" }, h.combo), sum);
  }
});

test("P4 cancellation and supersession never publish a stale custom likelihood", async () => {
  const { source, request: q } = await setup(), action: BridgeAction = { type: "bet", to: 101 };
  await source.prepare(q); const before = snapshot(source.policy(q), q), c = new AbortController();
  const preparing = source.prepareHumanAction(q, action, c.signal); c.abort();
  await assert.rejects(() => preparing, /abort/i);
  assert.deepEqual(snapshot(source.policy(q), q), before);
  assert.throws(() => source.humanModel(q, action), /prepared|outside/i);
  const stale = source.prepareHumanAction(q, action); const latest = source.prepare(q);
  await assert.rejects(() => stale, /supersed/i); await latest;
  assert.throws(() => source.humanModel(q, action), /prepared|outside/i);
  const invalid = { ...action, humanHand: "AsKs" } as BridgeAction;
  await assert.rejects(() => source.prepareHumanAction(q, invalid), /fields|public/i);
});

test("P4 an extra real raise beyond the saved cap keeps chips and uses the labelled passive extension", async () => {
  const { source, request } = await setup(); let q = request;
  const bet: BridgeAction = { type: "bet", to: 363 }, raise: BridgeAction = { type: "raise", to: 1129 };
  await source.prepareHumanAction(q, bet); q = step(q, bet, source.humanModel(q, bet));
  await source.prepare(q); const old = source.policy(q); q = step(q, raise, h => old.probability(raise, h));
  const actual: BridgeAction = { type: "raise", to: 1900 };
  assert.equal(await source.prepareHumanAction(q, actual), "translation");
  const before = source.policy(q); const model = source.humanModel(q, actual);
  assert.deepEqual(q.ranges.human.entries.map(h => model(h.combo)),
    q.ranges.human.entries.map(h => before.probability({ type: "call" }, h.combo)));
  q = step(q, actual, model); await source.prepare(q);
  assert.deepEqual(q.publicState.streetPut, [1900, 1129]); assert.equal(q.publicState.pot, 3579);
  assert.equal(source.description(q).passiveContinuation, true);
  assert.deepEqual(source.description(q).savedPath, ["b363", "r1129", "c"]);
  assert.deepEqual(source.policy(q).actions, [{ type: "call" }]);
  q = step(q, { type: "call" }, () => 1);
  assert.equal(q.publicState.pot, 4350); assert.deepEqual(q.publicState.stacks, [7850, 7850]);
});
