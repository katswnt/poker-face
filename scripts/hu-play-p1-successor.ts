/** Historical source hashes remain verifiable after an explicitly measured pipeline change.
 * No hash allowlist: both the archived original bytes and the complete current source
 * closure + fresh, numerically identical P1 observations are required.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { gunzipSync } from "node:zlib";
import ts from "typescript";
import { wideHash } from "./hu-play-wide-corpus";
import type { Hands, Corpus, Browser } from "./audit-hu-play-p1";

export type P1Reports = [Hands, Corpus, Browser];
interface Source { path: string; sha256: string }
export interface P1SuccessorEvidence {
  format: "poker-face-p1-successor"; version: 1; originalCommit: string;
  originalReportHashes: string[]; originalSources: (Source & { text: string })[];
  currentSources: Source[]; successor: P1Reports;
}
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export const P1_SUCCESSOR_STEM = "tasks/artifacts/hu-play-p1-p2-successor";
export const P1_RELEASE_COMMIT = "ea47f6eef17782faa013ea41dad51978d85ca262";

export function p1PipelineSources(): Source[] {
  const seen = new Set<string>();
  const visit = (path: string) => {
    path = normalize(path);
    assert.ok(!path.startsWith("/") && !path.split("/").includes(".."), "Unsafe source path");
    if (seen.has(path)) return; seen.add(path);
    const text = readFileSync(path, "utf8");
    if (!/\.[cm]?[jt]sx?$/.test(path)) return;
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
      if (!fileName.startsWith(".")) continue;
      const base = join(dirname(path), fileName);
      const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`, join(base, "index.ts")]
        .find(p => existsSync(p) && !p.endsWith("/"));
      assert.ok(resolved, `Missing source dependency ${path}: ${fileName}`); visit(resolved);
    }
  };
  for (const p of ["scripts/audit-hu-play-p1-hands.ts", "scripts/measure-hu-play-p1-corpus.ts", "scripts/profile-hu-play-p1-browser.ts",
    "scripts/hu-play-p1-profile-page.ts", "scripts/audit-hu-play-p1.ts", "scripts/hu-play-p1-successor.ts",
    "scripts/capture-hu-play-p1-successor.ts", "src/lib/solver/bridge/live/worker.ts", "scripts/build-bridge-wasm.mjs"]) visit(p);
  for (const dir of ["native/solver-bridge", "native/solver-bridge-wasm"]) {
    for (const name of ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"]) visit(join(dir, name));
    if (existsSync(join(dir, "rustfmt.toml"))) visit(join(dir, "rustfmt.toml"));
    const rust = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name); if (entry.isDirectory()) rust(path); else visit(path);
      }
    };
    rust(join(dir, "src"));
  }
  return [...seen].sort().map(path => ({ path, sha256: digest(readFileSync(path)) }));
}

export function p1HandsIdentity(r: Hands) {
  return { hands: r.hands, solves: r.solves.map(s => ({ seed: s.seed, street: s.street, spotHash: s.spotHash,
    numericalHash: s.numericalHash, iterations: s.iterations, reached: s.reached, enginePctPot: s.enginePctPot })),
  riverGrades: r.riverGrades.map(({ grade, ...row }) => { const { elapsedMs, ...math } = grade; void elapsedMs; return { ...row, grade: math }; }) };
}
export function p1CorpusIdentity(r: Corpus) {
  return r.rows.map(row => { const { elapsedMs, ...grade } = row.grade; void elapsedMs;
    return { corpusIndex: row.corpusIndex, playingSpotHash: row.playingSpotHash, numericalHash: row.numericalHash,
      completeNumericalHash: row.completeNumericalHash, firstStreetHash: row.firstStreetHash, grade }; });
}

export function checkP1SuccessorEvidence(e: P1SuccessorEvidence, original: P1Reports,
  verifyCurrentReports: (hands: Hands, corpus: Corpus, browser: Browser) => unknown) {
  assert.equal(e.format, "poker-face-p1-successor"); assert.equal(e.version, 1); assert.equal(e.originalCommit, P1_RELEASE_COMMIT);
  assert.deepEqual(e.originalReportHashes, original.map(r => r.payloadHash), "Historical report hash binding");
  const refs = original[0].sourceSnapshot.sourceFiles;
  assert.deepEqual(e.originalSources.map(({ text, ...ref }) => { void text; return ref; }), refs, "Historical source list");
  for (const s of e.originalSources) assert.equal(digest(s.text), s.sha256, `Historical source hash: ${s.path}`);
  assert.deepEqual(e.currentSources, p1PipelineSources(), "Current source closure differs from measured successor");
  // Require the same source surface as P1, and check every current hash BEFORE invoking
  // its verifier. This prevents recursive archive fallback or an empty-snapshot bypass.
  assert.deepEqual(e.successor[0].sourceSnapshot.sourceFiles.map(s => s.path), refs.map(s => s.path), "Successor source surface");
  for (const s of e.successor[0].sourceSnapshot.sourceFiles) assert.equal(digest(readFileSync(s.path)), s.sha256, `Current source hash: ${s.path}`);
  verifyCurrentReports(...e.successor);
  assert.deepEqual(p1HandsIdentity(e.successor[0]), p1HandsIdentity(original[0]), "P1 numerical/log identities must remain identical");
  assert.deepEqual(p1CorpusIdentity(e.successor[1]), p1CorpusIdentity(original[1]), "P1 full-game numerical identities must remain identical");
}

export function readP1Successor(): P1SuccessorEvidence {
  const meta = JSON.parse(readFileSync(`${P1_SUCCESSOR_STEM}.json`, "utf8"));
  assert.equal(meta.format, "poker-face-p1-successor-bundle"); assert.equal(meta.version, 1);
  const bytes = readFileSync(`${P1_SUCCESSOR_STEM}.json.gz`); assert.equal(bytes.length, meta.bytes);
  assert.equal(digest(bytes), meta.sha256, "Successor archive hash");
  const plain = gunzipSync(bytes, { maxOutputLength: 32 * 1024 ** 2 });
  assert.equal(digest(plain), meta.uncompressedSha256, "Successor uncompressed hash");
  const evidence = JSON.parse(plain.toString("utf8")); assert.equal(wideHash(evidence), meta.evidenceHash);
  return evidence;
}
