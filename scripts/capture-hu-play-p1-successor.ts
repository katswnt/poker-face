/** New evidence only. Never edit/re-hash the historical P1 artifacts or stage a source bypass. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { checkP1Reports } from "./audit-hu-play-p1";
import { checkP1SuccessorEvidence, p1PipelineSources, P1_RELEASE_COMMIT, P1_SUCCESSOR_STEM,
  P1_P3_SUCCESSOR_STEM, readHistoricalP1Successor,
  type P1Reports, type P1SuccessorEvidence } from "./hu-play-p1-successor";
import { wideHash } from "./hu-play-wide-corpus";

const args = process.argv.slice(2);
const p3 = args[0] === "--p3", directories = p3 ? args.slice(1) : args;
assert.ok(directories.length === 3, "Use [--p3] HANDS_DIRECTORY CORPUS_DIRECTORY BROWSER_DIRECTORY; writes a new versioned successor only");
const original = ["hands", "corpus", "browser"].map(n => JSON.parse(readFileSync(`tasks/artifacts/hu-play-p1-production-${n}.json`, "utf8"))) as P1Reports;
const successor = directories.map(dir => JSON.parse(readFileSync(join(dir, "report.json"), "utf8"))) as P1Reports;
const historical = p3 ? readHistoricalP1Successor() : null;
const originalSources = historical?.originalSources ?? original[0].sourceSnapshot.sourceFiles.map(ref => ({ ...ref,
  text: execFileSync("git", ["show", `${P1_RELEASE_COMMIT}:${ref.path}`], { encoding: "utf8", maxBuffer: 8 * 1024 ** 2 }) }));
const evidence: P1SuccessorEvidence = { format: "poker-face-p1-successor", version: p3 ? 2 : 1, originalCommit: P1_RELEASE_COMMIT,
  ...(historical ? { parentEvidenceHash: wideHash(historical) } : {}),
  originalReportHashes: original.map(r => r.payloadHash), originalSources, currentSources: p1PipelineSources(), successor };
checkP1SuccessorEvidence(evidence, original, checkP1Reports);
const plain = Buffer.from(JSON.stringify(evidence)), bytes = gzipSync(plain, { level: 9 });
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const meta = { format: "poker-face-p1-successor-bundle", version: evidence.version, bytes: bytes.length, sha256: digest(bytes),
  uncompressedSha256: digest(plain), evidenceHash: wideHash(evidence),
  originalCommit: P1_RELEASE_COMMIT, originalReportHashes: evidence.originalReportHashes,
  successorReportHashes: successor.map(r => r.payloadHash), currentSourceCount: evidence.currentSources.length };
const stem = p3 ? P1_P3_SUCCESSOR_STEM : P1_SUCCESSOR_STEM;
writeFileSync(`${stem}.json.gz`, bytes, { flag: "wx" });
writeFileSync(`${stem}.json`, JSON.stringify(meta, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(meta));
