import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { applyPublicEvent } from "../src/lib/hu-play/public-state";
import { applyStrategy } from "../src/lib/hu-play/reach";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";
import { smallTurnRequest } from "./helpers/hu-play-turn";

const needsWasm = { skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required" };
test("P3 prepared turn snapshots are detached and public-only, just like river snapshots", needsWasm, async () => {
  const { bindings } = await loadWasm(), q = smallTurnRequest();
  const source = new ResolvedPolicySource(async s => runWasmSpot(bindings, s)); await source.prepare(q);
  const first = source.publicTree(q); assert.equal(first.parentNode, 0); assert.deepEqual(first.rootRequest, q);
  assert.ok(first.result.tree.some(n => n.kind === "chance" && n.truncated));
  const n = first.result.tree[0]; if (n.kind !== "player") throw new Error("root");
  Object.assign(n.strategy[0], { 0: 1234 });
  const clean = source.publicTree(q).result.tree[0]; assert.ok(clean.kind === "player" && clean.strategy[0][0]! <= 1);
  assert.throws(() => source.publicTree({ ...q, humanHand: "AsKs" } as HumanModelRequest), /public|unexpected/);
});

test("P3 nested turn source applies the solved human likelihood once and preserves the real price", needsWasm, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/nested-turn.ts"), "P3 nested turn policy source required");
  const { NestedTurnSource } = await import("../src/lib/hu-play/sources/nested-turn");
  const { bindings } = await loadWasm(), q = smallTurnRequest(), actual = { type: "bet" as const, to: 37 };
  const requests: BridgeSpotV1[] = [];
  const source = new NestedTurnSource(async s => { requests.push(s); return runWasmSpot(bindings, s); });
  await source.prepareOffTree(q, actual);
  const parent = source.policy(q), model = source.humanModel(q, actual);
  const next = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action: actual }),
    ranges: { ...q.ranges, human: applyStrategy(q.ranges.human, model) } };
  await source.prepare(next); assert.equal(requests.length, 1);
  assert.equal(source.policy(next).provenance.ladder?.profile, "play-turn-v1");
  assert.ok(next.ranges.human.entries.some((h, i) => h.weight !== q.ranges.human.entries[i].weight));
  for (const h of q.ranges.human.entries) assert.equal(model(h.combo), parent.probability(actual, h.combo));
  assert.deepEqual(source.publicTree(next).result.tree[source.publicTree(next).parentNode].committed, [37, 0]);
  await assert.rejects(() => source.prepare({ ...next, ranges: q.ranges }), /reach|arriv/i);
  await assert.rejects(() => source.prepareOffTree({ ...q, humanHand: "AsKs" } as HumanModelRequest, actual), /public|unexpected/);
  assert.equal(requests.length, 1);
});

test("P3 cancellation and supersession cannot publish a nested turn policy", needsWasm, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/nested-turn.ts"));
  const { NestedTurnSource } = await import("../src/lib/hu-play/sources/nested-turn");
  const { bindings } = await loadWasm(), q = smallTurnRequest(), actual = { type: "bet" as const, to: 37 }, c = new AbortController();
  const cancelled = new NestedTurnSource(async s => { const r = runWasmSpot(bindings, s); c.abort(); return r; });
  await assert.rejects(() => cancelled.prepareOffTree(q, actual, c.signal));
  assert.throws(() => cancelled.policy(q), /prepared/);
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(r => { started = r; }), gate = new Promise<void>(r => { release = r; });
  const stale = new NestedTurnSource(async s => { started(); await gate; return runWasmSpot(bindings, s); });
  const pending = stale.prepareOffTree(q, actual); await entered;
  await assert.rejects(() => stale.prepare(q), /first/); release();
  await assert.rejects(() => pending, /superseded/); assert.throws(() => stale.policy(q), /prepared/);
});
