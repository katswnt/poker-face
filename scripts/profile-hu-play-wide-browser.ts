// Offline private-loopback observations only. Never imported by the deployed app.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "@playwright/test";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { loadWasm } from "./bridge-wasm-runner";
import { scopedBrowserRss } from "./bridge-live-measurement";
import { loadP1WideRoots, nativeMeasurementSpot, ratioMeasurementSpot, wideHash } from "./hu-play-wide-corpus";
import { timingRatio, wideStudyHtml } from "./hu-play-wide-measurement";
import type { WideBrowserMeasurement } from "./hu-play-wide-profile-page";

const exec = promisify(execFile), SAMPLE_MS = 20;
const writeNew = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function snapshot() {
  return (await exec("ps", ["-axo", "pid=,ppid=,rss=,comm="], { maxBuffer: 4 * 1024 ** 2 })).stdout;
}
async function measureRss<T>(pid: number, scope: { directory: string; preexistingPids: number[] }, action: () => Promise<T>) {
  const sample = async () => scopedBrowserRss(await snapshot(), pid, scope);
  const samples = [{ atMs: 0, ...await sample() }], started = performance.now();
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, failure: unknown;
  let pending: Promise<void> = Promise.resolve();
  const observe = async () => { samples.push({ atMs: performance.now() - started, ...await sample() }); };
  const schedule = () => { timer = setTimeout(() => {
    pending = observe().catch(e => { failure = e; }).finally(() => { if (!stopped && !failure) schedule(); });
  }, SAMPLE_MS); };
  schedule();
  try {
    const result = await action(); stopped = true; clearTimeout(timer); await pending; await observe();
    if (failure) throw failure;
    const peak = Math.max(...samples.map(s => s.rssBytes)), baseline = samples[0].rssBytes;
    return { result, memory: { baselineRssBytes: baseline, sampledPeakBrowserRssBytes: peak,
      sampledIncrementRssBytes: peak - baseline, samples: samples.length,
      companionProcesses: Math.max(...samples.map(s => s.companionProcesses)),
      maxSampleGapMs: Math.max(...samples.slice(1).map((s, i) => s.atMs - samples[i].atMs)),
      samplingWindowMs: performance.now() - started } };
  } finally { stopped = true; clearTimeout(timer); await pending; }
}

async function main() {
  const args = process.argv.slice(2), options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(["--mode", "--native", "--out", "--browser", "--street"].includes(args[i]) && args[i + 1]
      && !args[i + 1].startsWith("--") && !options.has(args[i]), "Unknown/duplicate/incomplete option");
    options.set(args[i], args[i + 1]);
  }
  const mode = options.get("--mode"), out = resolve(options.get("--out") ?? "");
  assert.ok(mode === "ratio" || mode === "quality"); assert.ok(options.has("--out") && !existsSync(out));
  assert.ok(options.has("--native"));
  const nativeReports = options.get("--native")!.split(",").map(dir => {
    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    const { payloadHash, ...payload } = report; assert.equal(wideHash(payload), payloadHash);
    assert.equal(report.format, "poker-face-p1-full-range-native-observations");
    assert.equal(report.mode ?? "--solve", mode === "ratio" ? "--ratio" : "--solve");
    return report;
  });
  const nativeRows: { corpusIndex: number; measurementSpotHash: string; numericalHash: string;
    iterations: number; wallMs: number; timings: { solveMs: number }; status: string }[] = nativeReports.flatMap(r => r.rows);
  assert.equal(new Set(nativeRows.map(r => r.corpusIndex)).size, nativeRows.length);
  assert.ok(nativeRows.every(r => r.status === (mode === "ratio" ? "measured" : "passed")));
  const names = (options.get("--browser") ?? "chromium,firefox,webkit").split(",");
  assert.ok(names.every(n => ["chromium", "firefox", "webkit"].includes(n)) && new Set(names).size === names.length);
  const street = options.get("--street") ?? "all"; assert.ok(["river", "turn", "all"].includes(street));
  const roots = loadP1WideRoots().filter(r => nativeRows.some(n => n.corpusIndex === r.corpusIndex)
    && (street === "all" || r.street === street));
  assert.equal(nativeRows.length, mode === "ratio" ? 6 : 64, "Use the complete native dataset, filter only browser street");
  assert.ok(platform() === "darwin" || platform() === "linux"); mkdirSync(out);
  const { directory, manifest } = await loadWasm(), base = `/wasm/${manifest.buildHash}/`;
  const assets = new Map<string, { type: string; body: Uint8Array | string }>([["/", { type: "text/html",
    body: wideStudyHtml(base) }]]);
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
  const rows = [], versions: Record<string, string> = {};
  try {
    // Roots already ordered rivers first. Bundle outside the measurement window; only one
    // allowlisted request lives in each page/Worker, avoiding a 64-spot baseline inflation.
    for (const root of roots) {
      const spot = (mode === "ratio" ? ratioMeasurementSpot : nativeMeasurementSpot)(root.spot);
      const spotJson = canonicalBridgeSpotJson(spot), expected = nativeRows.find(r => r.corpusIndex === root.corpusIndex)!;
      assert.equal(hashBridgeSpot(spot), expected.measurementSpotHash);
      for (const [url, entry] of [["/profile-page.mjs", "scripts/hu-play-wide-profile-page.ts"],
        ["/profile-worker.mjs", "scripts/bridge-live-profile.worker.ts"]]) {
        const bundle = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false,
          define: { __P1_STUDY_ALLOWED_JSON__: JSON.stringify([spotJson]) }, plugins: [{ name: "frozen-input-research-only",
            setup(builder) { builder.onResolve({ filter: /^\.\/admission$/ }, args => {
              if (/\/bridge\/live\/(client|runtime)\.ts$/.test(args.importer)) return { path: resolve("scripts/hu-play-wide-research-shim.ts") };
              return undefined;
            }); } }] });
        assets.set(url, { type: "text/javascript", body: bundle.outputFiles[0].contents });
      }
      for (const name of names) {
        const type = { chromium, firefox, webkit }[name as "chromium" | "firefox" | "webkit"];
        const preexistingPids = (await snapshot()).trim().split(/\n/).map(line => Number(line.trim().split(/\s+/)[0]));
        const launched = await type.launchServer();
        console.error(JSON.stringify({ type: "start", mode, browser: name, corpusIndex: root.corpusIndex, street: root.street }));
        try {
          const browser = await type.connect(launched.wsEndpoint()); versions[name] = browser.version();
          const pid = launched.process().pid; assert.ok(pid);
          const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
          await page.waitForFunction("typeof window.profileWideJob === 'function'");
          const { result, memory } = await measureRss(pid, { directory: dirname(type.executablePath()), preexistingPids }, () => page.evaluate<WideBrowserMeasurement>(
            `window.profileWideJob(${JSON.stringify({ type: "solve", spotJson, assetBase: base, environment: { profile: "unknown" } })})`));
          const parity = result.status === "result" && result.numericalHash === expected.numericalHash && result.iterations === expected.iterations;
          const passed = parity && result.workers === 1 && result.terminated === 1 && !result.isolated
            && !(name === "webkit" && platform() === "darwin" && memory.companionProcesses === 0);
          const row = { browser: name, corpusIndex: root.corpusIndex, street: root.street, sourceSpotHash: root.sourceSpotHash,
            measurementSpotHash: expected.measurementSpotHash, ...result, ...memory, exactNativeParity: parity, passed,
            nativeSolveMs: expected.timings.solveMs, nativeWallMs: expected.wallMs,
            solveSpeedRatio: result.timings ? timingRatio(expected.timings.solveMs, result.timings.solveMs) : null,
            endToEndSpeedRatio: result.terminalElapsedMs / expected.wallMs };
          rows.push(row); writeNew(join(out, `${name}-root-${root.corpusIndex}.json`), row); console.log(JSON.stringify(row));
          await browser.close();
        } catch (error) {
          const row = { browser: name, corpusIndex: root.corpusIndex, street: root.street, passed: false,
            harnessError: error instanceof Error ? error.message : String(error) };
          rows.push(row); writeNew(join(out, `${name}-root-${root.corpusIndex}.failure.json`), row); console.error(JSON.stringify(row));
        } finally { await launched.close(); }
      }
    }
  } finally { await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r())); }
  const report = { format: "poker-face-p1-full-range-browser-observations", version: 1, mode, measuredAt: new Date().toISOString(),
    machine: { cpu: cpus()[0].model, ramBytes: totalmem(), platform: platform(), osRelease: release(), node: process.version },
    browserVersions: versions, buildHash: manifest.buildHash, sourceHash: manifest.sourceHash, engineCommit: manifest.engineCommit,
    nativeReportHashes: nativeReports.map(r => r.payloadHash),
    method: { freshBrowserPerCase: true, freshWorkerPerCase: true, repeatsPerCase: 1, sampleIntervalMs: SAMPLE_MS,
      parser: "Exact frozen-input allowlist in private loopback bundle; production parser unchanged; original W2 reservation/memory watchdog retained; 30-minute research timeout",
      wallTime: "page request to terminal event, including Worker/loading/build/solve/export/check/clone; excludes browser launch and fingerprinting",
      solveTime: "integer-ms engine session clock; browser yielding/finalization included, not pure CPU time; ratios are platform observations, not phone predictions",
      linearMemory: "monotonic WASM high-water sampled at events through finish/export; excludes JS and browser memory",
      rss: "sampled browser tree plus new same-bundle WebKit XPC companions; baseline/increment reported, shared pages may be double-counted, brief peaks may be missed; not PSS",
      samplingWindow: "includes result fingerprinting; sampler adds overhead",
      scope: "Frozen full-range local game only, not production play, whole-game safety, or physical-device certification" }, rows };
  writeNew(join(out, "report.json"), { ...report, payloadHash: wideHash(report) });
  if (rows.some(r => !r.passed)) process.exitCode = 2;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
