import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";

test("production P1 requests preserve all 64 frozen games, ranges and river-first order", async () => {
  assert.ok(existsSync("scripts/hu-play-p1-corpus.ts"), "Production corpus reconstruction is required");
  const { loadP1ProductionRoots, gameProjection } = await import("../scripts/hu-play-p1-corpus");
  const { buildPlaySpot } = await import("../src/lib/hu-play/sources/resolved");
  const roots = loadP1ProductionRoots();
  assert.equal(roots.length, 64);
  assert.ok(roots.slice(0, 32).every(r => r.street === "river"));
  assert.ok(roots.slice(32).every(r => r.street === "turn"));
  for (const root of roots) {
    assert.deepEqual(gameProjection(buildPlaySpot(root.request)), gameProjection(root.spot));
    assert.equal(root.request.aiSeat, root.seed % 2);
    assert.deepEqual(Object.keys(root.request).sort(), ["aiSeat", "publicState", "ranges"]);
  }
});

test("first-street comparison ignores reindexed continuation IDs but detects any exported strategy change", {
  skip: existsSync(join(WASM_BUILD_ROOT, "manifest.json")) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("scripts/hu-play-p1-corpus.ts"));
  const { firstStreetProjection } = await import("../scripts/hu-play-p1-corpus");
  const { bindings } = await loadWasm(), base = buildBridgeFixture("referee-turn-v2-dry-value");
  const spot = { ...base, solve: { ...base.solve, maxIterations: 1 } };
  const full = runWasmSpot(bindings, spot);
  const first = runWasmSpot(bindings, { ...spot, solve: { ...spot.solve, exportScope: "first-street" } });
  assert.deepEqual(firstStreetProjection(full), firstStreetProjection(first));
  const changed = structuredClone(first), node = changed.tree.find(n => n.kind === "player")!;
  if (node.kind !== "player") throw new Error("Player required");
  Object.assign(node.strategy[0], { 0: .123456789 });
  assert.notDeepEqual(firstStreetProjection(changed), firstStreetProjection(first));
});
