import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";

// Needs the native binary (npm run build:bridge); the CI bridge job builds it first.
const skip = existsSync(BRIDGE_BINARY) ? false : "solver-bridge binary not built";

test("runner solves a referee spot and returns a checked, hash-bound result", { skip }, async () => {
  const spot = buildBridgeFixture("referee-river-v3-demo");
  const progress: string[] = [];
  const run = await runBridgeSpot(spot, { onProgress: p => progress.push(p.stage) });
  assert.equal(run.result.spotHash, hashBridgeSpot(spot));
  assert.equal(run.result.engine.commit, "9d1509fe5077d019825f833eed04b16d342dfda1");
  assert.ok(run.result.exploitability.reached);
  assert.deepEqual(run.result.hands, spot.ranges.map(range => range.combos.map(entry => entry.combo)));
  assert.ok(progress.includes("solving") && progress.includes("exporting"));
  const root = run.result.tree[0];
  assert.equal(root.kind, "player");
  assert.deepEqual(root.kind === "player" && root.actions.map(a => a.action), spot.tree.mode === "explicit" && spot.tree.root.kind === "player"
    && spot.tree.root.actions.map(edge => edge.action));
});

test("runner publishes nothing on memory refusal, timeout, RSS budget or cancellation", { skip }, async () => {
  const river = buildBridgeFixture("referee-river-v3-demo");
  await assert.rejects(runBridgeSpot({ ...river, solve: { ...river.solve, memoryCapBytes: 1 } }), /exceeds the cap/);
  const flop = buildBridgeFixture("referee-flop-reference");
  await assert.rejects(runBridgeSpot(flop, { timeoutMs: 50 }), /timed out/);
  await assert.rejects(runBridgeSpot(flop, { rssLimitBytes: 1 }), /RSS/);
  const controller = new AbortController();
  const pending = runBridgeSpot(flop, { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, /cancelled/);
  controller.abort();
  await assert.rejects(runBridgeSpot(river, { signal: controller.signal }), /cancelled before start/);
});
