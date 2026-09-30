// W3 reproducible desktop observations. Not a mobile budget certificate or a speed promise.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "@playwright/test";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { loadWasm, runWasmSpot } from "./bridge-wasm-runner";
import { buildLiveSizingGrid } from "./bridge-live-grid";
import { scopedBrowserRss } from "./bridge-live-measurement";
import type { BrowserJobMeasurement } from "./bridge-live-profile-page";

const exec = promisify(execFile), SAMPLE_MS = 20;
async function processSnapshot() {
  return (await exec("ps", ["-axo", "pid=,ppid=,rss=,comm="], { maxBuffer: 4 * 1024 ** 2 })).stdout;
}
async function measureRss<T>(pid: number, scope: { directory: string; preexistingPids: number[] }, action: () => Promise<T>) {
  const sample = async () => scopedBrowserRss(await processSnapshot(), pid, scope);
  const samples = [{ atMs: 0, ...await sample() }]; const started = performance.now();
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve(), failure: unknown;
  const observe = async () => { samples.push({ atMs: performance.now() - started, ...await sample() }); };
  const schedule = () => { timer = setTimeout(() => {
    pending = observe().catch(e => { failure = e; }).finally(() => { if (!stopped && !failure) schedule(); });
  }, SAMPLE_MS); };
  schedule();
  try {
    const result = await action();
    stopped = true; clearTimeout(timer); await pending; await observe();
    if (failure) throw failure;
    return { result, memory: { baselineRssBytes: samples[0].rssBytes,
      sampledPeakBrowserRssBytes: Math.max(...samples.map(s => s.rssBytes)), samples: samples.length,
      companionProcesses: Math.max(...samples.map(s => s.companionProcesses)),
      maxSampleGapMs: Math.max(...samples.slice(1).map((s, i) => s.atMs - samples[i].atMs)),
      samplingWindowMs: performance.now() - started } };
  } finally { stopped = true; clearTimeout(timer); await pending; }
}

async function main() {
  const args = process.argv.slice(2), outputIndex = args.indexOf("--output"); let output: string | undefined;
  if (outputIndex >= 0) { output = args[outputIndex + 1]; assert.ok(output && !output.startsWith("--")); args.splice(outputIndex, 2); }
  const names = args.length ? args : ["chromium", "firefox", "webkit"];
  assert.ok(names.every(n => ["chromium", "firefox", "webkit"].includes(n)) && new Set(names).size === names.length);
  assert.ok(platform() === "darwin" || platform() === "linux", "RSS sampler requires ps on macOS/Linux");
  const grid = buildLiveSizingGrid(100), { bindings, directory, manifest } = await loadWasm();
  const bundle = async (entry: string) => (await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser",
    target: "es2022", write: false })).outputFiles[0].contents;
  const assets = new Map<string, { type: string; body: Uint8Array | string }>([
    ["/", { type: "text/html", body: '<!doctype html><title>W3 measurement</title><script type="module" src="/profile-page.mjs"></script>' }],
    ["/profile-page.mjs", { type: "text/javascript", body: await bundle("scripts/bridge-live-profile-page.ts") }],
    ["/profile-worker.mjs", { type: "text/javascript", body: await bundle("scripts/bridge-live-profile.worker.ts") }],
  ]);
  const base = `/wasm/${manifest.buildHash}/`;
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
  const rows = [], versions: Record<string, string> = {}, digests = new Map<string, string>();
  try {
    for (const name of names) for (const spot of grid) {
      const type = { chromium, firefox, webkit }[name as "chromium" | "firefox" | "webkit"];
      // Fresh process prevents earlier exports/caches from inflating a later case's baseline.
      const preexistingPids = (await processSnapshot()).trim().split(/\n/).map(line => Number(line.trim().split(/\s+/)[0]));
      const launched = await type.launchServer();
      try {
        const browser = await type.connect(launched.wsEndpoint()); versions[name] = browser.version();
        const pid = launched.process().pid; assert.ok(pid);
        const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction("typeof window.profileLiveJob === 'function'");
        const { result, memory } = await measureRss(pid, { directory: dirname(type.executablePath()), preexistingPids }, () => page.evaluate<BrowserJobMeasurement>(
          `window.profileLiveJob(${JSON.stringify({ type: "solve", spotJson: canonicalBridgeSpotJson(spot), assetBase: base,
            environment: { profile: "unknown" } })})`));
        assert.equal(result.workers, 1); assert.equal(result.terminated, 1); assert.equal(result.isolated, false);
        if (name === "webkit" && platform() === "darwin") assert.ok(memory.companionProcesses > 0, "WebKit XPC memory must be sampled");
        assert.equal(result.admitted, !/^w2-turn-\d+-full-wide$/.test(spot.id), `Unexpected admission: ${spot.id}`);
        if (result.admitted) {
          if (!digests.has(spot.id)) {
            const expected = runWasmSpot(bindings, spot), { timings, memory: wasmMemory, ...math } = expected; void timings; void wasmMemory;
            const projection = { ...math, convergence: expected.convergence.map(({ iteration, exploitability }) => ({ iteration, exploitability })) };
            digests.set(spot.id, createHash("sha256").update(JSON.stringify(projection)).digest("hex"));
          }
          assert.equal(result.digest, digests.get(spot.id), `${name}/${spot.id}: numerical fingerprint`);
        }
        const row = { browser: name, id: spot.id, spotHash: hashBridgeSpot(spot), ...result, ...memory };
        rows.push(row); console.log(JSON.stringify(row));
        await browser.close();
      } finally { await launched.close(); }
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  const report = { format: "poker-face-browser-observations", version: 1, measuredAt: new Date().toISOString(),
    machine: { cpu: cpus()[0].model, ramBytes: totalmem(), platform: platform(), osRelease: release(), node: process.version },
    browserVersions: versions, buildHash: manifest.buildHash, sourceHash: manifest.sourceHash, engineCommit: manifest.engineCommit,
    inputGridHash: createHash("sha256").update(canonicalSolverJson(grid)).digest("hex"),
    method: { requestedIterations: 100, repeatsPerCase: 1, freshBrowserPerCase: true, freshWorkerPerCase: true, sampleIntervalMs: SAMPLE_MS,
      wallTime: "page request through terminal event; includes Worker/loading/build/solve/export/check/clone, excludes browser launch and fingerprinting",
      linearMemory: "monotonic WASM high-water read at events, including after export; excludes JS and browser memory",
      rss: "sampled sum of browser root/descendants plus newly launched same-bundle companions (macOS WebKit XPC); excludes pre-existing PIDs outside the tree; includes baseline, may double-count shared pages and miss brief peaks/other reparented processes; not PSS or JS-heap size",
      samplingWindow: "includes result fingerprinting on the page after the terminal event; sampler and harness add overhead",
      limits: "synthetic 100-iteration observations, not converged strategy certification, physical-device testing, or evidence to raise admission caps" }, rows };
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ profile: "bridge-live-browser", passed: true, cases: rows.length, output: output ?? null }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
