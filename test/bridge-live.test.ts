import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { POSTFLOP_SOLVER_COMMIT, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { parseLiveSpot, parseLiveEstimate, admitBrowserSolve, LIVE_LIMITS } from "../src/lib/solver/bridge/live/admission";
import { createLiveRuntime, type LiveHost } from "../src/lib/solver/bridge/live/runtime";
import { createLiveClient, type LiveWorker } from "../src/lib/solver/bridge/live/client";
import type { LiveCommand, LiveEngine, LiveEvent, LiveSession, LiveStatus } from "../src/lib/solver/bridge/live/model";
import { compareBridgeResults, loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";

const wasmAvailable = existsSync(join(WASM_BUILD_ROOT, "manifest.json"));
if (process.env.npm_lifecycle_event === "test:wasm:live") assert.ok(wasmAvailable, "run npm run build:wasm first");

function spot(id: "referee-river-v3-demo" | "referee-turn-v2-dry-value" = "referee-river-v3-demo"): BridgeSpotV1 {
  const s = buildBridgeFixture(id);
  return { ...s, solve: { ...s.solve, maxIterations: 23, timeoutMs: 120_000, targetExploitabilityPctPot: 1e-9 } };
}
const request = (s = spot()): Exclude<LiveCommand, { type: "cancel" }> => ({ type: "solve", id: 1,
  spotJson: canonicalBridgeSpotJson(s), assetBase: "/wasm/" + "a".repeat(64) + "/", environment: { profile: "unknown" } });
const provenance: LiveEngine["provenance"] = { buildHash: "a".repeat(64), sourceHash: "b".repeat(64),
  engineCommit: POSTFLOP_SOLVER_COMMIT, sourceUrl: "source/BUILD.txt", licenseUrl: "LICENSES.txt" };
const hash = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function fake(s = spot()) {
  const events: LiveEvent[] = [], calls: string[] = []; let now = 0, iteration = 0, measured = 0, grade = 1, allocated = false;
  const status = (): LiveStatus => ({ iterations: iteration, maxIterations: s.solve.maxIterations, measuredAtIteration: measured,
    exploitability: grade, target: s.startingPot * s.solve.targetExploitabilityPctPot / 100, allocated, done: iteration === s.solve.maxIterations,
    failed: false, elapsedMs: now, linearMemoryBytes: 2 ** 20 });
  const estimate = { type: "estimate", spotId: s.id, spotHash: hashBridgeSpot(s), hands: s.ranges.map(r => r.combos.length),
    estimatedBytes: 1024, estimatedCompressedBytes: 512, memoryCapBytes: s.solve.memoryCapBytes,
    estimateExport: { version: 1, basis: "public-tree-upper-bound", scope: s.solve.exportScope,
      nodes: 100, cells: 1000, edges: 99, jsonBytesUpperBound: 200_000, workingBytesEstimate: 2_000_000 } };
  const rows = s.ranges.map(r => r.combos.map(() => 0));
  const result = () => ({ format: "poker-face-bridge-result", version: 1, spotId: s.id, spotHash: hashBridgeSpot(s),
    engine: { name: "postflop-solver", commit: POSTFLOP_SOLVER_COMMIT, algorithm: "discounted-cfr", precision: "float32", threads: 1 },
    hands: s.ranges.map(r => r.combos.map(h => h.combo)), root: { ev: rows, engineEv: rows, weights: rows, equity: rows },
    tree: [{ id: 0, kind: "terminal" }], iterations: iteration, exploitability: { chips: grade }, counts: { exportedNodes: 1 } });
  const session: LiveSession = {
    estimate: () => { calls.push("estimate"); return JSON.stringify(estimate); }, status: () => JSON.stringify(status()),
    allocate: () => { calls.push("allocate"); allocated = true; return JSON.stringify(status()); },
    step: n => { calls.push(`step:${n}`); for (let i = 0; i < n && iteration < s.solve.maxIterations; i++) {
      iteration++; if (iteration % 10 === 0 || iteration === s.solve.maxIterations) { measured = iteration; grade /= 2; }
    } now += n * 10; return JSON.stringify(status()); },
    root_strategy: () => { calls.push("preview"); return JSON.stringify({ type: "preview", final: false, iteration,
      hands: s.ranges[0].combos.map(h => h.combo), engineActions: ["Check"], strategy: [s.ranges[0].combos.map(() => 1)] }); },
    finish: () => { calls.push("finish"); return JSON.stringify(result()); }, free: () => { calls.push("free"); },
  };
  const engine: LiveEngine = { create: () => { calls.push("create"); return session; }, memoryBytes: () => 2 ** 20, provenance };
  const host: LiveHost = { emit: e => events.push(e), now: () => now, yield: async () => { now++; }, hash,
    load: async () => { calls.push("load"); return engine; }, close: () => { calls.push("close"); } };
  return { events, calls, session, engine, host, estimate, advance: (n: number) => { now += n; } };
}

test("live preflight bounds JSON and rejects unsupported inputs before loading WASM", async () => {
  const base = spot(), flop = buildBridgeFixture("referee-flop-reference");
  for (const s of [flop, { ...base, solve: { ...base.solve, compression: "auto" } },
    { ...base, solve: { ...base.solve, maxIterations: 10001 } },
    { ...base, solve: { ...base.solve, timeoutMs: 120001 } }]) {
    const f = fake(); await createLiveRuntime(f.host).handle(request(s as BridgeSpotV1));
    assert.deepEqual(f.calls, ["close"]); assert.equal(f.events.at(-1)?.type, "error");
  }
  assert.throws(() => parseLiveSpot(" ".repeat(LIVE_LIMITS.inputBytes + 1)), /256 KiB/);
  assert.throws(() => parseLiveSpot("[".repeat(101) + "0" + "]".repeat(101)), /complex/);
  assert.throws(() => parseLiveSpot(JSON.stringify(Array(10001).fill(null))), /complex/);
  assert.equal(parseLiveSpot(request().spotJson).id, base.id);
});

test("raw menu construction is bounded before upstream tree building", () => {
  const base = spot("referee-turn-v2-dry-value");
  const menu = { oop: { bet: [{ kind: "pot", pct: 50 }], raise: [{ kind: "prevBet", multiple: 2 }] },
    ip: { bet: [{ kind: "allin" }], raise: [] } };
  const tree = { mode: "menu", flop: null, turn: menu, river: menu, turnDonk: null, riverDonk: null,
    addAllInThreshold: 0, forceAllInThreshold: 0, mergingThreshold: 0, maxRaisesPerStreet: 1 };
  const parse = (change: object) => parseLiveSpot(JSON.stringify({ ...base, tree, ...change }));
  assert.equal(parse({}).tree.mode, "menu");
  assert.throws(() => parse({ effectiveStack: base.startingPot * 11 }), /stack\/pot/);
  assert.throws(() => parse({ tree: { ...tree, maxRaisesPerStreet: null } }), /raise limit/);
  assert.throws(() => parse({ tree: { ...tree, addAllInThreshold: 1.5 } }), /addAllInThreshold/);
  for (const bet of [[{ kind: "pot", pct: 10 }], [{ kind: "chips", amount: 1, additive: 0 }],
    [{ kind: "pot", pct: 25 }, { kind: "pot", pct: 50 }, { kind: "pot", pct: 75 }]]) {
    assert.throws(() => parse({ tree: { ...tree, river: { ...menu, oop: { bet, raise: [] } } } }));
  }
});

test("admission requires a matching versioned export estimate and uses both overheads", () => {
  const f = fake(), s = spot(), parse = () => parseLiveEstimate(JSON.stringify(f.estimate), s, hashBridgeSpot(s));
  const e = parse(), verdict = admitBrowserSolve(e, { profile: "desktop-chromium", deviceMemoryGiB: 8 }, 2 ** 20);
  assert.equal(verdict.ok, true); assert.equal(verdict.budgetBytes, 256 * 1024 ** 2);
  assert.equal(verdict.totalBytes, e.estimatedBytes + e.estimateExport.workingBytesEstimate + 128 * 1024 ** 2 + 2 ** 20);
  assert.equal(admitBrowserSolve(e, { profile: "unknown", deviceMemoryGiB: .25 }, 2 ** 20).ok, false);
  assert.equal(admitBrowserSolve({ ...e, estimateExport: { ...e.estimateExport, nodes: 100001 } }, { profile: "unknown" }, 0).ok, false);
  f.estimate.estimateExport.version = 2; assert.throws(parse, /versioned/); f.estimate.estimateExport.version = 1;
  f.estimate.spotHash = "0".repeat(64); assert.throws(parse, /different spot/);
});

test("runtime allocates once, reports completed work and stale checkpoint honestly, limits previews", async () => {
  const f = fake(), runtime = createLiveRuntime(f.host); await runtime.handle(request());
  assert.equal(f.events.at(-1)?.type, "result", JSON.stringify(f.events.at(-1)));
  assert.equal(f.calls.filter(c => c === "create").length, 1); assert.equal(f.calls.filter(c => c === "allocate").length, 1);
  assert.equal(f.calls.filter(c => c === "finish").length, 1); assert.equal(f.calls.filter(c => c === "free").length, 1);
  const progress = f.events.filter(e => e.type === "progress" && e.status);
  assert.ok(progress.some(e => e.type === "progress" && e.status!.iterations === 1 && e.status!.measuredAtIteration === 0));
  assert.equal(f.events.filter(e => e.type === "preview").length, 1);
  const count = f.calls.length; await runtime.handle({ ...request(), id: 2 }); assert.equal(f.calls.length, count);
});

test("estimate-only and refused solves never allocate strategy storage", async () => {
  for (const mode of ["estimate", "refuse"] as const) {
    const f = fake(); if (mode === "refuse") f.estimate.estimatedBytes = 1024 ** 3;
    await createLiveRuntime(f.host).handle({ ...request(), type: mode === "estimate" ? "estimate" : "solve" });
    assert.equal(f.events.at(-1)?.type, "estimate"); assert.ok(!f.calls.includes("allocate"));
    assert.deepEqual(f.calls.slice(-2), ["free", "close"]);
  }
});

for (const stage of ["loading", "building", "allocating", "solving", "exporting", "checking"] as const) {
  test(`cancel at ${stage} revokes result publication and frees the session`, async () => {
    const f = fake(), runtime = createLiveRuntime(f.host); const emit = f.host.emit;
    f.host.emit = event => { emit(event); if (event.type === "progress" && event.stage === stage) void runtime.handle({ type: "cancel", id: 1 }); };
    await runtime.handle(request());
    assert.equal(f.events.at(-1)?.type, "cancelled"); assert.ok(!f.events.some(e => e.type === "result" || e.type === "error"));
    if (f.calls.includes("create")) assert.ok(f.calls.includes("free"));
  });
}

test("cancel queued during synchronous finish wins; stale cancel IDs cannot stop this job", async () => {
  const f = fake(), runtime = createLiveRuntime(f.host); const finish = f.session.finish;
  f.session.finish = () => { const result = finish(); void runtime.handle({ type: "cancel", id: 1 }); return result; };
  await runtime.handle({ type: "cancel", id: 99 }); await runtime.handle(request());
  assert.equal(f.events.at(-1)?.type, "cancelled"); assert.ok(!f.events.some(e => e.type === "result"));
  const other = fake(), r = createLiveRuntime(other.host), emit = other.host.emit;
  other.host.emit = e => { emit(e); void r.handle({ type: "cancel", id: 99 }); };
  await r.handle(request()); assert.equal(other.events.at(-1)?.type, "result");
});

test("WASM trap retires the instance without calling free or exporting", async () => {
  const f = fake(); f.session.step = () => { throw new WebAssembly.RuntimeError("unreachable"); };
  await createLiveRuntime(f.host).handle(request());
  assert.equal(f.events.at(-1)?.type, "error"); assert.ok(!f.calls.includes("free")); assert.ok(!f.calls.includes("finish"));
  assert.equal(f.calls.at(-1), "close");
});

test("malformed status, excessive memory, export overrun, loading and export timeout fail closed", async () => {
  for (const kind of ["status", "memory", "export", "load-time", "export-time"]) {
    const f = fake();
    if (kind === "status") f.session.allocate = () => "{}";
    if (kind === "memory") { const allocate = f.session.allocate; f.session.allocate = () => { f.engine.memoryBytes = () => 512 * 1024 ** 2; return allocate(); }; }
    if (kind === "export") f.session.finish = () => " ".repeat(200001);
    if (kind === "load-time") f.host.load = async () => { f.advance(120001); return f.engine; };
    if (kind === "export-time") { const finish = f.session.finish; f.session.finish = () => { f.advance(120001); return finish(); }; }
    await createLiveRuntime(f.host).handle(request()); assert.equal(f.events.at(-1)?.type, "error", kind);
    assert.ok(!f.events.some(e => e.type === "result"));
  }
});

function clientHarness() {
  const events: LiveEvent[] = [], workers: (LiveWorker & { stopped: boolean; sent: LiveCommand[] })[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>(); let seq = 0;
  const client = createLiveClient({ now: () => 42,
    createWorker: () => { const w = { stopped: false, sent: [] as LiveCommand[], onmessage: null, onerror: null, onmessageerror: null,
      postMessage(command: LiveCommand) { this.sent.push(command); }, terminate() { this.stopped = true; } }; workers.push(w); return w; },
    setTimer: (callback, ms) => { const id = ++seq; timers.set(id, { callback, ms }); return id; },
    clearTimer: id => { timers.delete(id as number); },
  }, e => events.push(e));
  const send = (event: LiveEvent, index = workers.length - 1) => workers[index].onmessage?.({ data: event } as MessageEvent<LiveEvent>);
  return { client, events, workers, timers, send };
}

test("client cancellation suppresses late results, hard-terminates after grace, and starts fresh", () => {
  const h = clientHarness(), id = h.client.start(request()), late = h.workers[0].onmessage!;
  h.client.cancel(); assert.equal([...h.timers.values()][0].ms, LIVE_LIMITS.cancelGraceMs);
  h.send({ type: "error", id, message: "late" }); assert.equal(h.events.length, 0);
  [...h.timers.values()][0].callback(); assert.equal(h.events.at(-1)?.type, "cancelled"); assert.equal(h.workers[0].stopped, true);
  const next = h.client.start(request()); assert.equal(next, id + 1);
  late({ data: { type: "error", id, message: "stale" } } as MessageEvent<LiveEvent>); assert.equal(h.events.length, 1);
  h.client.dispose(); assert.equal(h.workers[1].stopped, true); assert.equal(h.timers.size, 0);
  assert.throws(() => h.client.start(request()), /disposed/);
});

test("client acknowledges cooperative cancellation and times out unresponsive Workers", () => {
  const h = clientHarness(), id = h.client.start(request()); h.client.cancel();
  h.send({ type: "cancelled", id, hard: false, elapsedMs: 1 }); assert.deepEqual(h.events.at(-1), { type: "cancelled", id, hard: false, elapsedMs: 0 });
  h.client.start(request()); [...h.timers.values()][0].callback(); assert.equal(h.events.at(-1)?.type, "error");
  assert.ok(h.workers.every(w => w.stopped)); assert.equal(h.timers.size, 0);
});

test("a Worker error during cancellation stays cancelled, never becomes a late error/result", () => {
  const h = clientHarness(), id = h.client.start(request()); h.client.cancel();
  h.workers[0].onerror?.({ preventDefault() {} } as ErrorEvent);
  assert.deepEqual(h.events, [{ type: "cancelled", id, hard: true, elapsedMs: 0 }]);
  assert.equal(h.timers.size, 0); assert.equal(h.workers[0].stopped, true);
});

test("client cleans up construction/post failures, duplicate finals, errors and disposal", () => {
  const h = clientHarness(), id = h.client.start(request()), old = h.workers[0].onmessage!;
  h.send({ type: "error", id, message: "failed" }); old({ data: { type: "error", id, message: "duplicate" } } as MessageEvent<LiveEvent>);
  assert.equal(h.events.length, 1); assert.equal(h.timers.size, 0);
  h.client.start(request()); h.workers[1].onmessageerror?.({} as MessageEvent); assert.equal(h.events.length, 2);
  h.client.start(request()); h.workers[2].onerror?.({ preventDefault() {} } as ErrorEvent); assert.equal(h.events.length, 3);
  h.client.start(request()); h.client.dispose(); assert.equal(h.events.length, 3); assert.ok(h.workers.every(w => w.stopped));
  const events: LiveEvent[] = [];
  const client = createLiveClient({ createWorker: () => { throw new Error("CSP refused Worker"); }, now: () => 0,
    setTimer: () => 0, clearTimer: () => {} }, e => events.push(e));
  client.start(request()); assert.equal(events[0].type, "error");
});

test("actual production runtime agrees exactly with an uninterrupted WASM solve", {
  skip: wasmAvailable ? false : "run npm run build:wasm",
}, async () => {
  const { bindings, memory, manifest } = await loadWasm();
  for (const id of ["referee-river-v3-demo", "referee-turn-v2-dry-value"] as const) {
    const s = spot(id), expected = runWasmSpot(bindings, s), events: LiveEvent[] = [];
    const runtime = createLiveRuntime({ emit: e => events.push(e), now: () => performance.now(), yield: async () => {}, hash,
      load: async () => ({ create: bytes => new bindings.SolverSession(bytes), memoryBytes: () => memory.buffer.byteLength,
        provenance: { ...provenance, buildHash: manifest.buildHash, sourceHash: manifest.sourceHash } }), close: () => {} });
    await runtime.handle(request(s)); const final = events.at(-1);
    assert.equal(final?.type, "result", JSON.stringify(final)); if (final?.type !== "result") throw new Error("no result");
    assert.ok(Object.values(compareBridgeResults(expected, final.result)).every(n => n === 0));
  }
});
