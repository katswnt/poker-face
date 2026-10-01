import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadP1WideRoots } from "../scripts/hu-play-wide-corpus";
import { loadWasm, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { createLiveClient, type LiveWorker } from "../src/lib/solver/bridge/live/client";
import { createLiveRuntime } from "../src/lib/solver/bridge/live/runtime";
import type { LiveCommand, LiveEvent } from "../src/lib/solver/bridge/live/model";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";

const full = loadP1WideRoots()[0].spot;
const request = (spot = full): Exclude<LiveCommand, { type: "cancel" }> => ({ type: "solve", id: 1,
  spotJson: JSON.stringify(spot), profile: "play-v1", environment: { profile: "unknown" }, assetBase: "/unused/" });

test("main-thread client validates and forwards play-v1; cancellation still suppresses late output", () => {
  const events: LiveEvent[] = [], sent: LiveCommand[] = [], timers: (() => void)[] = [];
  let terminated = 0;
  const worker: LiveWorker = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: c => { sent.push(c); }, terminate: () => { terminated++; } };
  const client = createLiveClient({ createWorker: () => worker, now: () => 0,
    setTimer: f => { timers.push(f); return timers.length - 1; }, clearTimer: () => {} }, e => { events.push(e); });
  const id = client.start(request());
  assert.equal(sent.length, 1, JSON.stringify(events));
  assert.deepEqual(sent[0], { ...request(), id });
  client.cancel();
  worker.onmessage?.({ data: { type: "error", id, message: "too late" } } as MessageEvent<LiveEvent>);
  assert.equal(events.length, 0);
  timers.at(-1)!();
  assert.equal(terminated, 1);
  assert.deepEqual(events, [{ type: "cancelled", id, hard: true, elapsedMs: 0 }]);
});

const available = existsSync(join(WASM_BUILD_ROOT, "manifest.json"));
test("actual Worker runtime admits full play ranges, but never publishes a target-missed policy", {
  skip: available ? false : "build:wasm required (run explicitly in bridge-wasm CI)",
}, async () => {
  const { bindings, memory, manifest } = await loadWasm();
  const run = async (spot: BridgeSpotV1, cancelStage?: string) => {
    const events: LiveEvent[] = [];
    const runtime = createLiveRuntime({
      emit: e => { events.push(e); if (e.type === "progress" && e.stage === cancelStage) void runtime.handle({ type: "cancel", id: 1 }); },
      now: () => performance.now(), yield: async () => {}, close: () => {},
      hash: async bytes => createHash("sha256").update(bytes).digest("hex"),
      load: async () => ({ create: bytes => new bindings.SolverSession(bytes), memoryBytes: () => memory.buffer.byteLength,
        provenance: { buildHash: manifest.buildHash, sourceHash: manifest.sourceHash, engineCommit: manifest.engineCommit,
          sourceUrl: "source/BUILD.txt", licenseUrl: "LICENSES.txt" } }),
    });
    await runtime.handle(request(spot));
    return events;
  };
  const good = await run(full);
  assert.equal(good.at(-1)?.type, "result", JSON.stringify(good.at(-1)));
  const estimate = good.find(e => e.type === "estimate");
  assert.equal(estimate?.type === "estimate" && estimate.verdict.budgetBytes, 192 * 1024 ** 2);
  const missed = await run({ ...full, solve: { ...full.solve, maxIterations: 1 } });
  assert.ok(missed.some(e => e.type === "progress" && e.stage === "solving"), JSON.stringify(missed));
  assert.ok(!missed.some(e => e.type === "result"));
  assert.equal(missed.at(-1)?.type, "error");
  const error = missed.at(-1);
  assert.match(error?.type === "error" ? error.message : "", /quality target/i);
  for (const stage of ["building", "solving", "exporting", "checking"]) {
    const cancelled = await run(full, stage);
    assert.equal(cancelled.at(-1)?.type, "cancelled", stage);
    assert.ok(!cancelled.some(e => e.type === "result" || e.type === "error"), stage);
  }
});
