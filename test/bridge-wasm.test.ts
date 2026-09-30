import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { WASM_BUILD_ROOT, compareBridgeResults, loadWasm, runWasmSpot, wasmSpotBytes } from "../scripts/bridge-wasm-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";

const available = existsSync(join(WASM_BUILD_ROOT, "manifest.json"));
if (process.env.npm_lifecycle_event === "test:wasm") assert.ok(available, "run npm run build:wasm first");
const wasmTest = (name: string, body: () => Promise<void>) => test(name, { skip: available ? false : "run npm run build:wasm" }, body);
const fixture = () => {
  const base = buildBridgeFixture("referee-river-v3-demo");
  return { ...base, solve: { ...base.solve, maxIterations: 23, targetExploitabilityPctPot: 1e-9 } };
};

wasmTest("WASM session rejects invalid inputs, allocation misuse and premature finish", async () => {
  const { bindings } = await loadWasm();
  assert.throws(() => new bindings.SolverSession(new TextEncoder().encode("{}")));
  const session = new bindings.SolverSession(wasmSpotBytes(fixture()));
  try {
    assert.equal(JSON.parse(session.status()).allocated, false);
    assert.equal(JSON.parse(session.status()).exploitability, null);
    assert.throws(() => session.step(1));
    assert.throws(() => session.root_strategy());
    assert.throws(() => session.finish());
    session.allocate();
    assert.throws(() => session.allocate());
    assert.throws(() => session.step(0));
    for (const invalid of [-1, 0.5, NaN, Infinity, 2 ** 32]) assert.throws(() => session.step(invalid));
    const status = JSON.parse(session.step(3));
    assert.equal(status.iterations, 3);
    assert.equal(status.measuredAtIteration, 0);
    assert.ok(status.linearMemoryBytes > 0);
    const preview = JSON.parse(session.root_strategy());
    assert.equal(preview.final, false);
    assert.equal(preview.iteration, 3);
    assert.equal(preview.ev, undefined);
    assert.throws(() => session.finish());
    assert.equal(JSON.parse(session.step(100)).iterations, 23);
    const result = JSON.parse(session.finish());
    assert.equal(result.memory.peakRssBytes, 0, "unavailable, not fabricated RSS");
    assert.equal(result.engine.threads, 1);
    assert.deepEqual(result.convergence.map((c: { iteration: number }) => c.iteration), [0, 10, 20, 23]);
    assert.throws(() => session.finish());
    assert.throws(() => session.step(1));
  } finally { session.free(); }
});

wasmTest("WASM chunks and previews do not restart or alter the solve", async () => {
  const { bindings } = await loadWasm(), spot = fixture();
  const once = runWasmSpot(bindings, spot, 100);
  for (const chunk of [1, 3, 7, 10]) {
    assert.ok(Object.values(compareBridgeResults(once, runWasmSpot(bindings, spot, chunk))).every(n => n === 0));
  }
  assert.throws(() => runWasmSpot(bindings, spot, -1));
  assert.throws(() => runWasmSpot(bindings, spot, 0.5));
});

wasmTest("WASM refuses strategy storage above cap and a dropped solve leaves a new solve at zero", async () => {
  const { bindings } = await loadWasm(), base = fixture();
  const small = new bindings.SolverSession(wasmSpotBytes({ ...base, solve: { ...base.solve, memoryCapBytes: 1 } }));
  try {
    assert.ok(JSON.parse(small.estimate()).estimatedBytes > 1);
    assert.throws(() => small.allocate());
    assert.equal(JSON.parse(small.status()).allocated, false);
  } finally { small.free(); }
  const interrupted = new bindings.SolverSession(wasmSpotBytes(base));
  interrupted.allocate(); interrupted.step(3); interrupted.free();
  const fresh = new bindings.SolverSession(wasmSpotBytes(base));
  try { assert.equal(JSON.parse(fresh.allocate()).iterations, 0); } finally { fresh.free(); }
});

wasmTest("WASM wall-clock timeout includes time spent between chunks and prohibits a result", async () => {
  const { bindings } = await loadWasm(), base = fixture();
  const session = new bindings.SolverSession(wasmSpotBytes({ ...base, solve: { ...base.solve, timeoutMs: 1 } }));
  try {
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.throws(() => session.allocate());
    assert.equal(JSON.parse(session.status()).failed, true);
    assert.throws(() => session.step(1));
    assert.throws(() => session.finish());
  } finally { session.free(); }
});
