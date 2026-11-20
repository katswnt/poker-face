/** Freeze source/build-only envelopes for the immutable legacy games. No solves,
 * old artifact writes, timing claims or admission changes. Capture requires this freeze.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { readPreE1P2Evidence } from "./audit-hu-play-p2";
import { readPreE1P3Evidence } from "./audit-hu-play-p3";
import { readPreE1P4Evidence } from "./audit-hu-play-p4";
import { p5PipelineSources } from "./audit-hu-play-p5";
import { checkE1InputSuccessor, checkE1ParentSources, type E1Source } from "./hu-play-e1-successor";
import { wasmBuild } from "./bridge-wasm-runner";
import { BRIDGE_BINARY } from "./bridge-runner";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { e1ContractText } from "./audit-hu-play-e1";

export const E1_BASE_COMMIT = "1a6ee2a7a0e982c13e39556e9b029743c573d748";
const bytesOf = (v: unknown) => Buffer.from(canonicalSolverJson(v) + "\n");
const digest = (v: Uint8Array | string) => createHash("sha256").update(v).digest("hex");
export function archiveE1ParentSources(refs: readonly E1Source[]) {
  const archive = refs.map(ref => ({ ...ref, text: execFileSync("git", ["show", `${E1_BASE_COMMIT}:${ref.path}`],
    { encoding: "utf8", maxBuffer: 8 * 1024 ** 2 }) }));
  checkE1ParentSources(archive, refs); return archive;
}
async function main() {
  const [flag, out, ...rest] = process.argv.slice(2);
  assert.ok(flag === "--out" && out && !rest.length, "Use --out NEW_DIRECTORY");
  const directory = resolve(out); assert.ok(!existsSync(directory));
  const { manifest } = wasmBuild(), nativeBinarySha256 = digest(readFileSync(BRIDGE_BINARY));
  const sourceFiles = await p5PipelineSources();
  mkdirSync(directory);
  const write = (path: string, value: unknown) => writeFileSync(join(directory, path), bytesOf(value), { flag: "wx" });
  write("source-freeze.json", { format: "poker-face-e1-source-freeze", version: 1,
    baseCommit: E1_BASE_COMMIT, sourceFiles, engineSourceHash: manifest.sourceHash,
    wasmBuildHash: manifest.buildHash, nativeBinarySha256, contractSha256: digest(e1ContractText()), frozenAt: new Date().toISOString() });
  const p2 = readPreE1P2Evidence(); mkdirSync(join(directory, "p2"));
  write("p2/inputs.json", p2.inputs);
  for (const { corpusIndex, ...solve } of p2.baselines) write(`p2/baseline-${corpusIndex}.json`, solve);
  const p3 = readPreE1P3Evidence(), p4 = readPreE1P4Evidence();
  for (const [name, parent] of [["p3", p3], ["p4", p4]] as const) {
    mkdirSync(join(directory, name));
    const inputs = { ...parent.inputs, version: parent.inputs.version + 1, engineSourceHash: manifest.sourceHash,
      wasmBuildHash: manifest.buildHash, nativeBinarySha256,
      selectionSources: parent.inputs.selectionSources.map(({ path }) => ({ path, sha256: digest(readFileSync(path)) })) };
    checkE1InputSuccessor(inputs, parent.inputs);
    const plain = bytesOf(inputs), zipped = gzipSync(plain, { level: 9 });
    writeFileSync(join(directory, name, "inputs.json.gz"), zipped, { flag: "wx" });
    write(`${name}/inputs.json`, { format: `${inputs.format}-bundle`, version: inputs.version,
      inputsHash: digest(plain), sha256: digest(zipped), bytes: zipped.length, plainBytes: plain.length,
      cases: 200, ...(name === "p3" ? { parentInputsHash: p3.inputs.derivedFrom.inputsHash } : {}) });
  }
  write("p3/roots.json", p3.roots);
  for (let i = 0; i < p3.baselines.length; i++) write(`p3/baseline-${i}.json`, p3.baselines[i]);
  assert.deepEqual(await p5PipelineSources(), sourceFiles, "Source changed while freezing inputs");
  console.log(JSON.stringify({ directory, p2Cases: 200, p3Cases: 200, p4Cases: 200, solves: 0 }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
