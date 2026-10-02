/** A source-only successor of the frozen corpus. No new deal, baseline solve, parent,
 * amount or game is permitted; preserve the original attempt and its hashes.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildTurnCorpus, type P3TurnRoot } from "./hu-play-p3-corpus";
import { mathProjection } from "./hu-play-wide-measurement";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";

const bytesOf = (v: unknown) => Buffer.from(canonicalSolverJson(v) + "\n");
const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
type Source = { path: string; sha256: string };
export function sourceSuccessor<T extends { format: string; version: number; cases: readonly unknown[]; selectionSources: Source[] }>(
  original: T, rebuiltCases: readonly unknown[], selectionSources: Source[]) {
  assert.equal(original.format, "poker-face-p3-turn-inputs"); assert.equal(original.version, 1);
  assert.equal(original.cases.length, 200, "All 200 original cases required");
  assert.equal(canonicalSolverJson(rebuiltCases), canonicalSolverJson(original.cases), "All frozen inputs must remain unchanged");
  return { ...original, version: 2, selectionSources, derivedFrom: { inputsHash: digest(bytesOf(original)),
    selectionSources: original.selectionSources, reason: "Stable schema-order subgame IDs reproduce the exact original cases after JSON restoration; no cases or numerical inputs changed." } };
}

async function main() {
  const [flag, sourcePath, outFlag, outPath, ...rest] = process.argv.slice(2);
  assert.ok(flag === "--from" && sourcePath && outFlag === "--out" && outPath && !rest.length);
  const source = resolve(sourcePath), directory = resolve(outPath); assert.ok(!existsSync(directory));
  const meta = JSON.parse(readFileSync(join(source, "inputs.json"), "utf8"));
  assert.equal(meta.format, "poker-face-p3-turn-inputs-bundle"); assert.equal(meta.version, 1);
  assert.equal(meta.inputsHash, "b0a7e5dd3ef4516316b8a1bf84759319521a47404965695a29526e1e02c3dae7");
  const oldBytes = readFileSync(join(source, "inputs.json.gz"));
  assert.equal(oldBytes.length, meta.bytes); assert.equal(digest(oldBytes), meta.sha256);
  const oldPlain = gunzipSync(oldBytes, { maxOutputLength: 128 * 1024 ** 2 });
  assert.equal(oldPlain.length, meta.plainBytes); assert.equal(digest(oldPlain), meta.inputsHash);
  const frozen = JSON.parse(oldPlain.toString("utf8"));
  const rootBytes = readFileSync(join(source, "roots.json")); assert.equal(digest(rootBytes), frozen.rootsSha256);
  const roots: P3TurnRoot[] = JSON.parse(rootBytes.toString("utf8")).roots;
  const baselines: BridgeResultV1[] = roots.map((_, i) => JSON.parse(readFileSync(join(source, `baseline-${i}.json`), "utf8")));
  assert.deepEqual(baselines.map(r => digest(bytesOf(mathProjection(r)))), frozen.baselineNumericalHashes);
  const rebuilt = buildTurnCorpus(roots, baselines);
  const paths = [...frozen.selectionSources.map((s: Source) => s.path), "scripts/refreeze-hu-play-p3.ts", "src/lib/hu-play/subgame-identity.ts"];
  const selectionSources = paths.map(path => ({ path, sha256: digest(readFileSync(path)) }));
  const next = sourceSuccessor(frozen, rebuilt, selectionSources);
  const plain = bytesOf(next), bytes = gzipSync(plain, { level: 9 });
  mkdirSync(directory);
  for (const name of ["roots.json", ...roots.map((_, i) => `baseline-${i}.json`)]) copyFileSync(join(source, name), join(directory, name));
  writeFileSync(join(directory, "inputs.json.gz"), bytes, { flag: "wx" });
  writeFileSync(join(directory, "inputs.json"), bytesOf({ format: "poker-face-p3-turn-inputs-bundle", version: 2,
    inputsHash: digest(plain), sha256: digest(bytes), bytes: bytes.length, plainBytes: plain.length, cases: 200,
    parentInputsHash: meta.inputsHash }), { flag: "wx" });
  console.log(JSON.stringify({ directory, inputsHash: digest(plain), parentInputsHash: meta.inputsHash,
    casesUnchanged: 200, nativeSolves: 0 }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
