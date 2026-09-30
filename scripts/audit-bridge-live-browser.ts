// W2: execute the actual production Worker/runtime/client in non-isolated browsers.
// Loopback harness only, no new public UI or deployment of generated assets.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "@playwright/test";
import { loadWasm, runWasmSpot } from "./bridge-wasm-runner";
import { canonicalBridgeSpotJson } from "../src/lib/solver/bridge/contract-node";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { isomorphismProbeSpot } from "../src/lib/solver/bridge/referee-node";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import type { LiveStatus } from "../src/lib/solver/bridge/live/model";

async function main() {
  const names = process.argv.slice(2); if (!names.length) names.push("chromium");
  assert.ok(names.every(n => ["chromium", "firefox", "webkit"].includes(n)));
  const { bindings, directory, manifest } = await loadWasm();
  const bundle = async (entry: string) => (await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser",
    target: "es2022", write: false })).outputFiles[0].contents;
  const assets = new Map<string, { type: string; body: Uint8Array | string }>([
    ["/", { type: "text/html", body: '<!doctype html><title>W2 Worker audit</title><script type="module" src="/page.mjs"></script>' }],
    ["/page.mjs", { type: "text/javascript", body: await bundle("scripts/bridge-live-harness-page.ts") }],
    ["/worker.mjs", { type: "text/javascript", body: await bundle("src/lib/solver/bridge/live/worker.ts") }],
    ["/busy.mjs", { type: "text/javascript", body: "onmessage = () => { for (;;) {} };" }],
  ]);
  // A deliberately unresponsive test double enters each long synchronous stage, then
  // blocks its own event loop. The production client must hard-terminate it without
  // receiving a cancellation acknowledgement or accepting any late result.
  for (const stage of ["building", "solving", "exporting"]) {
    assets.set(`/busy-${stage}.mjs`, { type: "text/javascript", body:
      `onmessage = ({ data }) => { postMessage({ type: "progress", id: data.id, stage: "${stage}", elapsedMs: 0 }); for (;;) {} };` });
  }
  const base = `/wasm/${manifest.buildHash}/`;
  const server = createServer((req, res) => {
    const url = req.url ?? "", file = assets.get(url);
    if (file) { res.writeHead(200, { "Content-Type": file.type }); res.end(file.body); return; }
    const corrupt = url.startsWith(`/corrupt/${manifest.buildHash}/`);
    const relative = url.startsWith(base) ? url.slice(base.length) : corrupt ? url.slice(`/corrupt/${manifest.buildHash}/`.length) : "";
    if (relative !== "manifest.json" && !Object.hasOwn(manifest.files, relative)) { res.writeHead(404).end(); return; }
    const bytes = readFileSync(join(directory, relative));
    if (corrupt && relative.endsWith(".wasm")) bytes[0] ^= 1;
    res.writeHead(200, { "Content-Type": relative.endsWith(".js") ? "text/javascript" : relative.endsWith(".wasm") ? "application/wasm" : "text/plain" });
    res.end(bytes);
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    for (const name of names) {
      const browser = await ({ chromium, firefox, webkit }[name as "chromium" | "firefox" | "webkit"]).launch();
      try {
        const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction("typeof window.runLiveHarness === 'function'");
        async function run(s: BridgeSpotV1, options: { mode?: string; cancel?: string; busy?: boolean; assetBase?: string } = {}) {
          return await page.evaluate<{ digest?: string; final: { type: string; hard?: boolean; message?: string; verdict?: { ok: boolean }; iterations?: number };
            heartbeat: number; workers: number; terminated: number; isolated: boolean; resultCount: number; terminalCount: number;
            progress: LiveStatus[]; stages: string[]; elapsedMs: number }>(`window.runLiveHarness(${JSON.stringify({ type: options.mode ?? "solve",
              spotJson: canonicalBridgeSpotJson(s), assetBase: options.assetBase ?? base, environment: { profile: "unknown" } })},
              ${JSON.stringify(options.cancel)}, ${!!options.busy})`);
        }
        const fixtures = [buildBridgeFixture("referee-river-v3-demo"), buildBridgeFixture("referee-turn-v2-dry-value"), isomorphismProbeSpot()]
          .map(s => ({ ...s, solve: { ...s.solve, maxIterations: 100, targetExploitabilityPctPot: 1e-9, timeoutMs: 120_000 } }));
        for (const s of fixtures) {
          const expected = runWasmSpot(bindings, s), { timings, memory, ...math } = expected; void timings; void memory;
          const projection = { ...math, convergence: expected.convergence.map(({ iteration, exploitability }) => ({ iteration, exploitability })) };
          const outcome = await run(s); assert.equal(outcome.final.type, "result", JSON.stringify(outcome));
          assert.equal(outcome.digest, createHash("sha256").update(JSON.stringify(projection)).digest("hex"), `${name}/${s.id}`);
          assert.equal(outcome.isolated, false); assert.equal(outcome.workers, 1); assert.equal(outcome.terminated, 1);
          assert.equal(outcome.resultCount, 1); assert.equal(outcome.terminalCount, 1); assert.ok(outcome.heartbeat > 0);
          assert.equal(outcome.progress[0].iterations, 0); assert.equal(outcome.progress.at(-1)?.iterations, expected.iterations);
          for (let i = 1; i < outcome.progress.length; i++) assert.ok(outcome.progress[i].iterations >= outcome.progress[i - 1].iterations);
          console.log(JSON.stringify({ browser: name, game: s.id, digest: outcome.digest, heartbeat: outcome.heartbeat, elapsedMs: outcome.elapsedMs }));
        }
        const s = fixtures[0];
        for (const cancel of ["loading", "building", "solving", "exporting", "checking"]) {
          const o = await run(s, { cancel }); assert.equal(o.final.type, "cancelled", `${name}/${cancel}: ${JSON.stringify(o)}`);
          assert.equal(o.resultCount, 0); assert.equal(o.terminalCount, 1); assert.equal(o.terminated, 1);
        }
        const hard = await run(s, { busy: true }); assert.equal(hard.final.hard, true); assert.ok(hard.heartbeat > 5); assert.equal(hard.terminated, 1);
        for (const cancel of ["building", "solving", "exporting"]) {
          const blocked = await run(s, { busy: true, cancel });
          assert.ok(blocked.stages.includes(cancel), `${name}: blocked Worker must enter ${cancel}`);
          assert.equal(blocked.final.type, "cancelled"); assert.equal(blocked.final.hard, true);
          assert.equal(blocked.resultCount, 0); assert.equal(blocked.terminalCount, 1);
          assert.equal(blocked.terminated, 1); assert.ok(blocked.heartbeat > 5);
          console.log(JSON.stringify({ browser: name, blockedStage: cancel, hardCancelMs: blocked.elapsedMs }));
        }
        const estimate = await run(s, { mode: "estimate" }); assert.equal(estimate.final.type, "estimate"); assert.equal(estimate.final.verdict?.ok, true);
        assert.ok(!estimate.stages.includes("allocating"));
        const refused = await run({ ...s, solve: { ...s.solve, memoryCapBytes: 1 } }); assert.equal(refused.final.type, "estimate");
        assert.equal(refused.final.verdict?.ok, false); assert.ok(!refused.stages.includes("allocating"));
        for (const assetBase of [`/missing/${manifest.buildHash}/`, `/corrupt/${manifest.buildHash}/`]) {
          const failed = await run(s, { assetBase }); assert.equal(failed.final.type, "error"); assert.equal(failed.terminated, 1);
        }
        const flop = await run(buildBridgeFixture("referee-flop-reference")); assert.equal(flop.final.type, "error"); assert.equal(flop.workers, 0);
        const again = await run(s); assert.equal(again.final.type, "result");
        console.log(JSON.stringify({ browser: name, lifecycle: "passed", hardCancelMs: hard.elapsedMs, freshSolve: true }));
      } finally { await browser.close(); }
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  console.log(JSON.stringify({ audit: "bridge-live-browser", passed: true, browsers: names, buildHash: manifest.buildHash }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
