/** P3 offline cache capture. Freeze -> estimate ALL roots -> solve; immutable observations.
 * Native estimates are not browser peak-memory observations or admission certificates.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";
import { BRIDGE_BINARY, runBridgeSpot } from "./bridge-runner";
import { wasmBuild } from "./bridge-wasm-runner";
import { commonTurnRoots, type CommonTurnRoot } from "./hu-play-turn-warmup";
import { mathProjection } from "./hu-play-wide-measurement";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { admitBrowserSolve, parseLiveEstimate } from "../src/lib/solver/bridge/live/admission";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { buildPlaySpot, requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { createTurnCacheChunk, TURN_CACHE_PREFIX, type TurnCacheIdentity, type TurnCacheRef } from "../src/lib/hu-play/sources/turn-cache";

const execute = promisify(execFile);
const digest = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const bytesOf = (v: unknown) => Buffer.from(canonicalSolverJson(v) + "\n");
const write = (p: string, v: unknown) => writeFileSync(p, bytesOf(v), { flag: "wx" });
interface Source { path: string; sha256: string }
export interface TurnCacheInputs {
  format: "poker-face-turn-cache-inputs"; version: 1; identity: TurnCacheIdentity;
  librarySha256: string; supplementSha256: string; nativeBinarySha256: string;
  selectionSources: Source[]; roots: CommonTurnRoot[];
}
const selectionPaths = ["scripts/capture-hu-play-turn-cache.ts", "scripts/hu-play-turn-warmup.ts",
  "src/lib/hu-play/sources/library-data.ts", "src/lib/hu-play/sources/library.ts", "src/lib/hu-play/sources/policy.ts",
  "src/lib/hu-play/sources/resolved.ts", "src/lib/hu-play/reach.ts", "src/lib/hu-play/resolve-spot.ts",
  "src/lib/hu-play/public-state.ts", "src/lib/solver/bridge/live/play-profile.ts"];

function checkInputs(v: TurnCacheInputs) {
  assert.equal(v.format, "poker-face-turn-cache-inputs"); assert.equal(v.version, 1);
  assert.ok(Array.isArray(v.roots) && v.roots.length > 0 && v.roots.length <= 2352);
  for (const h of [v.librarySha256, v.supplementSha256, v.nativeBinarySha256]) assert.match(h, /^[a-f0-9]{64}$/);
  const hashes = new Set<string>();
  for (const root of v.roots) {
    if (root.status === "unsupported") { assert.ok(root.reason); continue; }
    assert.equal(root.status, "ready"); assert.deepEqual(root.spot, buildPlaySpot(root.request));
    assert.equal(root.spotHash, hashBridgeSpot(root.spot), "Frozen spot hash");
    assert.equal(root.turn, root.spot.board.turn); assert.equal(root.spot.board.river, null);
    assert.ok(!hashes.has(root.spotHash), "Duplicate frozen spot"); hashes.add(root.spotHash);
  }
}
export function writeTurnCacheInputs(directory: string, inputs: TurnCacheInputs): string {
  assert.ok(!existsSync(join(directory, "inputs.json")) && !existsSync(join(directory, "inputs.json.gz")), "Inputs already exist; never overwrite");
  checkInputs(inputs);
  const plain = bytesOf(inputs), hash = digest(plain), bytes = gzipSync(plain, { level: 9 });
  writeFileSync(join(directory, "inputs.json.gz"), bytes, { flag: "wx" });
  write(join(directory, "inputs.json"), { format: "poker-face-turn-cache-inputs-bundle", version: 1,
    sha256: digest(bytes), bytes: bytes.length, plainBytes: plain.length, inputsHash: hash, roots: inputs.roots.length });
  return hash;
}
export function readTurnCacheInputs(directory: string): { inputs: TurnCacheInputs; hash: string } {
  const meta = JSON.parse(readFileSync(join(directory, "inputs.json"), "utf8"));
  assert.equal(meta.format, "poker-face-turn-cache-inputs-bundle"); assert.equal(meta.version, 1);
  const path = join(directory, "inputs.json.gz"); assert.ok(statSync(path).size <= 128 * 1024 ** 2);
  const bytes = readFileSync(path); assert.equal(bytes.length, meta.bytes); assert.equal(digest(bytes), meta.sha256, "Input archive integrity/hash");
  const plain = gunzipSync(bytes, { maxOutputLength: 512 * 1024 ** 2 });
  assert.equal(plain.length, meta.plainBytes); assert.equal(digest(plain), meta.inputsHash);
  const inputs: TurnCacheInputs = JSON.parse(plain.toString("utf8")); checkInputs(inputs);
  assert.equal(inputs.roots.length, meta.roots); return { inputs, hash: meta.inputsHash };
}

async function main() {
  const [mode, path, ...rest] = process.argv.slice(2);
  assert.ok(["--freeze", "--estimate", "--solve"].includes(mode) && path && !rest.length,
    "Use --freeze NEW_DIRECTORY, --estimate DIRECTORY, then --solve DIRECTORY");
  const directory = resolve(path), { manifest } = wasmBuild(); // rejects stale native/WASM source inputs
  const bridgeVersion = readFileSync("native/solver-bridge/Cargo.toml", "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(bridgeVersion, "Missing bridge package version");
  const identity: TurnCacheIdentity = { engineCommit: manifest.engineCommit, buildHash: manifest.buildHash,
    sourceHash: manifest.sourceHash, bridgeVersion };
  // The contract result's bridge version is checked again on every captured solve.
  const nativeBinarySha256 = digest(readFileSync(BRIDGE_BINARY));
  if (mode === "--freeze") {
    assert.ok(!existsSync(directory), "Use a new input directory"); mkdirSync(directory);
    const fetcher: typeof fetch = async input => {
      assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(input).includes(".."));
      return new Response(readFileSync(`public${input}`));
    };
    const catalog = await loadPlayCatalog(undefined, fetcher), roots = await commonTurnRoots(catalog, fetcher);
    assert.equal(roots.length, 2352, "Freeze the COMPLETE prospective common-root corpus");
    const inputs: TurnCacheInputs = { format: "poker-face-turn-cache-inputs", version: 1, identity, nativeBinarySha256,
      librarySha256: digest(readFileSync("public/solver-data/bridge-v1/manifest.json")),
      supplementSha256: digest(readFileSync("public/solver-data/hu-play-v1/manifest.json")),
      selectionSources: selectionPaths.map(path => ({ path, sha256: digest(readFileSync(path)) })), roots };
    const hash = writeTurnCacheInputs(directory, inputs);
    console.log(JSON.stringify({ directory, inputsHash: hash, roots: roots.length,
      unsupported: roots.filter(r => r.status === "unsupported").length })); return;
  }
  const { inputs, hash } = readTurnCacheInputs(directory);
  assert.equal(inputs.roots.length, 2352); assert.deepEqual(inputs.identity, identity);
  assert.equal(inputs.nativeBinarySha256, nativeBinarySha256, "Native binary changed after freeze");
  for (const s of inputs.selectionSources) assert.equal(digest(readFileSync(s.path)), s.sha256, `Input selection source changed: ${s.path}`);
  assert.equal(inputs.librarySha256, digest(readFileSync("public/solver-data/bridge-v1/manifest.json")));
  assert.equal(inputs.supplementSha256, digest(readFileSync("public/solver-data/hu-play-v1/manifest.json")));
  if (mode === "--solve") {
    const preflight = JSON.parse(readFileSync(join(directory, "estimate-report.json"), "utf8"));
    assert.equal(preflight.inputsHash, hash); assert.equal(preflight.rows.length, 2352);
    assert.ok(preflight.rows.every((r: { status: string }) => r.status === "estimated"), "Every native estimate must succeed before solving");
  }
  const rows = [];
  for (let index = 0; index < inputs.roots.length; index++) {
    const root = inputs.roots[index];
    if (root.status === "unsupported") { rows.push({ index, status: "unsupported", reason: root.reason }); continue; }
    const spotPath = join(directory, `spot-${index}.json`);
    const spotBytes = canonicalBridgeSpotJson(root.spot);
    if (existsSync(spotPath)) assert.equal(readFileSync(spotPath, "utf8"), spotBytes);
    else writeFileSync(spotPath, spotBytes, { flag: "wx" });
    const recordPath = join(directory, `${mode === "--estimate" ? "estimate" : "solve"}-${index}.json`);
    if (existsSync(recordPath)) {
      const old = JSON.parse(readFileSync(recordPath, "utf8"));
      assert.equal(old.inputsHash, hash); assert.equal(old.spotHash, root.spotHash);
      if (old.status === "estimated") parseLiveEstimate(JSON.stringify(old.estimate), root.spot, root.spotHash);
      if (old.status === "solved") {
        const result = JSON.parse(readFileSync(join(directory, `result-${index}.json`), "utf8"));
        const chunk = await createTurnCacheChunk(root.spot, result, identity);
        assert.deepEqual(chunk.ref, old.ref); assert.deepEqual(readFileSync(join(directory, `${chunk.ref.sha256}.policy.json`)), Buffer.from(chunk.bytes));
        assert.equal(digest(bytesOf(mathProjection(result))), old.numericalHash);
      }
      rows.push(old); continue;
    }
    console.error(JSON.stringify({ stage: mode.slice(2), index, count: inputs.roots.length, id: root.librarySpotId,
      line: root.flopPath.join(" "), turn: root.turn }));
    const started = performance.now();
    let details: Record<string, unknown>;
    try {
      if (mode === "--estimate") {
        const { stdout } = await execute(BRIDGE_BINARY, ["estimate", spotPath], { timeout: 60_000, maxBuffer: 1024 ** 2,
          env: { ...process.env, RAYON_NUM_THREADS: "1" } });
        const estimate = parseLiveEstimate(stdout, root.spot, root.spotHash);
        details = { status: "estimated", estimate,
          reservationWithoutWasmPreflight: admitBrowserSolve(estimate, { profile: "unknown" }, 0, "play-v1") };
      } else {
        const run = await runBridgeSpot(root.spot, { threads: 1 });
        // Retain raw result even if it misses a gate; never keep only passing solves.
        write(join(directory, `result-${index}.json`), run.result);
        requirePlayingResult(run.result, root.spot, root.spotHash);
        const chunk = await createTurnCacheChunk(root.spot, run.result, identity);
        const chunkPath = join(directory, `${chunk.ref.sha256}.policy.json`);
        writeFileSync(chunkPath, chunk.bytes, { flag: "wx" });
        details = { status: "solved", ref: chunk.ref, iterations: run.result.iterations,
          enginePctPot: run.result.exploitability.pctPot, numericalHash: digest(bytesOf(mathProjection(run.result))),
          nativeElapsedMs: run.elapsedMs, sampledPeakRssBytes: run.sampledPeakRssBytes };
      }
    } catch (error) { details = { status: "failed", reason: error instanceof Error ? error.message : String(error) }; }
    const row = { index, inputsHash: hash, spotHash: root.spotHash, elapsedMs: performance.now() - started, ...details };
    write(recordPath, row); rows.push(row);
  }
  const report = { format: "poker-face-turn-cache-capture", version: 1, mode, inputsHash: hash, identity,
    measuredAt: new Date().toISOString(), nativeBinarySha256,
    interpretation: "Native single-thread observations; reservation omits measured WASM preflight. Not browser timings or phone certification.", rows };
  write(join(directory, `${mode === "--estimate" ? "estimate" : "solve"}-report.json`), report);
  const failures = rows.filter(r => r.status !== (mode === "--estimate" ? "estimated" : "solved"));
  if (mode === "--solve" && !failures.length) {
    const refs = rows.map(r => (r as unknown as { ref: TurnCacheRef }).ref).sort((a, b) => a.key.localeCompare(b.key));
    const cache = { format: "poker-face-turn-cache", version: 1, identity,
      librarySha256: inputs.librarySha256, supplementSha256: inputs.supplementSha256, entries: refs };
    const bytes = bytesOf(cache), cacheHash = digest(bytes);
    writeFileSync(join(directory, `${cacheHash}.manifest.json`), bytes, { flag: "wx" });
    console.log(JSON.stringify({ manifestSha256: cacheHash, manifestUrl: `${TURN_CACHE_PREFIX}${cacheHash}/manifest.json`,
      policyBytes: refs.reduce((s, r) => s + r.bytes, 0), files: refs.length, manifestBytes: bytes.length }));
  }
  console.log(JSON.stringify({ directory, mode, rows: rows.length, failures: failures.length }));
  if (failures.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
