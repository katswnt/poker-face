/** Capture new P4 evidence only after independently recomputing every release gate. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { checkP4Evidence, p4Hash, p4PipelineSources, P4_EVIDENCE_STEM, type P4Evidence } from "./audit-hu-play-p4";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
async function main() {
  const args = process.argv.slice(2);
  assert.equal(args.length, 6, "Use INPUTS_DIR NATIVE_DIR BROWSER_DIR MEMORY_DIR COMPLETE_GRADES_DIR HANDS_DIR");
  const [input, native, browser, memory, grades, hands] = args;
  const meta = read(join(input, "inputs.json")), zipped = readFileSync(join(input, "inputs.json.gz"));
  assert.equal(meta.format, "poker-face-p4-flop-inputs-bundle"); assert.equal(meta.version, 1);
  assert.equal(zipped.length, meta.bytes); assert.equal(digest(zipped), meta.sha256);
  const plainInput = gunzipSync(zipped, { maxOutputLength: 128 * 1024 ** 2 });
  assert.equal(plainInput.length, meta.plainBytes); assert.equal(digest(plainInput), meta.inputsHash);
  const report = read(join(native, "report.json"));
  const e: P4Evidence = { format: "poker-face-p4-evidence", version: 1, currentSources: await p4PipelineSources(),
    inputs: JSON.parse(plainInput.toString("utf8")),
    cases: report.rows.map((r: { seed: number; publicSolveKeys: string[] }) => ({ seed: r.seed,
      attempts: r.publicSolveKeys.map((_, i) => read(join(native, `case-${r.seed}-attempt-${i}.json`))) })),
    native: report, browser: read(join(browser, "report.json")), memory: read(join(memory, "report.json")),
    complete: (read(join(grades, "report.json")).sampleSeeds as number[]).map(seed => ({ seed, spot: read(join(grades, `seed-${seed}.spot.json`)),
      result: read(join(grades, `seed-${seed}.result.json`)) })),
    completeReport: read(join(grades, "report.json")), hands: read(join(hands, "report.json")) };
  const summary = await checkP4Evidence(e);
  const plain = Buffer.from(JSON.stringify(e)), bytes = gzipSync(plain, { level: 9 });
  assert.ok(plain.length <= 512 * 1024 ** 2 && bytes.length < 100 * 1024 ** 2, "Evidence exceeds its checked reader or Git file bound");
  const bundle = { format: "poker-face-p4-evidence-bundle", version: 1, bytes: bytes.length, sha256: digest(bytes),
    uncompressedBytes: plain.length, uncompressedSha256: digest(plain), evidenceHash: p4Hash(e), inputsHash: p4Hash(e.inputs),
    currentSourceHash: p4Hash(e.currentSources), nativeReportHash: e.native.payloadHash };
  for (const [path, data] of [[`${P4_EVIDENCE_STEM}.json.gz`, bytes], [`${P4_EVIDENCE_STEM}.json`, JSON.stringify(bundle, null, 2) + "\n"],
    [`${P4_EVIDENCE_STEM}-summary.json`, JSON.stringify(summary, null, 2) + "\n"]] as const) writeFileSync(path, data, { flag: "wx" });
  console.log(JSON.stringify(bundle)); console.log(JSON.stringify(summary));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
