/** Production P1 path: fresh browser/Worker, 64 frozen roots, no research parser shim. */
import assert from "node:assert/strict";
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
import type { P1BrowserMeasurement } from "./hu-play-p1-profile-page";

const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function main() {
  const args = process.argv.slice(2), options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(["--native", "--out", "--browser"].includes(args[i]) && args[i + 1]
      && !args[i + 1].startsWith("--") && !options.has(args[i]), "Invalid options");
    options.set(args[i], args[i + 1]);
  }
  assert.ok(options.has("--native") && options.has("--out"));
  const native = JSON.parse(readFileSync(join(options.get("--native")!, "report.json"), "utf8"));
  const { payloadHash, ...payload } = native;
  assert.equal(payloadHash, wideHash(payload)); assert.equal(native.format, "poker-face-p1-production-corpus");
  assert.equal(native.rows.length, 64);
  const expected = new Map<number, { playingSpotHash: string; numericalHash: string }>(native.rows.map(
    (r: { corpusIndex: number; playingSpotHash: string; numericalHash: string }) => [r.corpusIndex, r]));
  assert.equal(expected.size, 64);
  const out = resolve(options.get("--out")!); assert.ok(!existsSync(out)); mkdirSync(out);
  const names = (options.get("--browser") ?? "chromium").split(",");
  assert.ok(names.every(n => ["chromium", "firefox", "webkit"].includes(n)) && new Set(names).size === names.length);
  const { directory, manifest } = await loadWasm(), base = `/wasm/${manifest.buildHash}/`;
  const assets = new Map<string, { type: string; body: Uint8Array | string }>([["/", { type: "text/html", body: wideStudyHtml(base) }]]);
  for (const [url, entry] of [["/profile-page.mjs", "scripts/hu-play-p1-profile-page.ts"],
    ["/play-worker.mjs", "src/lib/solver/bridge/live/worker.ts"]]) {
    const bundled = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false });
    assets.set(url, { type: "text/javascript", body: bundled.outputFiles[0].contents });
  }
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
  const rows: (P1BrowserMeasurement & { browser: string; corpusIndex: number; street: "river" | "turn"; exactNativeParity: boolean })[] = [];
  const versions: Record<string, string> = {};
  try {
    for (const root of loadP1ProductionRoots()) for (const name of names) {
      console.error(JSON.stringify({ type: "start", browser: name, corpusIndex: root.corpusIndex, street: root.street }));
      const type = { chromium, firefox, webkit }[name as "chromium" | "firefox" | "webkit"];
      const browser = await type.launch(); versions[name] = browser.version();
      try {
        const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction("typeof window.profilePlayJob === 'function'");
        const result = await page.evaluate<P1BrowserMeasurement>(`window.profilePlayJob(${JSON.stringify(root.request)}, ${JSON.stringify(base)})`);
        const row = { browser: name, corpusIndex: root.corpusIndex, street: root.street, ...result,
          exactNativeParity: result.numericalHash === expected.get(root.corpusIndex)?.numericalHash };
        rows.push(row); write(join(out, `${name}-root-${root.corpusIndex}.json`), row); console.log(JSON.stringify(row));
        assert.ok(row.passed && row.exactNativeParity && row.workers === 1 && row.terminated === 1 && !row.isolated,
          "Production source, parity or lifecycle failed; do not drop the row");
      } finally { await browser.close(); }
    }
  } finally { await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r())); }
  const summaries = names.flatMap(browser => (["river", "turn"] as const).map(street => {
    const times = rows.filter(r => r.browser === browser && r.street === street).map(r => r.elapsedMs).sort((a, b) => a - b);
    assert.equal(times.length, 32);
    return { browser, street, n: times.length, p50Ms: (times[15] + times[16]) / 2,
      p95Ms: times[Math.ceil(.95 * times.length) - 1], maxMs: times.at(-1)!,
      chromiumP95BudgetMs: street === "river" ? 2000 : 10000 };
  }));
  const passed = summaries.every(s => s.browser !== "chromium" || s.p95Ms <= s.chromiumP95BudgetMs);
  const report = { format: "poker-face-p1-production-browser", version: 1, measuredAt: new Date().toISOString(), passed,
    machine: { cpu: cpus()[0].model, osRelease: release(), node: process.version }, browserVersions: versions,
    buildHash: manifest.buildHash, sourceHash: manifest.sourceHash, nativeReportHash: payloadHash,
    method: { roots: 64, repeatsPerRoot: 1, freshBrowserAndWorker: true, parser: "Unmodified production play-v1",
      time: "Before source.prepare to prepared-policy validation; includes public hashing, Worker loading/build/solve/export, excludes browser launch and result fingerprinting",
      memory: "Production progress status is a lower bound on linear-memory high-water; not finish/export peak or RSS. Complete peak observations remain in the separately reported W2 harness.",
      admission: "Unknown-device 192 MiB ceiling; not a physical-phone performance or safety certificate",
      scope: "Locally solved games, not global safety or exact GTO; no native/server fallback" }, summaries, rows };
  write(join(out, "report.json"), { ...report, payloadHash: wideHash(report) });
  assert.ok(passed, "Frozen production Chromium p95 budget failed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
