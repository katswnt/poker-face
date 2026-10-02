/** Freeze first-200 production arrivals, solve ONLY their unchanged baseline menus, then
 * close the complete 200-case input file before any off-tree timing/solve may begin.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { BRIDGE_BINARY, runBridgeSpot } from "./bridge-runner";
import { wasmBuild } from "./bridge-wasm-runner";
import { seededTurnRoots, buildTurnCorpus } from "./hu-play-p3-corpus";
import { mathProjection } from "./hu-play-wide-measurement";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";

const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const bytesOf = (v: unknown) => Buffer.from(canonicalSolverJson(v) + "\n");
const write = (p: string, v: unknown) => writeFileSync(p, bytesOf(v), { flag: "wx" });
async function main() {
  const [mode, path, ...rest] = process.argv.slice(2);
  assert.ok(mode === "--out" && path && !rest.length, "Use --out NEW_DIRECTORY");
  const directory = resolve(path); assert.ok(!existsSync(directory), "Never overwrite a frozen attempt"); mkdirSync(directory);
  const { manifest } = wasmBuild(), nativeBinarySha256 = digest(readFileSync(BRIDGE_BINARY));
  const fetcher: typeof fetch = async input => {
    assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(input).includes(".."));
    return new Response(readFileSync(`public${input}`));
  };
  const catalog = await loadPlayCatalog(undefined, fetcher), selection = await seededTurnRoots(catalog, 200, fetcher);
  const selectionSources = ["scripts/freeze-hu-play-p3.ts", "scripts/hu-play-p3-corpus.ts", "src/lib/hu-play/scripted.ts",
    "src/lib/hu-play/public-state.ts", "src/lib/hu-play/turn-menu.ts", "src/lib/hu-play/turn-tree.ts"]
    .map(path => ({ path, sha256: digest(readFileSync(path)) }));
  const roots = { format: "poker-face-p3-seeded-turn-roots", version: 1,
    librarySha256: catalog.supplement.libraryManifestSha256,
    supplementSha256: digest(readFileSync("public/solver-data/hu-play-v1/manifest.json")), selectionSources,
    engineSourceHash: manifest.sourceHash, wasmBuildHash: manifest.buildHash, nativeBinarySha256, ...selection };
  write(join(directory, "roots.json"), roots);
  console.error(JSON.stringify({ stage: "roots-frozen", count: selection.roots.length, lastSeed: selection.roots.at(-1)!.seed,
    rootsSha256: digest(bytesOf(roots)) }));
  const baselines: BridgeResultV1[] = [];
  for (let i = 0; i < selection.roots.length; i++) {
    const root = selection.roots[i];
    console.error(JSON.stringify({ stage: "baseline", index: i, handSeed: root.seed, spotHash: root.spotHash }));
    try {
      const run = await runBridgeSpot(root.spot, { threads: 1 });
      write(join(directory, `baseline-${i}.json`), run.result);
      requirePlayingResult(run.result, root.spot, root.spotHash); baselines.push(run.result);
    } catch (e) {
      write(join(directory, "baseline-failure.json"), { index: i, root, error: e instanceof Error ? e.message : String(e) }); throw e;
    }
  }
  const cases = buildTurnCorpus(selection.roots, baselines);
  const corpus = { format: "poker-face-p3-turn-inputs", version: 1, rootsSha256: digest(bytesOf(roots)), selectionSources,
    engineSourceHash: manifest.sourceHash, wasmBuildHash: manifest.buildHash, nativeBinarySha256,
    baselineNumericalHashes: baselines.map(r => digest(bytesOf(mathProjection(r)))), cases };
  const plain = bytesOf(corpus), bytes = gzipSync(plain, { level: 9 });
  writeFileSync(join(directory, "inputs.json.gz"), bytes, { flag: "wx" });
  write(join(directory, "inputs.json"), { format: "poker-face-p3-turn-inputs-bundle", version: 1,
    sha256: digest(bytes), bytes: bytes.length, plainBytes: plain.length, inputsHash: digest(plain), cases: cases.length });
  // No off-tree work in this script; the above bytes exist before a later measurement starts.
  console.log(JSON.stringify({ directory, inputsHash: digest(plain), cases: cases.length,
    seats: [...new Set(cases.map(c => c.request.aiSeat))], categories: cases.reduce((m, c) => ({ ...m, [c.category]: (m[c.category] ?? 0) + 1 }), {} as Record<string, number>),
    preferredParentFallbacks: cases.filter(c => !c.usedPreferredFamily).length }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
