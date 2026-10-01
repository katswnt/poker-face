import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { applyPublicEvent } from "../src/lib/hu-play/public-state";
import { applyStrategy } from "../src/lib/hu-play/reach";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";

test("nested source uses the new human likelihood once, follows actual chips and rejects forged or cancelled preparation", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/nested-river.ts"), "P2 nested policy source required");
  const { NestedRiverSource } = await import("../src/lib/hu-play/sources/nested-river");
  const { bindings } = await loadWasm(), root = loadP1ProductionRoots()[0], aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  const spots: BridgeSpotV1[] = [], actual = { type: "bet" as const, to: 101 };
  const source = new NestedRiverSource(async s => { spots.push(s); return runWasmSpot(bindings, s); });
  await source.prepareOffTree(q, actual);
  const parent = source.policy(q), model = source.humanModel(q, actual);
  const next = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action: actual }),
    ranges: { ...q.ranges, human: applyStrategy(q.ranges.human, model) } };
  await source.prepare(next);
  assert.equal(spots.length, 1);
  assert.equal(source.policy(next).provenance.source, "resolve");
  assert.equal(source.policy(next).provenance.ladder?.profile, "play-river-v1");
  assert.ok(next.ranges.human.entries.some((h, i) => h.weight !== q.ranges.human.entries[i].weight));
  for (const h of q.ranges.human.entries) assert.equal(model(h.combo), parent.probability(actual, h.combo));
  await assert.rejects(() => source.prepare({ ...next, ranges: q.ranges }), /reach|arriv/i);
  const controller = new AbortController();
  const cancelled = new NestedRiverSource(async s => { const r = runWasmSpot(bindings, s); controller.abort(); return r; });
  await assert.rejects(() => cancelled.prepareOffTree(q, actual, controller.signal));
  assert.throws(() => cancelled.policy(q), /prepared/);
});

test("a zero-support off-tree action is refused; translated posterior response solving preserves real chip commitments", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  const { NestedRiverSource, ZeroSupportRiverAction, hasCompatibleAction } = await import("../src/lib/hu-play/sources/nested-river");
  const { bindings } = await loadWasm(), root = loadP1ProductionRoots()[2], aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  const actual = { type: "bet" as const, to: root.playingSpot.effectiveStack - 1 };
  const solver = async (s: BridgeSpotV1) => runWasmSpot(bindings, s);
  const nested = new NestedRiverSource(solver);
  await assert.rejects(() => nested.prepareOffTree(q, actual), ZeroSupportRiverAction);
  assert.throws(() => nested.policy(q), /prepared/);
  const previous = new ResolvedPolicySource(solver); await previous.prepare(q);
  const p = previous.policy(q), reference = p.actions.filter(a => a.type === "bet" && hasCompatibleAction(q, p, a)).at(-1)!;
  assert.ok(reference && "to" in reference);
  const next = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action: actual }),
    ranges: { ...q.ranges, human: applyStrategy(q.ranges.human, h => p.probability(reference, h)) } };
  assert.equal(typeof nested.prepareTranslatedResponse, "function", "Explicit translated-model response path required");
  const refSize = reference.to / q.publicState.pot;
  await nested.prepareTranslatedResponse(next, { spotHash: p.provenance.spotHash, x: actual.to / q.publicState.pot,
    a: refSize, b: refSize, probabilityA: 1, mappedTo: "a", reason: "zero-support", mappedAction: reference });
  const policy = nested.policy(next);
  assert.equal(policy.provenance.source, "translation");
  assert.equal(policy.provenance.ladder?.rung, "translation");
  if (policy.provenance.source !== "translation") throw new Error("wrong provenance");
  assert.equal(policy.provenance.reason, "zero-support"); assert.ok(policy.provenance.responseSolve);
  const snapshot = nested.publicTree(next), parent = snapshot.result.tree[snapshot.parentNode];
  assert.deepEqual(parent.committed, [actual.to, 0]);
  assert.deepEqual(snapshot.rootRequest.ranges, next.ranges);
  assert.ok(policy.actions.some(a => a.type === "call"));
});
