/** Preserve full numerical evidence once, with content hashes and a recomputed gate summary. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { checkP2Evidence, p2PipelineSources, P2_EVIDENCE_STEM, type P2Evidence } from "./audit-hu-play-p2";
import { wideHash } from "./hu-play-wide-corpus";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
async function main() {
  const args = process.argv.slice(2);
  assert.equal(args.length, 6, "Use INPUTS_DIR NATIVE_OLD_DIR NATIVE_CURRENT_DIR SAFETY_DIR BROWSER_DIR MEMORY_DIR");
  const [input, old, native, safety, browser, memory] = args;
  const inputs = read(join(input, "inputs.json")), report = read(join(native, "report.json"));
  const indices = [...new Set<number>(inputs.cases.map((c: { rootCorpusIndex: number }) => c.rootCorpusIndex))].sort((a, b) => a - b);
  const e: P2Evidence = { format: "poker-face-p2-evidence", version: 1, currentSources: await p2PipelineSources(), inputs,
    baselines: indices.map(corpusIndex => ({ corpusIndex, ...read(join(input, `baseline-${corpusIndex}.json`)) })),
    cases: report.rows.map((r: { seed: number; solves: unknown[] }) => ({ seed: r.seed,
      solves: r.solves.map((_, i) => read(join(native, `case-${r.seed}-solve-${i}.json`))) })),
    nativeReports: [read(join(old, "report.json")), report], safety: read(join(safety, "report.json")),
    browser: read(join(browser, "report.json")), memory: read(join(memory, "report.json")) };
  const summary = await checkP2Evidence(e);
  const plain = Buffer.from(JSON.stringify(e)), bytes = gzipSync(plain, { level: 9 });
  const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const meta = { format: "poker-face-p2-evidence-bundle", version: 1, bytes: bytes.length, sha256: digest(bytes),
    uncompressedBytes: plain.length, uncompressedSha256: digest(plain), evidenceHash: wideHash(e) };
  for (const [path, data] of [[`${P2_EVIDENCE_STEM}.json.gz`, bytes], [`${P2_EVIDENCE_STEM}.json`, JSON.stringify(meta, null, 2) + "\n"],
    [`${P2_EVIDENCE_STEM}-summary.json`, JSON.stringify(summary, null, 2) + "\n"]] as const) writeFileSync(path, data, { flag: "wx" });
  console.log(JSON.stringify(meta)); console.log(JSON.stringify(summary));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
