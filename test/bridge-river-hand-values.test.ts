import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";
import { validateBridgeSpot } from "../src/lib/solver/bridge/contract";

test("river per-hand value/BR grader agrees with the independent factorized scorekeeper and quadratic kernels", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  assert.ok(existsSync("src/lib/solver/bridge/river-hand-values.ts"), "Independent per-hand river grader required");
  const { gradeRiverHands } = await import("../src/lib/solver/bridge/river-hand-values");
  const s = buildBridgeFixture("referee-river-v3-demo"), { result: r } = await runBridgeSpot(s, { threads: 1 });
  const a = gradeRiverHands(s, r), quadratic = gradeRiverHands(s, r, "naive");
  const b = gradeRiverSubgame({ hands: r.hands, startingPot: s.startingPot,
    subtree: { path: [], nodes: r.tree, reach: s.ranges.map(range => range.combos.map(h => h.weight)) as [number[], number[]], ev: r.root.engineEv } });
  for (const p of [0, 1] as const) {
    assert.ok(Math.abs(a.value[p] - b.ours.value[p]) < 1e-10);
    assert.ok(Math.abs(a.gains[p] - b.ours.gains[p]) < 1e-10);
    for (let h = 0; h < r.hands[p].length; h++) {
      assert.ok(Math.abs(a.perHand[p].value[h]! - quadratic.perHand[p].value[h]!) < 1e-10);
      assert.ok(Math.abs(a.perHand[p].bestResponse[h]! - quadratic.perHand[p].bestResponse[h]!) < 1e-10);
      assert.ok(a.perHand[p].bestResponse[h]! + 1e-10 >= a.perHand[p].value[h]!);
      assert.ok(Math.abs(a.perHand[p].value[h]! - r.root.ev[p][h]) < .0002);
    }
  }
  const bad = structuredClone(r), leaf = bad.tree.find(n => n.kind === "terminal")!;
  Object.assign(leaf, { committed: [12345, 12345] });
  assert.throws(() => gradeRiverHands(s, bad), /committed|chip/i);
});

test("forced-prefix human BR integrates hidden hands before choosing; sunk chips and zero-probability alternatives stay correct", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  const { gradeRiverHands } = await import("../src/lib/solver/bridge/river-hand-values");
  const base = buildBridgeFixture("referee-river-v3-demo");
  const s = validateBridgeSpot({ ...base, startingPot: 100, effectiveStack: 50,
    board: { flop: ["Kd", "8c", "4h"], turn: "2s", river: "9d" },
    ranges: [{ source: "test", combos: [{ combo: "7s6s", weight: 1 }, { combo: "AsAh", weight: 1 }] },
      { source: "test", combos: [{ combo: "KsQs", weight: 1 }] }],
    tree: { mode: "river-subgame-v1", prefixLength: 1, root: { kind: "player", player: 0, actions: [
      { action: { type: "bet", to: 50 }, next: { kind: "player", player: 1, actions: [
        { action: { type: "fold" }, next: { kind: "terminal", outcome: "fold" } },
        { action: { type: "call" }, next: { kind: "terminal", outcome: "showdown" } },
      ] } },
    ] } } });
  const { result } = await runBridgeSpot(s, { threads: 1 });
  const n = result.tree[1]; if (n.kind !== "player") throw new Error("No human parent");
  Object.assign(n, { strategy: [[.5], [.5]] });
  const g = gradeRiverHands(s, result);
  assert.deepEqual(g.value, [25, -25]);
  assert.deepEqual(g.gains, [0, 25]);
  assert.deepEqual(g.perHand[1].bestResponse, [0]); // not the hidden-card-cheating value +25
  assert.deepEqual(g.perHand[0].value, [-25, 75]);
});

test("derived river profiles are graded without inventing engine metadata, with strict hand and tree identity", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  const grader = await import("../src/lib/solver/bridge/river-hand-values");
  assert.equal(typeof grader.gradeRiverProfile, "function", "Derived-profile grader required");
  const spot = buildBridgeFixture("referee-river-v3-demo"), { result } = await runBridgeSpot(spot, { threads: 1 });
  const profile = { hands: result.hands, tree: result.tree };
  assert.deepEqual(grader.gradeRiverProfile(spot, profile), grader.gradeRiverHands(spot, result));
  assert.throws(() => grader.gradeRiverProfile(spot, { ...profile, hands: [result.hands[1], result.hands[0]] }), /hands/i);
  const bad = structuredClone(profile), parent = bad.tree.find(n => n.kind === "player")!;
  Object.assign(parent, { strategy: [] });
  assert.throws(() => grader.gradeRiverProfile(spot, bad), /shape/i);
  const loop = structuredClone(profile), node = loop.tree[0];
  if (node.kind !== "player") throw new Error("No player root");
  Object.assign(node.actions[0], { child: 0 });
  assert.throws(() => grader.gradeRiverProfile(spot, loop), /child/i);
});
