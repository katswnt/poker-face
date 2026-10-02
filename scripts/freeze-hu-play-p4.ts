/** Close all prospective flop inputs before any new turn/river solve or timing. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { BRIDGE_BINARY } from "./bridge-runner";
import { wasmBuild } from "./bridge-wasm-runner";
import { buildFlopCorpus } from "./hu-play-p4-corpus";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
async function main() {
  const [flag, target, ...rest] = process.argv.slice(2);
  assert.ok(flag === "--out" && target && !rest.length, "Use --out NEW_DIRECTORY");
  const directory = resolve(target); assert.ok(!existsSync(directory));
  const bundle = await build({ entryPoints: ["scripts/freeze-hu-play-p4.ts"], bundle: true, platform: "node",
    format: "esm", packages: "external", write: false, metafile: true });
  const selectionSources = Object.keys(bundle.metafile.inputs).sort().map(path => ({ path, sha256: digest(readFileSync(path)) }));
  const fetcher: typeof fetch = async input => {
    assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(input).includes(".."));
    return new Response(readFileSync(`public${input}`));
  };
  const { manifest } = wasmBuild(), catalog = await loadPlayCatalog(undefined, fetcher);
  const cases = await buildFlopCorpus(catalog, fetcher);
  const frozen = { format: "poker-face-p4-flop-inputs", version: 1, selectionSources,
    librarySha256: catalog.supplement.libraryManifestSha256,
    supplementSha256: digest(readFileSync("public/solver-data/hu-play-v1/manifest.json")),
    engineSourceHash: manifest.sourceHash, wasmBuildHash: manifest.buildHash,
    nativeBinarySha256: digest(readFileSync(BRIDGE_BINARY)), cases };
  for (const ref of selectionSources) assert.equal(digest(readFileSync(ref.path)), ref.sha256);
  const plain = Buffer.from(canonicalSolverJson(frozen) + "\n"), bytes = gzipSync(plain, { level: 9 });
  const summary = { format: "poker-face-p4-flop-inputs-bundle", version: 1, inputsHash: digest(plain),
    plainBytes: plain.length, sha256: digest(bytes), bytes: bytes.length, cases: cases.length };
  mkdirSync(directory); writeFileSync(join(directory, "inputs.json.gz"), bytes, { flag: "wx" });
  writeFileSync(join(directory, "inputs.json"), canonicalSolverJson(summary) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ directory, ...summary }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
