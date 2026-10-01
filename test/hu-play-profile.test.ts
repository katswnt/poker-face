import assert from "node:assert/strict";
import test from "node:test";
import { loadP1WideRoots } from "../scripts/hu-play-wide-corpus";
import estimates from "../tasks/artifacts/hu-play-p1-wide-native-estimates.json";
import { parseLiveSpot, parseLiveEstimate, admitBrowserSolve, LIVE_LIMITS } from "../src/lib/solver/bridge/live/admission";
import type { LiveEstimate } from "../src/lib/solver/bridge/live/model";
import { canonicalBridgeCombo, compareBridgeCombos, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { RIVER_DECK } from "../src/lib/solver/river/cards";

const roots = loadP1WideRoots();
const parse = (spot: BridgeSpotV1) => parseLiveSpot(JSON.stringify(spot), "play-v1");
const MIB = 1024 ** 2;

test("play-v1 accepts the unchanged 64 frozen full-range roots; default W4 still refuses them", () => {
  assert.equal(roots.length, 64);
  for (const { spot } of roots) {
    assert.deepEqual(parse(spot), spot);
    assert.throws(() => parseLiveSpot(JSON.stringify(spot)), /64 hands/);
  }
  assert.equal(LIVE_LIMITS.rangeHands, 64);
  assert.equal(LIVE_LIMITS.budgetBytes, 256 * MIB);
});

test("play-v1 is an exact measured menu profile, not a general parser bypass", () => {
  const root = roots.find(r => r.street === "turn")!.spot;
  assert.equal(root.tree.mode, "menu");
  if (root.tree.mode !== "menu") throw new Error("menu expected");
  const tree = root.tree;
  const changes: Partial<BridgeSpotV1>[] = [
    { effectiveStack: root.startingPot * 18 + 1 },
    { tree: { ...tree, maxRaisesPerStreet: 2 } },
    { tree: { ...tree, forceAllInThreshold: .21 } },
    { tree: { ...tree, addAllInThreshold: .01 } },
    { tree: { ...tree, river: { ...tree.river!, oop: { bet: [{ kind: "pot", pct: 51 }], raise: [{ kind: "pot", pct: 60 }] } } } },
    { solve: { ...root.solve, maxIterations: 1001 } },
    { solve: { ...root.solve, timeoutMs: 120001 } },
    { solve: { ...root.solve, targetExploitabilityPctPot: .31 } },
    { solve: { ...root.solve, exportScope: "full" } },
    { solve: { ...root.solve, compression: "on" } },
  ];
  for (const change of changes) assert.throws(() => parse({ ...root, ...change }), /play|float32|compression|Browser/i);
  assert.equal(parse({ ...root, effectiveStack: root.startingPot * 18 }).effectiveStack, root.startingPot * 18);
  assert.throws(() => parseLiveSpot(JSON.stringify(root), "unbounded" as never), /profile/i);
  assert.throws(() => parseLiveSpot(" ".repeat(LIVE_LIMITS.inputBytes + 1), "play-v1"), /256 KiB/);
  assert.throws(() => parseLiveSpot("[".repeat(101) + "0" + "]".repeat(101), "play-v1"), /complex/);
});

test("play-v1 retains the measured reservation; mobile/unknown and memory hints only lower it", () => {
  for (const row of estimates.rows) {
    const estimate = parseLiveEstimate(JSON.stringify(row.estimate), roots.find(r => r.corpusIndex === row.corpusIndex)!.spot, row.sourceSpotHash);
    for (const profile of ["desktop-chromium", "desktop-firefox", "desktop-safari", "mobile", "unknown"] as const) {
      const verdict = admitBrowserSolve(estimate, { profile }, 4 * MIB, "play-v1");
      assert.equal(verdict.ok, true);
      assert.equal(verdict.budgetBytes, (profile.startsWith("desktop-") ? 256 : 192) * MIB);
      assert.equal(verdict.totalBytes, estimate.estimatedBytes + estimate.estimateExport.workingBytesEstimate + 132 * MIB);
    }
    const low = admitBrowserSolve(estimate, { profile: "desktop-chromium", deviceMemoryGiB: .25 }, 0, "play-v1");
    assert.equal(low.ok, false);
    assert.equal(low.budgetBytes, 64 * MIB);
  }
});

test("each play-specific engine/export ceiling fails closed even below the total reservation", () => {
  const row = estimates.rows[0];
  const base = parseLiveEstimate(JSON.stringify(row.estimate), roots.find(r => r.corpusIndex === row.corpusIndex)!.spot, row.sourceSpotHash);
  const candidates: LiveEstimate[] = [
    { ...base, estimatedBytes: 32 * MIB + 1 },
    { ...base, estimateExport: { ...base.estimateExport, workingBytesEstimate: 16 * MIB + 1 } },
    { ...base, estimateExport: { ...base.estimateExport, jsonBytesUpperBound: 2 * MIB + 1 } },
  ];
  for (const estimate of candidates) {
    assert.equal(admitBrowserSolve(estimate, { profile: "unknown" }, 0, "play-v1").ok, false);
    assert.equal(admitBrowserSolve(estimate, { profile: "unknown" }, 0).ok, true, "W4 unchanged");
  }
  assert.throws(() => admitBrowserSolve(base, { profile: "unknown" }, 0, "unbounded" as never), /profile/i);
});

test("640 is a hard hand-count ceiling, independent of small individual reach weights", () => {
  const root = roots.find(r => r.street === "turn")!.spot;
  const board = [...root.board.flop, root.board.turn!], deck = RIVER_DECK.filter(c => !board.includes(c));
  const combos = deck.flatMap((a, i) => deck.slice(0, i).map(b => ({ combo: canonicalBridgeCombo(a, b), weight: Math.fround(1e-20) })))
    .sort((a, b) => compareBridgeCombos(a.combo, b.combo));
  const spot = (n: number): BridgeSpotV1 => ({ ...root,
    ranges: [{ source: "Boundary test", combos: combos.slice(0, n) }, root.ranges[1]] });
  assert.equal(parse(spot(640)).ranges[0].combos.length, 640);
  assert.throws(() => parse(spot(641)), /640/);
});
