import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { FORMATION_INPUTS, formationSpot, formationPlan, buildFormationManifest, verifyFormationManifest } from "../src/lib/solver/bridge/formations/fixtures";
import { LEAN_SRP_TREE } from "../src/lib/solver/bridge/fixtures";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { canonicalSlicePlan } from "../scripts/bridge-runner";

test("formation fixtures preserve chip ledgers, action order, manual weights and board removal", () => {
  const original = JSON.stringify(LEAN_SRP_TREE);
  assert.deepEqual(FORMATION_INPUTS.formations.map(f => [f.startingPot, f.effectiveStack, f.deadChips]), [[500, 9750, 0], [650, 9750, 150], [2250, 8900, 50]]);
  for (const f of FORMATION_INPUTS.formations) for (const board of FORMATION_INPUTS.flops) {
    const spot = formationSpot(f.id, board.id), plan = formationPlan(f.id, board.id);
    assert.equal(spot.startingPot, f.paidPerPlayer * 2 + f.deadChips); assert.equal(spot.effectiveStack + f.paidPerPlayer, 10000);
    assert.match(f.players[0], /acts first/); assert.match(f.players[1], /acts second/);
    assert.equal(spot.tree.mode, "menu"); if (spot.tree.mode !== "menu") throw Error("menu");
    assert.deepEqual(spot.tree.flop!.ip.bet, [{ kind: "pot", pct: 33 }, { kind: "pot", pct: 66 }]);
    assert.equal(spot.tree.maxRaisesPerStreet, 1); assert.equal(spot.solve.targetExploitabilityPctPot, .3); assert.equal(spot.solve.compression, "off");
    for (const p of [0, 1] as const) {
      // Expand explicit classes independently, by all unordered pairs in a standard deck.
      const weights = new Map(f.rangeText[p].split(" ").map(t => { const [key, v] = t.split(":"); return [key, Number(v)]; }));
      const deck = [..."23456789TJQKA"].flatMap(r => [..."cdhs"].map(s => r + s)); let before = 0, after = 0;
      const actual = new Map(spot.ranges[p].combos.map(h => [h.combo.match(/../g)!.sort().join(), h.weight]));
      for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) {
        const lo = deck[a], hi = deck[b], cls = lo[0] === hi[0] ? hi[0] + lo[0] : hi[0] + lo[0] + (lo[1] === hi[1] ? "s" : "o");
        const weight = weights.get(cls); if (weight === undefined) continue; before++;
        if (board.flop.includes(lo) || board.flop.includes(hi)) continue; after++;
        assert.equal(actual.get([lo, hi].sort().join()), weight); assert.equal(Math.fround(weight), weight);
      }
      assert.equal(before, f.preBoardCounts[p]); assert.equal(after, actual.size); assert.ok(after < before);
      assert.match(spot.ranges[p].source, /Hand-written.*not solved/);
    }
    assert.equal(plan.turn!.cards.length, 8); assert.equal(plan.river!.boards.length, 2);
    if (board === FORMATION_INPUTS.flops[0]) assert.deepEqual(plan.subtrees, [["x", "s1", "c", "Qh", "x", "s0", "c", "2c"]]);
  }
  assert.equal(JSON.stringify(LEAN_SRP_TREE), original, "must not mutate existing B3/B4 tree");
});

test("all 36 formation roots and three benchmark hashes freeze without touching the preflop corpus", () => {
  const m = buildFormationManifest(); assert.equal(m.roots.length, 36); assert.equal(m.benchmarks.length, 3);
  assert.equal(new Set(m.roots.map(r => r.spotHash)).size, 36);
  for (const r of m.roots) { const spot = formationSpot(r.formation, r.boardId); assert.equal(r.spotHash, hashBridgeSpot(spot)); assert.equal(r.planHash, canonicalSlicePlan(formationPlan(r.formation, r.boardId), spot).hash); }
  const saved = JSON.parse(readFileSync("src/lib/solver/bridge/formations/manifest.json", "utf8")); verifyFormationManifest(saved); assert.deepEqual(saved, m);
  assert.throws(() => verifyFormationManifest({ ...saved, roots: saved.roots.slice(1) }));
  assert.throws(() => formationSpot("unknown", FORMATION_INPUTS.flops[0].id));
});
