import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadWasm, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { buildNestedTurnSpot } from "../src/lib/hu-play/turn-tree";
import { createLiveRuntime } from "../src/lib/solver/bridge/live/runtime";
import { createLiveClient, type LiveWorker } from "../src/lib/solver/bridge/live/client";
import { BrowserPublicSolver } from "../src/lib/hu-play/sources/browser";
import type { LiveCommand, LiveEvent } from "../src/lib/solver/bridge/live/model";
import { smallTurnRequest } from "./helpers/hu-play-turn";

test("P3 Worker forwards turn profile and rejects missed quality or cancellation before publishing a policy", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  const spot = buildNestedTurnSpot(smallTurnRequest(), { type: "bet", to: 37 });
  const request: Exclude<LiveCommand, { type: "cancel" }> = { type: "solve", id: 1, profile: "play-turn-v1",
    spotJson: JSON.stringify(spot), assetBase: "/unused/", environment: { profile: "unknown" } };
  const sent: LiveCommand[] = [];
  const worker: LiveWorker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: c => { sent.push(c); }, terminate: () => {} };
  const client = createLiveClient({ createWorker: () => worker, now: () => 0, setTimer: () => 0, clearTimer: () => {} }, () => {});
  client.start(request); assert.equal(sent.length, 1); assert.equal(sent[0].type !== "cancel" && sent[0].profile, "play-turn-v1"); client.dispose();
  const { bindings, memory, manifest } = await loadWasm();
  const run = async (miss: boolean, cancelStage?: string) => {
    const events: LiveEvent[] = []; let freed = 0, closed = 0;
    const runtime = createLiveRuntime({ emit: e => {
      events.push(e); if (e.type === "progress" && e.stage === cancelStage) void runtime.handle({ type: "cancel", id: 1 });
    }, now: () => performance.now(), yield: async () => {}, close: () => { closed++; },
    hash: async bytes => createHash("sha256").update(bytes).digest("hex"),
    load: async () => ({ create: bytes => {
      const s = new bindings.SolverSession(bytes);
      return { estimate: () => s.estimate(), status: () => s.status(), allocate: () => s.allocate(), step: n => s.step(n),
        root_strategy: () => s.root_strategy(), finish: () => s.finish(), free: () => { freed++; s.free(); } };
    }, memoryBytes: () => memory.buffer.byteLength,
    provenance: { buildHash: manifest.buildHash, sourceHash: manifest.sourceHash, engineCommit: manifest.engineCommit,
      sourceUrl: "source/BUILD.txt", licenseUrl: "LICENSES.txt" } }) });
    await runtime.handle({ ...request, spotJson: JSON.stringify(miss ? { ...spot, solve: { ...spot.solve, maxIterations: 1 } } : spot) });
    assert.equal(closed, 1); assert.equal(freed, cancelStage === "building" ? 0 : 1);
    return events;
  };
  const good = await run(false); assert.equal(good.at(-1)?.type, "result", JSON.stringify(good.at(-1)));
  const missed = await run(true);
  assert.ok(!missed.some(e => e.type === "result"), "A missed turn target must not become a playing policy");
  assert.equal(missed.at(-1)?.type, "error");
  for (const stage of ["building", "solving", "exporting", "checking"]) {
    const cancelled = await run(false, stage);
    assert.equal(cancelled.at(-1)?.type, "cancelled", stage);
    assert.ok(!cancelled.some(e => e.type === "result" || e.type === "error"));
  }
});

test("P3 browser runner selects turn admission and still disposes its failed job", async () => {
  const spot = buildNestedTurnSpot(smallTurnRequest(), { type: "bet", to: 37 });
  let starts = 0, disposed = 0;
  const runner = new BrowserPublicSolver({ assetBase: "/unused/", environment: { profile: "unknown" }, profile: "play-turn-v1",
    createClient: emit => ({ start: request => { starts++; assert.equal(request.profile, "play-turn-v1");
      emit({ type: "error", id: 1, message: "test refusal" }); return 1; }, cancel: () => {}, dispose: () => { disposed++; } }) });
  await assert.rejects(() => runner.solve(spot), /test refusal/);
  assert.equal(starts, 1); assert.equal(disposed, 1); runner.dispose();
});
