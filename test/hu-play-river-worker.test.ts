import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadWasm, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { buildNestedRiverSpot } from "../src/lib/hu-play/river-tree";
import { createLiveRuntime } from "../src/lib/solver/bridge/live/runtime";
import { createLiveClient, type LiveWorker } from "../src/lib/solver/bridge/live/client";
import type { LiveCommand, LiveEvent } from "../src/lib/solver/bridge/live/model";

test("P2 client forwards the river profile; real Worker never publishes target-missed or cancelled nested policies", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  const root = loadP1ProductionRoots()[0], aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  const spot = buildNestedRiverSpot(q, { type: "bet", to: 101 });
  const request: Exclude<LiveCommand, { type: "cancel" }> = { type: "solve", id: 1, profile: "play-river-v1",
    spotJson: JSON.stringify(spot), assetBase: "/unused/", environment: { profile: "unknown" } };
  const sent: LiveCommand[] = [];
  const worker: LiveWorker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: c => { sent.push(c); }, terminate: () => {} };
  const client = createLiveClient({ createWorker: () => worker, now: () => 0, setTimer: () => 0, clearTimer: () => {} }, () => {});
  client.start(request); assert.equal(sent.length, 1); assert.equal(sent[0].type !== "cancel" && sent[0].profile, "play-river-v1"); client.dispose();
  const { bindings, memory, manifest } = await loadWasm();
  const run = async (miss: boolean, cancelStage?: string) => {
    const events: LiveEvent[] = [];
    const runtime = createLiveRuntime({ emit: e => {
      events.push(e); if (e.type === "progress" && e.stage === cancelStage) void runtime.handle({ type: "cancel", id: 1 });
    }, now: () => performance.now(), yield: async () => {}, close: () => {},
    hash: async bytes => createHash("sha256").update(bytes).digest("hex"),
    load: async () => ({ create: bytes => new bindings.SolverSession(bytes), memoryBytes: () => memory.buffer.byteLength,
      provenance: { buildHash: manifest.buildHash, sourceHash: manifest.sourceHash, engineCommit: manifest.engineCommit,
        sourceUrl: "source/BUILD.txt", licenseUrl: "LICENSES.txt" } }) });
    await runtime.handle({ ...request, spotJson: JSON.stringify(miss ? { ...spot, solve: { ...spot.solve, maxIterations: 1 } } : spot) });
    return events;
  };
  const good = await run(false); assert.equal(good.at(-1)?.type, "result", JSON.stringify(good.at(-1)));
  const missed = await run(true);
  assert.ok(!missed.some(e => e.type === "result"), "A missed river target must not become a playing policy");
  assert.equal(missed.at(-1)?.type, "error");
  for (const stage of ["building", "solving", "exporting", "checking"]) {
    const cancelled = await run(false, stage);
    assert.equal(cancelled.at(-1)?.type, "cancelled", stage);
    assert.ok(!cancelled.some(e => e.type === "result" || e.type === "error"));
  }
});
