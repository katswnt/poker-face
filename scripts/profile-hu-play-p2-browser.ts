/** The frozen 200 P2 cases through the production BrowserPublicSolver and actual Worker.
 * Optional W2 observer entry measures monotonically growing WASM memory through export.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, release } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "@playwright/test";
import { loadWasm } from "./bridge-wasm-runner";
import { loadP1ProductionRoots } from "./hu-play-p1-corpus";
import { wideHash } from "./hu-play-wide-corpus";
import { wideStudyHtml } from "./hu-play-wide-measurement";
import { checkP2BrowserRows } from "./hu-play-p2-browser-gates";
import type { P2BrowserMeasurement } from "./hu-play-p2-profile-page";
import type { RiverOffTreeCase } from "./hu-play-p2-playing-case";

const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function main() {
  const args = process.argv.slice(2), options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(["--inputs", "--native", "--out", "--browsers", "--measured"].includes(args[i]) && args[i + 1]
      && !args[i + 1].startsWith("--") && !options.has(args[i]), "Invalid options"); options.set(args[i], args[i + 1]);
  }
  assert.ok(options.has("--inputs") && options.has("--native") && options.has("--out"));
  assert.ok(!options.has("--measured") || ["true", "false"].includes(options.get("--measured")!));
  const measured = options.get("--measured") === "true", input = resolve(options.get("--inputs")!);
  const frozen = JSON.parse(readFileSync(join(input, "inputs.json"), "utf8")), { payloadHash: inputHash, ...inputPayload } = frozen;
  assert.equal(inputHash, wideHash(inputPayload)); assert.equal(inputHash, "4f2a1442b882460371645954ce69ae700324d7427a3271d013d505a156f6325c");
  const cases: (RiverOffTreeCase & { rootCorpusIndex: number })[] = frozen.cases; assert.equal(cases.length, 200);
  const native = JSON.parse(readFileSync(join(options.get("--native")!, "report.json"), "utf8")), { payloadHash, ...payload } = native;
  assert.equal(payloadHash, wideHash(payload)); assert.equal(native.format, "poker-face-p2-production-playing");
  assert.equal(native.inputsHash, inputHash); assert.equal(native.rows.length, 200);
  const expected = new Map<number, { logHash: string; publicSolveKeys: string[]; solves: { numericalHash: string }[] }>();
  for (const r of native.rows) { assert.equal(r.status, "complete"); assert.ok(!expected.has(r.seed)); expected.set(r.seed, r); }
  const out = resolve(options.get("--out")!); assert.ok(!existsSync(out)); mkdirSync(out);
  const names = (options.get("--browsers") ?? "chromium").split(",");
  assert.ok(names.every(n => ["chromium", "firefox", "webkit"].includes(n)) && new Set(names).size === names.length);
  const { directory, manifest } = await loadWasm(), base = `/wasm/${manifest.buildHash}/`;
  const assets = new Map<string, { type: string; body: Uint8Array | string }>([["/", { type: "text/html",
    body: wideStudyHtml(base).replaceAll("P1 private full-range study", "P2 river measurement") }]]);
  const paths = new Set(["scripts/profile-hu-play-p2-browser.ts", "scripts/hu-play-p2-browser-gates.ts"]);
  const bundles = [];
  for (const [url, entry] of [["/profile-page.mjs", "scripts/hu-play-p2-profile-page.ts"],
    ["/play-worker.mjs", "src/lib/solver/bridge/live/worker.ts"], ["/measured-worker.mjs", "scripts/bridge-live-profile.worker.ts"]]) {
    const bundled = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false, metafile: true });
    Object.keys(bundled.metafile.inputs).forEach(p => paths.add(p));
    const bytes = bundled.outputFiles[0].contents;
    assets.set(url, { type: "text/javascript", body: bytes }); bundles.push({ url, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const sourceFiles = [...paths].sort().map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  const server = createServer((req, res) => {
    const url = req.url ?? "", asset = assets.get(url);
    if (asset) { res.writeHead(200, { "Content-Type": asset.type }); res.end(asset.body); return; }
    const relative = url.startsWith(base) ? url.slice(base.length) : "";
    if (relative !== "manifest.json" && !Object.hasOwn(manifest.files, relative)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": relative.endsWith(".js") ? "text/javascript" : relative.endsWith(".wasm") ? "application/wasm" : "text/plain" });
    res.end(readFileSync(join(directory, relative)));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const rows: (P2BrowserMeasurement & { seed: number; browser: string; exactNativeParity: boolean })[] = [];
  const versions: Record<string, string> = {}, roots = loadP1ProductionRoots().filter(r => r.street === "river");
  try {
    for (const name of names) for (const c of cases) {
      console.error(JSON.stringify({ type: "case", browser: name, seed: c.seed, measured }));
      const root = roots[c.seed % 32]; assert.equal(root.corpusIndex, c.rootCorpusIndex);
      const baseline = JSON.parse(readFileSync(join(input, `baseline-${root.corpusIndex}.json`), "utf8"));
      const browser = await { chromium, firefox, webkit }[name as "chromium" | "firefox" | "webkit"].launch(); versions[name] = browser.version();
      try {
        const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction("typeof window.profileRiverJob === 'function'");
        const r = await page.evaluate<P2BrowserMeasurement>(`window.profileRiverJob(${JSON.stringify(c)},${JSON.stringify(root.request)},${JSON.stringify(baseline.result)},${JSON.stringify(base)},${measured})`);
        const ref = expected.get(c.seed)!;
        const exactNativeParity = r.logHash === ref.logHash && wideHash(r.solves.map(s => s.spotHash)) === wideHash(ref.publicSolveKeys)
          && wideHash(r.solves.map(s => s.numericalHash)) === wideHash(ref.solves.map(s => s.numericalHash));
        const row = { ...r, seed: c.seed, browser: name, exactNativeParity };
        rows.push(row); write(join(out, `${name}-${c.seed}.json`), row);
        // Collect ALL failures; the final unchanged gate refuses the report as a release.
      } finally { await browser.close(); }
    }
  } finally { await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r())); }
  for (const ref of sourceFiles) assert.equal(createHash("sha256").update(readFileSync(ref.path)).digest("hex"), ref.sha256, "Source changed during browser measurement");
  let gateError: string | null = null, summaries: ReturnType<typeof checkP2BrowserRows> | null = null;
  try { summaries = checkP2BrowserRows(rows, names, measured); } catch (e) { gateError = String(e); }
  const report = { format: "poker-face-p2-production-browser", version: 1, measuredAt: new Date().toISOString(), passed: gateError === null, gateError,
    machine: { cpu: cpus()[0].model, osRelease: release(), node: process.version }, browserVersions: versions, measured,
    buildHash: manifest.buildHash, engineSourceHash: manifest.sourceHash, nativeReportHash: payloadHash, inputsHash: inputHash,
    sourceFiles, sourceHash: wideHash(sourceFiles), bundles, summaries, rows,
    method: { cases: 200, repeats: 1, freshBrowserPerCase: true, worker: measured ? "W2 observer, unchanged production runtime and loader" : "Unmodified production worker.ts",
      time: "Actual off-tree preparation through completed river-parent reducer continuation; includes independent grades, excludes cached baseline preparation, browser launch and final fingerprints",
      memory: measured ? "WASM linear-memory high-water, observed through finish/export and result; not process RSS or JS heap" : "Progress memory only; no peak claim",
      admission: "Unknown-device 192 MiB; no native fallback, no isolation, no physical-phone certification",
      safety: "Local approximate finite games, not exact GTO or a global safety guarantee" } };
  write(join(out, "report.json"), { ...report, payloadHash: wideHash(report) });
  console.log(JSON.stringify({ out, passed: report.passed, summaries, gateError })); assert.equal(gateError, null);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
