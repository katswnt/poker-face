import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import initialData from "../src/lib/solver/postflop/flop-library/artifacts/initial.json";
import catalogData from "../src/lib/solver/postflop/flop-library/artifacts/catalog.json";
import { createFlopExplorerStore, flopDecisionLink, flopViewNodes, parseFlopDecisionLink, type FlopWorkerPort } from "../src/lib/solver/postflop/flop-library/store";
import { fetchFlopJson, validateFlopScenario, validateFlopSlice } from "../src/lib/solver/postflop/flop-library/load";
import { evaluateFlopInspection, type FlopInspectionReply, type FlopInspectionRequest } from "../src/lib/solver/postflop/flop-library/worker";
import { flopCallPrice, flopHandDetails, reachedFlopDeals } from "../src/lib/solver/postflop/flop-library/query";
import type { FlopCatalog, FlopScenario, FlopSlice } from "../src/lib/solver/postflop/flop-library/model";
const initial = initialData as unknown as { scenario: FlopScenario; flop: FlopSlice }, catalog = catalogData as FlopCatalog;
const file = (url: string) => readFileSync(`public${url}`);
const fetcher: typeof fetch = async input => new Response(file(String(input)));
class Worker implements FlopWorkerPort {
  onmessage: FlopWorkerPort["onmessage"] = null; onerror: FlopWorkerPort["onerror"] = null; onmessageerror: FlopWorkerPort["onmessageerror"] = null;
  terminated = false; request?: FlopInspectionRequest;
  constructor(private auto = true) {}
  terminate() { this.terminated = true; }
  postMessage(request: FlopInspectionRequest) { this.request = request; if (this.auto) queueMicrotask(() => { if (!this.terminated) this.emit(evaluateFlopInspection(request)); }); }
  emit(reply: FlopInspectionReply) { this.onmessage?.({ data: reply } as MessageEvent<FlopInspectionReply>); }
}
function setup(auto = true, fetchOverride = fetcher) {
  const workers: Worker[] = [], store = createFlopExplorerStore(catalog, initial, { fetcher: fetchOverride, worker: () => { const w = new Worker(auto); workers.push(w); return w; } });
  return { store, workers, unsubscribe: store.subscribe(() => {}) };
}
const current = (store: ReturnType<typeof setup>["store"]) => flopViewNodes(store.getSnapshot()).get(store.getSnapshot().node)!;
const follow = (store: ReturnType<typeof setup>["store"], label: string) => store.follow(current(store).edges.findIndex(e => e.label === label));
async function toRiverCard(store: ReturnType<typeof setup>["store"]) { await follow(store, "check"); await follow(store, "check"); await follow(store, "2c"); await follow(store, "check"); await follow(store, "check"); }

test("saved flop navigation lazily loads both streets, evaluates a bounded river, and keeps the source policy", async () => {
  const { store, workers, unsubscribe } = setup(); assert.equal(workers.length, 0);
  await toRiverCard(store); const before = current(store).edges.find(e => e.label === "3c")!.preview!;
  await follow(store, "3c"); assert.equal(store.getSnapshot().status, "ready"); assert.equal(workers.length, 1); assert.ok(workers[0].terminated);
  assert.equal(current(store).state.street, 2); assert.ok(store.getSnapshot().repeatedStates! <= 100000);
  if (before.value0 !== null) assert.ok(Math.abs(current(store).summary!.value0! - before.value0) < 1e-9);
  const node = current(store), nodes = flopViewNodes(store.getSnapshot()), pairs = reachedFlopDeals(store.getSnapshot().scenario, node, nodes);
  for (const hand of node.hands) {
    const details = flopHandDetails(store.getSnapshot().scenario, node, hand, nodes, pairs);
    details.actions.forEach((a, i) => assert.equal(a.frequency, node.policy![hand.hand][i]));
    if (details.opponent) assert.ok(Math.abs(details.opponent.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    if (hand.reach > 1e-12) assert.equal(details.actions[0].foldNext, 0); // Checking cannot cause an immediate fold.
    for (const [a, action] of details.actions.entries()) {
      const next = nodes.get(node.edges[a].node)!;
      action.responses.forEach((response, r) => {
        const matching = pairs.filter(p => p.hands[node.state.actor!] === hand.hand);
        const mass = matching.reduce((s, p) => s + p.reach, 0);
        if (mass <= 1e-12) { assert.equal(response.probability, null); return; }
        const weights = Array(store.getSnapshot().scenario.hands[1 - node.state.actor!].length).fill(0);
        for (const pair of matching) { const h = pair.hands[1 - node.state.actor!]; weights[h] += pair.reach * next.policy![h][r] / mass; }
        const probability = weights.reduce((s, p) => s + p, 0); assert.ok(Math.abs(response.probability! - probability) < 1e-12);
        if (probability > 1e-12) response.opponent!.forEach((p, h) => assert.ok(Math.abs(p - weights[h] / probability) < 1e-12));
        else assert.equal(response.opponent, null);
      });
    }
  }
  const link = flopDecisionLink(store.getSnapshot().scenario, node, node.hands[0]?.hand ?? null), parsed = parseFlopDecisionLink(link);
  assert.equal(parsed.turn, "2c"); assert.equal(parsed.river, "3c");
  await store.reset(); await store.openLink(link); assert.equal(current(store).id, node.id); assert.equal(store.getSnapshot().status, "ready");
  await store.back(); assert.equal(current(store).state.phase, "card"); unsubscribe();
});

test("river cancellation, stale replies, failure and retry preserve the last checked decision", async () => {
  const { store, workers, unsubscribe } = setup(false); await toRiverCard(store); const prior = current(store).id;
  const task = follow(store, "3c"); await new Promise(r => setTimeout(r, 20)); assert.equal(store.getSnapshot().status, "inspecting");
  const first = workers[0]; first.emit({ ...evaluateFlopInspection(first.request!), id: first.request!.id + 999 }); assert.equal(store.getSnapshot().status, "inspecting");
  store.cancel(); await task; assert.ok(first.terminated); first.emit(evaluateFlopInspection(first.request!)); assert.equal(current(store).id, prior);
  const failed = follow(store, "3c"); await new Promise(r => setTimeout(r, 20)); workers[1].onerror?.({} as ErrorEvent); await failed;
  assert.equal(store.getSnapshot().status, "error"); assert.equal(current(store).id, prior);
  const retry = store.retry(); await new Promise(r => setTimeout(r, 20)); const last = workers.at(-1)!; last.emit(evaluateFlopInspection(last.request!)); await retry;
  assert.equal(store.getSnapshot().status, "ready"); assert.equal(current(store).state.river, "3c"); unsubscribe();
});

test("scenario supersession and unmount reject late data without retaining a visited-board cache", async () => {
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let first = true;
  const slow: typeof fetch = async (...args) => { if (first) { first = false; await gate; } return fetcher(...args); };
  const { store, unsubscribe } = setup(true, slow); const pending = store.openScenario("flop-dry");
  await store.openScenario("flop-paired"); release(); await pending; assert.equal(store.getSnapshot().scenario.id, "flop-paired");
  assert.equal(store.getSnapshot().turn, null); assert.equal(store.getSnapshot().river, null); assert.equal(store.getSnapshot().inspected.length, 0);
  const task = store.openScenario("flop-connected"); unsubscribe(); await task; assert.equal(store.getSnapshot().scenario.id, "flop-paired");
});

test("saved transport and semantic validators reject corrupt, truncated, oversized and mismatched data", async () => {
  const ref = initial.scenario.chunks.flop, signal = new AbortController().signal;
  assert.deepEqual(await fetchFlopJson(ref, signal, fetcher), initial.flop);
  await assert.rejects(fetchFlopJson({ ...ref, sha256: "0".repeat(64) }, signal, fetcher), /integrity/);
  await assert.rejects(fetchFlopJson({ ...ref, bytes: ref.bytes + 1 }, signal, fetcher), /incomplete/);
  await assert.rejects(fetchFlopJson({ ...ref, bytes: ref.bytes - 1 }, signal, fetcher), /exceeds/);
  const invalid = structuredClone(initial.flop); invalid.nodes[0].policy![0][0] = NaN; assert.throws(() => validateFlopSlice(invalid, initial.scenario, "flop"));
  const altered = structuredClone(initial.flop); altered.nodes[0].edges.reverse(); assert.throws(() => validateFlopSlice(altered, initial.scenario, "flop"));
  assert.throws(() => validateFlopScenario({ ...initial.scenario, sourceHash: "0".repeat(64) }, catalog.scenarios[0]));
  assert.throws(() => validateFlopScenario({ ...initial.scenario, quality: { ...initial.scenario.quality, percentOfPot: NaN } }, catalog.scenarios[0]));
  assert.throws(() => validateFlopSlice({ ...initial.flop, version: 2 }, initial.scenario, "flop"));
  for (const link of ["#v=2", "#v=1&game=bad", `${flopDecisionLink(initial.scenario, initial.flop.nodes[0])}&node=2`]) assert.throws(() => parseFlopDecisionLink(link));
  const { store, unsubscribe } = setup(); await store.openLink(flopDecisionLink(initial.scenario, initial.flop.nodes[0]).replace(initial.scenario.sourceHash, "0".repeat(64)));
  assert.equal(store.getSnapshot().status, "error"); assert.equal(current(store).id, 0); unsubscribe();
});

test("short calls price only matched chips, and malformed worker requests fail without facts", () => {
  const scenario = { ...initial.scenario, request: { ...initial.scenario.request, stackBehind: [3, 10] as const } };
  const node = { ...initial.flop.nodes[0], state: { ...initial.flop.nodes[0].state, actor: 0 as const, put: [0, 10] as const } };
  assert.deepEqual(flopCallPrice(scenario, node), { cost: 3, potAfterCall: 106, share: 3 / 106 });
  const result = evaluateFlopInspection({ id: 1, sourceHash: initial.scenario.sourceHash, context: scenario, node: 0, nodes: initial.flop.nodes });
  assert.equal(result.type, "error");
});

test("river boundary refuses malformed contexts, policies, oversized work and mismatched replies", async () => {
  const { store, workers, unsubscribe } = setup(false); await toRiverCard(store);
  const task = follow(store, "3c"); await new Promise(r => setTimeout(r, 20));
  const worker = workers[0], request = worker.request!;
  assert.equal(evaluateFlopInspection(request).type, "result");
  const mutations: ((r: FlopInspectionRequest) => void)[] = [
    r => { r.context.weights[0][0] = NaN; },
    r => { r.context.hands[0].push(...Array(65).fill("AsAh")); },
    r => { r.nodes[0].policy![0][0] = -1; },
    r => { r.nodes[0].policy![0][0] = NaN; },
    r => { r.nodes.push(r.nodes[0]); },
    r => { r.nodes = Array(501).fill(r.nodes[0]); },
    r => { r.nodes[0].state = { ...r.nodes[0].state, put: [99, 0] }; },
    r => { r.nodes.find(n => n.state.street === 1)!.parent = 0; },
    r => { r.context.request = { ...r.context.request, board: ["As", "As", "Ad"] }; },
  ];
  for (const mutate of mutations) { const bad = structuredClone(request); mutate(bad); assert.equal(evaluateFlopInspection(bad).type, "error"); }
  worker.emit({ ...evaluateFlopInspection(request), sourceHash: "0".repeat(64) }); await task;
  assert.equal(store.getSnapshot().status, "error"); assert.match(store.getSnapshot().message, /does not match/); unsubscribe();
});

test("zero and tiny ancestor reach withhold river conditionals without changing saved frequencies", async () => {
  const { store, workers, unsubscribe } = setup(false); await toRiverCard(store);
  const task = follow(store, "3c"); await new Promise(r => setTimeout(r, 20)); const request = workers[0].request!;
  for (const probability of [0, 1e-14]) {
    const modified = structuredClone(request); modified.nodes[0].policy!.forEach(row => { row[0] = probability; row[1] = 1 - probability; });
    const reply = evaluateFlopInspection(modified); assert.equal(reply.type, "result");
    if (reply.type === "result") for (const node of reply.nodes) {
      assert.equal(node.summary!.value0, null);
      node.hands.forEach(h => { assert.equal(h.checkdownShare, null); h.actions.forEach(a => { assert.equal(a.ev, null); assert.equal(a.outcomes, null); }); });
      assert.deepEqual(node.policy, request.nodes.find(n => n.id === node.id)!.policy);
    }
  }
  store.cancel(); await task; unsubscribe();
});
