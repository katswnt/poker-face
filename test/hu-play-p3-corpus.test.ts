import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";
import { illegalActionReason } from "../src/lib/hu-play/public-state";
import { leanTurnActions } from "../src/lib/hu-play/turn-tree";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";

test("P3 turn roots are the first distinct seeded production arrivals, not selected by future solve outcomes", async () => {
  assert.ok(existsSync("scripts/hu-play-p3-corpus.ts"), "Frozen P3 selection rules required");
  const { seededTurnRoots } = await import("../scripts/hu-play-p3-corpus");
  const fetcher: typeof fetch = async input => {
    assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(input).includes(".."));
    return new Response(readFileSync(`public${input}`));
  };
  const catalog = await loadPlayCatalog(undefined, fetcher);
  const a = await seededTurnRoots(catalog, 3, fetcher), b = await seededTurnRoots(catalog, 3, fetcher);
  assert.deepEqual(a, b); assert.equal(a.roots.length, 3);
  assert.equal(new Set(a.roots.map(r => r.spotHash)).size, 3);
  const history = JSON.parse(readFileSync("tasks/artifacts/hu-play-p1-production-hands.json", "utf8"));
  for (const root of a.roots) {
    assert.equal(root.spotHash, history.solves.find((s: { seed: number; street: string }) => s.seed === root.seed && s.street === "turn").spotHash);
    assert.ok(!/aiHand|humanHand|runout/.test(JSON.stringify(root)));
    assert.deepEqual(root.spot, buildPlaySpot(root.request));
  }
});

test("P3 custom-turn selection covers both seats, parent families and minimum/interior/all-in amounts without consulting new solves", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("scripts/hu-play-p3-corpus.ts"));
  const { makeTurnOffTreeCase } = await import("../scripts/hu-play-p3-corpus");
  const { bindings } = await loadWasm(), q = loadP1ProductionRoots().find(r => r.street === "turn")!.request;
  const result = runWasmSpot(bindings, buildPlaySpot(q));
  const cases = Array.from({ length: 200 }, (_, seed) => makeTurnOffTreeCase(seed, q, result));
  for (const c of cases) {
    assert.deepEqual(makeTurnOffTreeCase(c.seed, q, result), c);
    assert.equal(illegalActionReason(c.request.publicState, c.actual), null);
    assert.ok(!leanTurnActions(c.request.publicState).some(a => JSON.stringify(a) === JSON.stringify(c.actual)));
    assert.equal(c.request.publicState.toAct, 1 - c.request.aiSeat);
    assert.ok(!/aiHand|humanHand|runout/.test(JSON.stringify(c)));
  }
  assert.equal(new Set(cases.map(c => c.request.aiSeat)).size, 2);
  assert.equal(new Set(cases.map(c => c.preferredFamily)).size, 4);
  assert.ok(cases.some(c => c.actual.type === "raise"));
  for (const category of ["minimum", "all-in", "near-all-in", "interior"]) assert.ok(cases.some(c => c.category === category));
  assert.ok(cases.some(c => c.request.publicState.streetActions === 2));
});

test("P3 freeze refuses a reduced or duplicate-root corpus instead of claiming 200 distinct public parents", async () => {
  const api = await import("../scripts/hu-play-p3-corpus");
  assert.equal(typeof api.buildTurnCorpus, "function", "Full-corpus freeze validation required");
  assert.throws(() => api.buildTurnCorpus([], []), /200/);
  const root = loadP1ProductionRoots().find(r => r.street === "turn")!;
  const repeated = Array.from({ length: 200 }, (_, seed) => ({ seed, librarySpotId: root.librarySpotId,
    request: root.request, spot: root.playingSpot, spotHash: hashBridgeSpot(root.playingSpot) }));
  assert.throws(() => api.buildTurnCorpus(repeated, Array(200)), /distinct|duplicate/i);
});
