import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { BRIDGE_BINARY } from "../scripts/bridge-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { buildNestedRiverSpot } from "../src/lib/hu-play/river-tree";
import { BrowserPublicSolver } from "../src/lib/hu-play/sources/browser";

function spot() {
  const root = loadP1ProductionRoots()[0], aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  return buildNestedRiverSpot(q, { type: "bet", to: 101 });
}

test("browser public runner explicitly selects the bounded nested-river profile", async () => {
  let started = 0, disposed = 0;
  const runner = new BrowserPublicSolver({ assetBase: "/wasm/test/", environment: { profile: "unknown" }, profile: "play-river-v1",
    createClient: emit => ({ start: request => { started++; assert.equal(request.profile, "play-river-v1");
      emit({ type: "error", id: 1, message: "test stopped after profile acceptance" }); return 1; }, cancel: () => {}, dispose: () => { disposed++; } }) });
  await assert.rejects(() => runner.solve(spot()), /test stopped after profile acceptance/);
  assert.equal(started, 1); assert.equal(disposed, 1);
});

test("native public runner estimates the nested profile before one-thread solving and honours pre-cancellation", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  const native = await import("../src/lib/hu-play/sources/native");
  assert.equal(typeof native.solveNativePlay, "function", "Explicit native profile entry required");
  const s = spot(); let estimated = 0, solved = 0;
  const result = await native.solveNativePlay(s, { onEstimate: (_, _e, verdict) => { estimated++; assert.ok(verdict.ok); },
    onResult: () => { assert.equal(estimated, 1); solved++; } }, undefined, "play-river-v1");
  assert.equal(solved, 1); assert.equal(result.engine.threads, 1); assert.ok(result.exploitability.reached);
  const c = new AbortController(); c.abort();
  await assert.rejects(() => native.solveNativePlay(s, { onEstimate: () => { throw new Error("Should not estimate"); } }, c.signal, "play-river-v1"));
});
