// Actual browser Workers, using the very same unbundled --target web assets as the Node audit.
// This is a loopback-only test server, not a Next route or a user-facing solver.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import { loadWasm, runWasmSpot } from "./bridge-wasm-runner";
import { canonicalBridgeSpotJson } from "../src/lib/solver/bridge/contract-node";
import { buildBridgeFixture, BRIDGE_REFEREE_IDS } from "../src/lib/solver/bridge/fixtures";
import { isomorphismProbeSpot } from "../src/lib/solver/bridge/referee-node";

async function main() {
  const names = process.argv.slice(2);
  if (!names.length) names.push("chromium");
  assert.ok(names.every(name => ["chromium", "firefox", "webkit"].includes(name)), "Expected chromium, firefox and/or webkit");
  const { bindings, directory, manifest } = await loadWasm();
  const files = new Map([
    ["/", { type: "text/html", body: Buffer.from('<!doctype html><title>W1 parity harness</title><script type="module" src="/page.mjs"></script>') }],
    ["/page.mjs", { type: "text/javascript", body: readFileSync("scripts/bridge-wasm-harness-page.mjs") }],
    ["/worker.mjs", { type: "text/javascript", body: readFileSync("scripts/bridge-wasm-harness.worker.mjs") }],
    ["/solver_bridge_wasm.js", { type: "text/javascript", body: readFileSync(join(directory, "solver_bridge_wasm.js")) }],
    ["/solver_bridge_wasm_bg.wasm", { type: "application/wasm", body: readFileSync(join(directory, "solver_bridge_wasm_bg.wasm")) }],
  ]);
  const server = createServer((req, res) => {
    const file = files.get(req.url ?? "");
    if (!file) { res.writeHead(404).end(); return; }
    // Deliberately no COOP/COEP: ST must work without cross-origin isolation.
    res.writeHead(200, { "Content-Type": file.type, "Cache-Control": "no-store" }); res.end(file.body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const name of names) {
      const browser = await ({ chromium, firefox, webkit }[name as "chromium" | "firefox" | "webkit"]).launch();
      try {
        const page = await browser.newPage();
        await page.goto(origin);
        for (const spot of [...BRIDGE_REFEREE_IDS.map(buildBridgeFixture), isomorphismProbeSpot()]) {
          const expected = runWasmSpot(bindings, spot);
          const { timings: _timings, memory: _memory, ...math } = expected;
          void _timings; void _memory;
          const projection = { ...math, convergence: expected.convergence.map(({ iteration, exploitability }) => ({ iteration, exploitability })) };
          const digest = createHash("sha256").update(JSON.stringify(projection)).digest("hex");
          const outcome = await page.evaluate<{
            digest: string; iterations: number; nodes: number; messages: number; measuredAt: number;
            linearMemoryBytes: number; isolated: boolean;
          }>(`window.runSolverHarness(${JSON.stringify({ spotJson: canonicalBridgeSpotJson(spot), origin })})`);
          assert.equal(outcome.digest, digest, `${name}/${spot.id}: complete numerical output differs from Node ST`);
          assert.equal(outcome.isolated, false);
          assert.equal(outcome.iterations, expected.iterations);
          assert.ok(outcome.messages > 1);
          assert.equal(outcome.measuredAt, expected.iterations);
          assert.ok(outcome.linearMemoryBytes > 0);
          console.log(JSON.stringify({ browser: name, game: spot.id, ...outcome }));
        }
      } finally { await browser.close(); }
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  console.log(JSON.stringify({ audit: "wasm-browser-st", passed: true, browsers: names, buildHash: manifest.buildHash }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
