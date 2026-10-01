import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { applyPublicEvent } from "../src/lib/hu-play/public-state";
import { applyStrategy } from "../src/lib/hu-play/reach";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";

test("river source composes direct nested play and seeded labelled translation, applying the chosen human model once", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/river-play.ts"), "P2 production source composition required");
  const { RiverPlaySource } = await import("../src/lib/hu-play/sources/river-play");
  const { bindings } = await loadWasm(), roots = loadP1ProductionRoots();
  const solve = async (s: BridgeSpotV1) => runWasmSpot(bindings, s);
  for (const [index, expected] of [[0, "nested"], [2, "translation"]] as const) {
    const root = roots[index], aiSeat = 1 as const;
    const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
      : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
    const actual = { type: "bet" as const, to: index === 0 ? 101 : root.playingSpot.effectiveStack - 1 };
    const prepare = async () => {
      const source = new RiverPlaySource(new ResolvedPolicySource(solve), solve, 123);
      await source.prepare(q);
      assert.equal(await source.prepareHumanAction(q, actual), expected);
      const model = source.humanModel(q, actual);
      const next = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action: actual }),
        ranges: { ...q.ranges, human: applyStrategy(q.ranges.human, model) } };
      await source.prepare(next);
      return { next, policy: source.policy(next), snapshot: source.publicTree(next) };
    };
    const a = await prepare(), b = await prepare();
    assert.deepEqual(a.next, b.next); assert.deepEqual(a.policy.provenance, b.policy.provenance);
    assert.equal(a.policy.provenance.source, expected === "nested" ? "resolve" : "translation");
    assert.equal(a.snapshot.result.tree[a.snapshot.parentNode].committed[0], actual.to);
    if (a.policy.provenance.source === "translation") {
      assert.equal(a.policy.provenance.reason, "zero-support"); assert.equal(a.policy.provenance.mappingBasis, "increment-after-call");
    }
  }
});

test("failed expansion may use a bounded translated response; cancellation never triggers a fallback solve", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/river-play.ts"));
  const { RiverPlaySource } = await import("../src/lib/hu-play/sources/river-play");
  const { bindings } = await loadWasm(), root = loadP1ProductionRoots()[0], aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  const actual = { type: "bet" as const, to: 101 }, c = new AbortController();
  let calls = 0;
  const baseline = new ResolvedPolicySource(async s => runWasmSpot(bindings, s));
  const failed = new RiverPlaySource(baseline, async s => {
    calls++; if (calls === 1) throw new Error("Admission refused expanded tree"); return runWasmSpot(bindings, s);
  }, 5);
  assert.equal(await failed.prepareHumanAction(q, actual), "translation"); assert.equal(calls, 2);
  calls = 0;
  const cancelled = new RiverPlaySource(baseline, async s => { calls++; c.abort(); return runWasmSpot(bindings, s); }, 5);
  await assert.rejects(() => cancelled.prepareHumanAction(q, actual, c.signal)); assert.equal(calls, 1);
  assert.throws(() => cancelled.humanModel(q, actual), /on.tree/);
  calls = 0;
  const malformed = new RiverPlaySource(baseline, async s => {
    calls++; const r = runWasmSpot(bindings, s); return calls === 1 ? { ...r, spotHash: "0".repeat(64) } : r;
  }, 5);
  await assert.rejects(() => malformed.prepareHumanAction(q, actual), /hash/i,
    "An invalid returned game is not a resource fallback");
  assert.equal(calls, 1, "Malformed results must not be hidden by a fallback solve");
});
