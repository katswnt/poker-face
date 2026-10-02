/** Frozen P4 corpus through real production Workers, with no cache or native fallback.
 * Run serially on an otherwise idle machine for the latency gate; retain all failures.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, release } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "@playwright/test";
import { wasmBuild } from "./bridge-wasm-runner";
import { wideStudyHtml } from "./hu-play-wide-measurement";
import { checkP4BrowserRows } from "./hu-play-p4-browser-gates";
import type { P4BrowserMeasurement } from "./hu-play-p4-profile-page";
import type { FlopOffTreeCase } from "./hu-play-p4-corpus";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";

const bytesOf = (v: unknown) => Buffer.from(canonicalSolverJson(v) + "\n");
const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const hash = (v: unknown) => digest(bytesOf(v));
const write = (path: string, v: unknown) => writeFileSync(path, bytesOf(v), { flag: "wx" });
async function main() {
  const args = process.argv.slice(2), options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(["--inputs", "--native", "--out", "--browsers", "--measured"].includes(args[i]) && args[i + 1]
      && !args[i + 1].startsWith("--") && !options.has(args[i]), "Invalid options"); options.set(args[i], args[i + 1]);
  }
  assert.ok(options.has("--inputs") && options.has("--native") && options.has("--out"));
  assert.ok(!options.has("--measured") || ["true", "false"].includes(options.get("--measured")!));
  const measured = options.get("--measured") === "true", input = resolve(options.get("--inputs")!);
  const meta = JSON.parse(readFileSync(join(input, "inputs.json"), "utf8"));
  assert.equal(meta.format, "poker-face-p4-flop-inputs-bundle"); assert.equal(meta.version, 1); assert.equal(meta.cases, 200);
  const zipped = readFileSync(join(input, "inputs.json.gz")); assert.equal(zipped.length, meta.bytes); assert.equal(digest(zipped), meta.sha256);
  const plain = gunzipSync(zipped, { maxOutputLength: 128 * 1024 ** 2 });
  assert.equal(plain.length, meta.plainBytes); assert.equal(digest(plain), meta.inputsHash);
  const frozen = JSON.parse(plain.toString("utf8")); assert.equal(frozen.version, 1);
  const cases: FlopOffTreeCase[] = frozen.cases; assert.equal(cases.length, 200);
  for (const ref of frozen.selectionSources) assert.equal(digest(readFileSync(ref.path)), ref.sha256, `Frozen source changed: ${ref.path}`);
  const native = JSON.parse(readFileSync(join(options.get("--native")!, "report.json"), "utf8")), { payloadHash, ...payload } = native;
  assert.equal(payloadHash, hash(payload)); assert.equal(native.format, "poker-face-p4-production-playing");
  assert.equal(native.inputsHash, meta.inputsHash); assert.equal(native.rows.length, 200);
  for (const ref of native.sourceFiles) assert.equal(digest(readFileSync(ref.path)), ref.sha256, `Native measurement source changed: ${ref.path}`);
  const expected = new Map<number, { logHash: string; publicSolveKeys: string[]; solves: { numericalHash: string }[] }>();
  for (const row of native.rows) { assert.equal(row.status, "complete"); assert.ok(!expected.has(row.seed)); expected.set(row.seed, row); }
  const out = resolve(options.get("--out")!); assert.ok(!existsSync(out)); mkdirSync(out);
  const names = (options.get("--browsers") ?? "chromium").split(",");
  assert.ok(names.length && names.every(n => ["chromium", "firefox", "webkit"].includes(n)) && new Set(names).size === names.length);
  const { directory, manifest } = wasmBuild(), base = `/wasm/${manifest.buildHash}/`;
  assert.equal(manifest.sourceHash, native.engineSourceHash); assert.equal(manifest.buildHash, frozen.wasmBuildHash);
  const assets = new Map<string, { type: string; body: Uint8Array | string }>([["/", { type: "text/html",
    body: wideStudyHtml(base).replaceAll("P1 private full-range study", "P4 flop continuation measurement") }]]);
  const paths = new Set(["scripts/profile-hu-play-p4-browser.ts", "scripts/hu-play-p4-browser-gates.ts"]), bundles = [];
  for (const [url, entry] of [["/profile-page.mjs", "scripts/hu-play-p4-profile-page.ts"],
    ["/play-worker.mjs", "src/lib/solver/bridge/live/worker.ts"], ["/measured-worker.mjs", "scripts/bridge-live-profile.worker.ts"]]) {
    const bundled = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false, metafile: true });
    Object.keys(bundled.metafile.inputs).forEach(p => paths.add(p)); const bytes = bundled.outputFiles[0].contents;
    assets.set(url, { type: "text/javascript", body: bytes }); bundles.push({ url, bytes: bytes.length, sha256: digest(bytes) });
  }
  const sourceFiles = [...paths].sort().map(path => ({ path, sha256: digest(readFileSync(path)) }));
  const server = createServer((req, res) => {
    const url = req.url ?? "", asset = assets.get(url);
    if (asset) { res.writeHead(200, { "Content-Type": asset.type }); res.end(asset.body); return; }
    if (/^\/solver-data\/[a-zA-Z0-9/_.-]+$/.test(url) && !url.includes("..") && existsSync(`public${url}`)) {
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(readFileSync(`public${url}`)); return;
    }
    const relative = url.startsWith(base) ? url.slice(base.length) : "";
    if (relative !== "manifest.json" && !Object.hasOwn(manifest.files, relative)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": relative.endsWith(".js") ? "text/javascript" : relative.endsWith(".wasm") ? "application/wasm" : "text/plain" });
    res.end(readFileSync(join(directory, relative)));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const rows: (P4BrowserMeasurement & { seed: number; browser: string; exactNativeParity: boolean })[] = [];
  const versions: Record<string, string> = {};
  try {
    for (const name of names) for (const c of cases) {
      console.error(JSON.stringify({ type: "case", browser: name, seed: c.seed, measured }));
      const browser = await { chromium, firefox, webkit }[name as "chromium" | "firefox" | "webkit"].launch(); versions[name] = browser.version();
      try {
        const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction("typeof window.profileFlopJob === 'function'");
        const result = await page.evaluate<P4BrowserMeasurement>(`window.profileFlopJob(${JSON.stringify(c)},${JSON.stringify(base)},${measured})`);
        const ref = expected.get(c.seed)!;
        const exactNativeParity = result.logHash === ref.logHash && hash(result.publicSolveKeys) === hash(ref.publicSolveKeys)
          && hash(result.solves.map(s => s.numericalHash)) === hash(ref.solves.map(s => s.numericalHash));
        const row = { ...result, seed: c.seed, browser: name, exactNativeParity };
        rows.push(row); write(join(out, `${name}-${c.seed}.json`), row);
      } finally { await browser.close(); }
    }
  } finally { await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r())); }
  for (const ref of sourceFiles) assert.equal(digest(readFileSync(ref.path)), ref.sha256, "Source changed during browser measurement");
  let gateError: string | null = null, summaries: ReturnType<typeof checkP4BrowserRows> | null = null;
  try { summaries = checkP4BrowserRows(rows, names, measured); } catch (e) { gateError = String(e); }
  const report = { format: "poker-face-p4-production-browser", version: 1, measuredAt: new Date().toISOString(), passed: gateError === null,
    gateError, machine: { cpu: cpus()[0].model, osRelease: release(), node: process.version }, browserVersions: versions, measured,
    buildHash: manifest.buildHash, engineSourceHash: manifest.sourceHash, nativeReportHash: payloadHash, inputsHash: meta.inputsHash,
    sourceFiles, sourceHash: hash(sourceFiles), bundles, summaries, rows,
    method: { cases: 200, repeats: 1, freshBrowserPerCase: true,
      worker: measured ? "W2 observer, unchanged production runtime/loader" : "Unmodified production worker.ts",
      flopTime: "Actual off-tree preparation through the first AI flop response; includes range modelling/projection and audit description, not later street solves",
      turnTime: "Every actual turn public solve request through playing-policy validation, including Worker startup, estimate, solve and export",
      riverTime: "Actual dealt-river public request through its playing policy, including serialization, Worker load, solve, export and validation",
      memory: measured ? "Observed WASM linear-memory high-water through export, not process RSS or JS heap" : "Progress memory only, not a peak claim",
      admission: "Full ranges; unknown-device 192 MiB; no cache, native fallback or cross-origin isolation; physical phones unvalidated",
      safety: "Local approximate finite games, not exact GTO or global safety" } };
  write(join(out, "report.json"), { ...report, payloadHash: hash(report) });
  console.log(JSON.stringify({ out, passed: report.passed, summaries, gateError })); assert.equal(gateError, null);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
