import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readExplorerChunk, validateExplorerChunk } from "../src/lib/solver/postflop/explorer/load";
import { createExplorerStore } from "../src/lib/solver/postflop/explorer/store";
import type { ExplorerCatalog, ExplorerChunk, SavedScenario } from "../src/lib/solver/postflop/explorer/model";

const catalog = JSON.parse(readFileSync("src/lib/solver/postflop/explorer/artifacts/catalog.json", "utf8")) as ExplorerCatalog;
const scenario = catalog.scenarios[0], other = catalog.scenarios[1];
const bytes = (s: SavedScenario, card: string | null = null) => readFileSync(`public${s.chunks[card ?? "turn"].url}`);
const initial = JSON.parse(bytes(scenario).toString()) as ExplorerChunk;
const river = initial.nodes.find(n => n.state.phase === "river-card")!.children.find(c => c.compatibleDeals > 0)!;
const signal = () => new AbortController().signal;
const transport = (body: BodyInit | null, status = 200): typeof fetch => async () => new Response(body, { status });

test("saved chunk transport checks bytes, SHA-256, version and full shape before rendering", async () => {
  const loaded = await readExplorerChunk(scenario, null, signal(), transport(bytes(scenario)));
  assert.deepEqual(loaded, initial);
  await assert.rejects(readExplorerChunk(scenario, null, signal(), transport(null, 404)), /Could not load/);
  await assert.rejects(readExplorerChunk(scenario, null, signal(), transport(bytes(scenario).subarray(0, 200))), /incomplete/);
  const corrupt = Buffer.from(bytes(scenario)); corrupt[corrupt.length - 2] = 32;
  await assert.rejects(readExplorerChunk(scenario, null, signal(), transport(corrupt)), /integrity/);
  await assert.rejects(readExplorerChunk(scenario, null, signal(), transport(Buffer.concat([bytes(scenario), Buffer.from("x")]))), /exceeds/);
  const altered = { ...initial, version: 9 }, json = JSON.stringify(altered), ref = { ...scenario.chunks.turn, bytes: Buffer.byteLength(json), sha256: createHash("sha256").update(json).digest("hex") };
  await assert.rejects(readExplorerChunk({ ...scenario, chunks: { ...scenario.chunks, turn: ref } }, null, signal(), transport(json)), /structure/);
});

test("malformed conditional facts, IDs, normalization and cross-scenario chunks fail closed", () => {
  const mutate = (fn: (c: ExplorerChunk) => void) => { const copy = structuredClone(initial); fn(copy); assert.throws(() => validateExplorerChunk(copy, scenario, null), /structure/); };
  mutate(c => { c.scenario = "wrong"; }); mutate(c => { c.sourceHash = "0"; }); mutate(c => { c.card = "2d"; });
  mutate(c => { c.nodes[0].hands[0].reach = NaN; }); mutate(c => { c.nodes[0].hands[0].opponent = [1]; });
  mutate(c => { c.nodes[0].hands[0].actions[0].frequency = 4; }); mutate(c => { c.nodes[0].hands[0].actions[0].outcomes = [1, 1, 1, 1, 1]; });
  mutate(c => { c.nodes[0].hands[0].actions[0].ev = Infinity; }); mutate(c => { c.nodes[0].children[0].node = 19999; });
  mutate(c => { c.nodes.push(c.nodes[0]); }); mutate(c => { c.nodes[0].state = { ...c.nodes[0].state, actor: null }; });
  assert.throws(() => validateExplorerChunk(initial, other, null), /structure/);
});

test("streaming budget stops oversized bodies before reading the rest", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(scenario.chunks.turn.bytes + 1)); }, cancel() { cancelled = true; } }));
  await assert.rejects(readExplorerChunk(scenario, null, signal(), async () => response), /exceeds/);
  assert.equal(cancelled, true);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(readExplorerChunk(scenario, null, aborted.signal, transport(bytes(scenario))), { name: "AbortError" });
});

test("navigation aborts stale requests, keeps the last valid result, retries and limits cached chunks", async () => {
  const pending: { scenario: SavedScenario; card: string | null; signal: AbortSignal; resolve: (c: ExplorerChunk) => void; reject: (e: Error) => void }[] = [];
  const store = createExplorerStore(catalog, initial, (scenario, card, signal) => new Promise((resolve, reject) => pending.push({ scenario, card, signal, resolve, reject })));
  let events = 0; const unsubscribe = store.subscribe(() => events++);
  const first = store.navigate({ scenario: scenario.id, node: river.node, card: river.card });
  assert.equal(store.getSnapshot().status, "loading"); assert.equal(store.getSnapshot().chunk, initial);
  const second = store.start(other.id); assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve(JSON.parse(bytes(scenario, river.card).toString())); await first;
  assert.equal(store.getSnapshot().scenario, scenario.id);
  pending[1].reject(new Error("offline")); await second;
  assert.equal(store.getSnapshot().status, "error"); assert.equal(store.getSnapshot().error, "offline"); assert.equal(store.getSnapshot().chunk, initial);
  const retry = store.retry(); pending[2].resolve(JSON.parse(bytes(other).toString())); await retry;
  assert.equal(store.getSnapshot().scenario, other.id); assert.equal(store.getSnapshot().navigation, 1);
  await store.start(scenario.id); assert.equal(store.getSnapshot().chunk, initial);
  const again = store.navigate({ scenario: scenario.id, node: river.node, card: river.card });
  store.cancel(); pending[3].resolve(JSON.parse(bytes(scenario, river.card).toString())); await again;
  assert.equal(store.getSnapshot().node, 0); assert.equal(store.getSnapshot().status, "ready");
  const final = store.navigate({ scenario: scenario.id, node: river.node, card: river.card });
  pending[4].resolve(JSON.parse(bytes(scenario, river.card).toString())); await final;
  assert.equal(store.getSnapshot().card, river.card); assert.equal(store.getSnapshot().trail.length, 1);
  assert.ok(store.cachedChunks() <= 1, "plus one immutable hydration chunk");
  await store.back(); assert.equal(store.getSnapshot().node, 0); assert.equal(store.getSnapshot().trail.length, 0);
  const unmounted = store.start(other.id); unsubscribe(); assert.ok(pending[5].signal.aborted);
  const before = events; pending[5].resolve(JSON.parse(bytes(other).toString())); await unmounted;
  assert.equal(events, before); assert.equal(store.getSnapshot().scenario, scenario.id);
});

test("invalid navigation never replaces a valid saved view", async () => {
  const store = createExplorerStore(catalog, initial);
  await store.navigate({ scenario: scenario.id, node: 19999, card: null });
  assert.equal(store.getSnapshot().status, "error"); assert.equal(store.getSnapshot().node, 0);
  store.cancel(); await store.start("unknown");
  assert.equal(store.getSnapshot().status, "error"); assert.equal(store.getSnapshot().scenario, scenario.id);
});
