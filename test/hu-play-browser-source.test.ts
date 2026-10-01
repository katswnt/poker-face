import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import type { LiveEvent } from "../src/lib/solver/bridge/live/model";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { playTree } from "../src/lib/solver/bridge/live/play-profile";

const base = buildBridgeFixture("referee-river-v3-demo");
const spot = { ...base, tree: playTree(base.board), solve: { ...base.solve, targetExploitabilityPctPot: .3,
  exportScope: "first-street" as const, maxIterations: 1000, timeoutMs: 120000 } };

test("browser public solver carries the play profile and aborts or refuses without a partial result", async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/browser.ts"), "BrowserResolveSource must use the W2 client");
  const { BrowserPublicSolver } = await import("../src/lib/hu-play/sources/browser");
  for (const kind of ["abort", "refuse", "timeout", "dispose", "supersede"] as const) {
    let emit!: (event: LiveEvent) => void, cancelled = 0, disposed = 0, starts = 0;
    const runner = new BrowserPublicSolver({ assetBase: "/wasm/test/", environment: { profile: "unknown" },
      createClient: listener => {
        emit = listener;
        return { start: request => { starts++; assert.equal(request.profile, "play-v1");
          assert.deepEqual(JSON.parse(request.spotJson), spot); return 1; },
        cancel: () => { cancelled++; emit({ type: "cancelled", id: 1, hard: false, elapsedMs: 1 }); },
        dispose: () => { disposed++; } };
      } });
    const controller = new AbortController();
    const promise = runner.solve(spot, controller.signal);
    const rejected = assert.rejects(promise, /cancel|refus|timed out|disposed|superseded/i);
    if (kind === "abort") controller.abort();
    else if (kind === "dispose") runner.dispose();
    else if (kind === "supersede") {
      const next = runner.solve(spot); const nextRejected = assert.rejects(next, /disposed/i); runner.dispose(); await nextRejected;
    } else if (kind === "timeout") emit({ type: "error", id: 1, message: "Browser job timed out" });
    else emit({ type: "estimate", id: 1, verdict: { ok: false, reason: "Admission refused" } } as LiveEvent);
    await rejected;
    assert.equal(cancelled, kind === "abort" ? 1 : 0);
    assert.equal(disposed, starts);
  }
});
