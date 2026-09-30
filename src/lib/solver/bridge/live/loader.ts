import { POSTFLOP_SOLVER_COMMIT } from "../contract";
import type { LiveEngine, LiveSession } from "./model";

export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Same-origin immutable W1 distribution: source + licenses must ship alongside the binary.
 * Hashes detect stale/mixed deployment, not a malicious same-origin server. */
export async function loadLiveEngine(assetBase: string): Promise<LiveEngine> {
  const base = new URL(assetBase, globalThis.location.href);
  const match = base.pathname.match(/\/([a-f0-9]{64})\/$/);
  if (!match || base.origin !== globalThis.location.origin || base.search || base.hash || base.username || base.password) {
    throw new Error("Expected a same-origin, content-addressed WASM asset directory.");
  }
  async function read(name: string, limit: number): Promise<Uint8Array> {
    const response = await fetch(new URL(name, base), { credentials: "same-origin", redirect: "error" });
    if (!response.ok || !response.body) throw new Error(`WASM asset unavailable: ${name}`);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.length; if (length > limit) throw new Error(`WASM asset too large: ${name}`);
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return bytes;
  }
  const manifest = JSON.parse(new TextDecoder().decode(await read("manifest.json", 2 * 1024 ** 2)));
  const { buildHash, ...contents } = manifest;
  if (buildHash !== match[1] || await sha256(new TextEncoder().encode(JSON.stringify(contents, null, 2) + "\n")) !== buildHash
    || manifest.format !== "poker-face-bridge-wasm-build" || manifest.version !== 1 || manifest.mode !== "single-thread"
    || manifest.engineCommit !== POSTFLOP_SOLVER_COMMIT || !/^[a-f0-9]{64}$/.test(manifest.sourceHash)) throw new Error("WASM manifest mismatch.");
  const verified = async (name: string, limit: number) => {
    const bytes = await read(name, limit), entry = manifest.files?.[name];
    if (!entry || entry.bytes !== bytes.length || entry.sha256 !== await sha256(bytes)) throw new Error(`WASM asset hash mismatch: ${name}`);
    return bytes;
  };
  const [module] = await Promise.all([
    verified("solver_bridge_wasm_bg.wasm", 8 * 1024 ** 2), verified("solver_bridge_wasm.js", 1024 ** 2),
    verified("LICENSES.txt", 2 * 1024 ** 2), verified("source/BUILD.txt", 64 * 1024),
  ]);
  // The server must keep hash directories immutable. A dynamic URL keeps these generated
  // assets out of Next's module graph; this is the documented external-runtime import form.
  const url = new URL("solver_bridge_wasm.js", base).href;
  const bindings = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as {
    SolverSession: new(bytes: Uint8Array) => LiveSession;
    initSync(options: { module: Uint8Array }): { memory: WebAssembly.Memory };
  };
  const { memory } = bindings.initSync({ module });
  if (!(memory.buffer instanceof ArrayBuffer)) throw new Error("Unexpected shared WASM memory in single-threaded build.");
  return { create: bytes => new bindings.SolverSession(bytes), memoryBytes: () => memory.buffer.byteLength,
    provenance: { buildHash, sourceHash: manifest.sourceHash, engineCommit: manifest.engineCommit,
      sourceUrl: new URL("source/BUILD.txt", base).href, licenseUrl: new URL("LICENSES.txt", base).href } };
}
