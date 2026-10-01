import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { initialPublicState, applyPublicEvent } from "../src/lib/hu-play/public-state";
import { applyStrategy, rangeFromBridge } from "../src/lib/hu-play/reach";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import type { BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";

function riverRequest(): HumanModelRequest {
  const s = buildBridgeFixture("referee-river-v3-demo");
  let p = initialPublicState({ startingPot: s.startingPot, startingStack: s.effectiveStack, minimumBet: 1, flop: s.board.flop });
  for (const [street, card] of [["turn", s.board.turn!], ["river", s.board.river!]] as const) {
    p = applyPublicEvent(p, { kind: "action", player: 0, action: { type: "check" } });
    p = applyPublicEvent(p, { kind: "action", player: 1, action: { type: "check" } });
    p = applyPublicEvent(p, { kind: "card", street, card });
  }
  return { publicState: p, aiSeat: 0, ranges: { ai: rangeFromBridge(s.ranges[0]), human: rangeFromBridge(s.ranges[1]) } };
}

test("resolved source solves once per street, follows exact played reach, and rejects private fields and forged arrivals", {
  skip: existsSync(join(WASM_BUILD_ROOT, "manifest.json")) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/resolved.ts"), "Shared full-range resolved policy source is required");
  const { ResolvedPolicySource } = await import("../src/lib/hu-play/sources/resolved");
  const { bindings } = await loadWasm(), spots: BridgeSpotV1[] = [];
  const source = new ResolvedPolicySource(async spot => { spots.push(spot); return runWasmSpot(bindings, spot); });
  const request = riverRequest();
  await source.prepare(request);
  const root = source.policy(request), hand = request.ranges.ai.entries[0].combo;
  assert.equal(root.provenance.source, "resolve");
  assert.equal(root.provenance.ladder?.rung, "full");
  assert.deepEqual(root.provenance.ladder?.prunedMass, [0, 0]);
  assert.deepEqual(source.decide({ ...request, aiHand: hand, index: 0 }).strategy, root.distribution(hand));
  await source.prepare(request); assert.equal(spots.length, 1);
  assert.deepEqual(spots[0].ranges.map(r => r.combos.length), [request.ranges.ai.entries.length, request.ranges.human.entries.length]);
  const check = root.actions.find(a => a.type === "check")!;
  const next: HumanModelRequest = { ...request,
    publicState: applyPublicEvent(request.publicState, { kind: "action", player: 0, action: check }),
    ranges: { ...request.ranges, ai: applyStrategy(request.ranges.ai, combo => root.probability(check, combo)) } };
  await source.prepare(next); assert.equal(spots.length, 1);
  const forged = { ...next, ranges: { ...next.ranges, ai: request.ranges.ai } };
  await assert.rejects(() => source.prepare(forged), /reach|arriv/i);
  await assert.rejects(() => source.prepare({ ...request, humanHand: "AsKs" } as HumanModelRequest), /unexpected|public/i);
  const b = new ResolvedPolicySource(async spot => runWasmSpot(bindings, spot));
  await assert.rejects(() => b.prepare(next), /root/i);
  assert.ok(spots.every(s => !/aiHand|humanHand|runout/.test(JSON.stringify(s))));
});

test("resolved source never accepts target-missed, compressed, wrong-game or cancelled results", {
  skip: existsSync(join(WASM_BUILD_ROOT, "manifest.json")) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/resolved.ts"), "Shared full-range resolved policy source is required");
  const { ResolvedPolicySource } = await import("../src/lib/hu-play/sources/resolved");
  const { bindings } = await loadWasm(), request = riverRequest();
  for (const mutate of [
    (r: BridgeResultV1) => ({ ...r, exploitability: { ...r.exploitability, reached: false } }),
    (r: BridgeResultV1) => ({ ...r, engine: { ...r.engine, precision: "int16-compressed" as const } }),
    (r: BridgeResultV1) => ({ ...r, spotHash: "0".repeat(64) }),
  ]) {
    const source = new ResolvedPolicySource(async spot => mutate(runWasmSpot(bindings, spot)));
    await assert.rejects(() => source.prepare(request));
    assert.throws(() => source.policy(request), /prepared/);
  }
  const c = new AbortController();
  const source = new ResolvedPolicySource(async spot => { const r = runWasmSpot(bindings, spot); c.abort(); return r; });
  await assert.rejects(() => source.prepare(request, c.signal));
  assert.throws(() => source.policy(request), /prepared/);
});
