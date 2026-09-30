/** W1 test tooling, NOT a browser admission layer or production Worker runtime. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkBridgeResult, POSTFLOP_SOLVER_COMMIT, type BridgeResultV1, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";

export interface WasmStatus {
  iterations: number; maxIterations: number; measuredAtIteration: number | null; exploitability: number | null;
  target: number; allocated: boolean; done: boolean; failed: boolean; elapsedMs: number; linearMemoryBytes: number;
}
export interface WasmSession {
  estimate(): string; status(): string; allocate(): string; step(count: number): string; root_strategy(): string;
  finish(): string; free(): void;
}
export interface WasmBindings {
  SolverSession: new(bytes: Uint8Array) => WasmSession;
  initSync(options: { module: Uint8Array }): { memory: WebAssembly.Memory };
}
export interface WasmBuild {
  format: "poker-face-bridge-wasm-build"; version: 1; mode: "single-thread"; buildHash: string;
  sourceHash: string; engineCommit: string; files: Record<string, { sha256: string; bytes: number }>;
}
export const WASM_BUILD_ROOT = resolve("native/solver-bridge-wasm/target/web");
export function wasmBuild() {
  const manifest: WasmBuild = JSON.parse(readFileSync(join(WASM_BUILD_ROOT, "manifest.json"), "utf8"));
  assert.equal(manifest.format, "poker-face-bridge-wasm-build");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.mode, "single-thread");
  assert.match(manifest.buildHash, /^[a-f0-9]{64}$/);
  const { buildHash, ...contents } = manifest;
  assert.equal(createHash("sha256").update(JSON.stringify(contents, null, 2) + "\n").digest("hex"), buildHash, "manifest hash");
  assert.equal(manifest.engineCommit, POSTFLOP_SOLVER_COMMIT);
  const directory = join(WASM_BUILD_ROOT, manifest.buildHash);
  for (const [name, entry] of Object.entries(manifest.files)) {
    if (name.startsWith("source/native/") || name === "source/scripts/build-bridge-wasm.mjs" || name === "source/LICENSE") {
      const current = readFileSync(name.slice("source/".length));
      assert.equal(createHash("sha256").update(current).digest("hex"), entry.sha256, `${name}: stale WASM build; run build:wasm`);
    }
  }
  for (const name of ["solver_bridge_wasm.js", "solver_bridge_wasm_bg.wasm", "LICENSES.txt"]) {
    const bytes = readFileSync(join(directory, name));
    assert.equal(bytes.length, manifest.files[name].bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.files[name].sha256);
  }
  return { directory, manifest };
}
export async function loadWasm() {
  const build = wasmBuild();
  const bindings: WasmBindings = await import(pathToFileURL(join(build.directory, "solver_bridge_wasm.js")).href);
  const instance = bindings.initSync({ module: readFileSync(join(build.directory, "solver_bridge_wasm_bg.wasm")) });
  assert.ok(instance.memory.buffer instanceof ArrayBuffer, "ST must not use shared memory");
  return { ...build, bindings, memory: instance.memory };
}
export function wasmSpotBytes(spot: BridgeSpotV1): Uint8Array {
  return new TextEncoder().encode(canonicalBridgeSpotJson(spot));
}
export function runWasmSpot(bindings: WasmBindings, spot: BridgeSpotV1, chunk = 7): BridgeResultV1 {
  if (!Number.isSafeInteger(chunk) || chunk < 1 || chunk > 0xffff_ffff) throw new Error("Invalid chunk size");
  const session = new bindings.SolverSession(wasmSpotBytes(spot));
  try {
    let status: WasmStatus = JSON.parse(session.allocate());
    while (!status.done) {
      status = JSON.parse(session.step(chunk));
      assert.ok(status.measuredAtIteration! <= status.iterations);
      assert.equal(JSON.parse(session.root_strategy()).iteration, status.iterations);
    }
    return checkBridgeResult(JSON.parse(session.finish()), spot, hashBridgeSpot(spot));
  } finally { session.free(); }
}

/** Structural equality is exact. Numeric discrepancies are measured, never hidden by rounding. */
export function compareBridgeResults(native: BridgeResultV1, wasm: BridgeResultV1) {
  assert.equal(wasm.spotHash, native.spotHash);
  assert.deepEqual(wasm.engine, { ...native.engine, threads: 1 });
  assert.deepEqual(wasm.hands, native.hands);
  assert.deepEqual(wasm.counts, native.counts);
  assert.equal(wasm.iterations, native.iterations);
  assert.deepEqual(wasm.convergence.map(c => c.iteration), native.convergence.map(c => c.iteration));
  let maxStrategy = 0, maxRootEv = 0, maxEquity = 0, maxWeights = 0;
  assert.equal(wasm.tree.length, native.tree.length);
  for (let n = 0; n < wasm.tree.length; n++) {
    const w = wasm.tree[n], b = native.tree[n];
    if (w.kind === "player" && b.kind === "player") {
      const { strategy: ws, ...wt } = w, { strategy: bs, ...bt } = b;
      assert.deepEqual(wt, bt, `public tree at ${n}`);
      assert.equal(ws.length, bs.length);
      ws.forEach((row, a) => {
        assert.equal(row.length, bs[a].length);
        row.forEach((p, h) => {
          const q = bs[a][h];
          if (p === null || q === null) assert.equal(p, q, `blocked hand at ${n}/${a}/${h}`);
          else maxStrategy = Math.max(maxStrategy, Math.abs(p - q));
        });
      });
    } else assert.deepEqual(w, b);
  }
  for (const p of [0, 1] as const) {
    wasm.root.ev[p].forEach((v, h) => { maxRootEv = Math.max(maxRootEv, Math.abs(v - native.root.ev[p][h])); });
    wasm.root.engineEv[p].forEach((v, h) => { maxRootEv = Math.max(maxRootEv, Math.abs(v - native.root.engineEv[p][h])); });
    wasm.root.equity[p].forEach((v, h) => { maxEquity = Math.max(maxEquity, Math.abs(v - native.root.equity[p][h])); });
    wasm.root.weights[p].forEach((v, h) => { maxWeights = Math.max(maxWeights, Math.abs(v - native.root.weights[p][h])); });
  }
  const maxCheckpoint = Math.max(...wasm.convergence.map((c, n) => Math.abs(c.exploitability - native.convergence[n].exploitability)));
  const exploitability = Math.abs(wasm.exploitability.chips - native.exploitability.chips);
  return { maxStrategy, maxRootEv, maxEquity, maxWeights, maxCheckpoint, exploitability };
}
