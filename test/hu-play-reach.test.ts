// Reach-vector bookkeeping on the referee river game and pseudo-harmonic translation properties.
import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { BridgeAction, BridgeExplicitNode } from "../src/lib/solver/bridge/contract";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { applyStrategy, rangeFromBridge, reachOf, removeCard } from "../src/lib/hu-play/reach";
import { fnv1a } from "../src/lib/hu-play/rng";
import { pseudoHarmonicProbabilityA, pseudoHarmonicProbabilityChips } from "../src/lib/hu-play/translation";

const key = (action: BridgeAction) => action.type + ("to" in action ? action.to : "");
/** A fixed, hand-dependent strategy for every node of the referee game (normalized per hand). */
function sigma(path: string, actions: readonly BridgeAction[], combo: string, action: BridgeAction): number {
  const w = (a: BridgeAction) => 1 + (fnv1a(`${path}|${combo}|${key(a)}`) % 97);
  return w(action) / actions.reduce((s, a) => s + w(a), 0);
}

test("referee river game: reach at every node equals range weight × Π σ(own actions on the path)", () => {
  const spot = buildBridgeFixture("referee-river-v3-demo");
  assert.equal(spot.tree.mode, "explicit");
  const root = (spot.tree as { root: BridgeExplicitNode }).root;
  let checked = 0;
  const visit = (node: BridgeExplicitNode, path: string, steps: { player: 0 | 1; path: string; actions: readonly BridgeAction[]; action: BridgeAction }[],
    reach: ReturnType<typeof rangeFromBridge>[]) => {
    for (const player of [0, 1] as const) {
      for (const entry of spot.ranges[player].combos) {
        const direct = steps.filter(s => s.player === player)
          .reduce((product, s) => product * sigma(s.path, s.actions, entry.combo, s.action), entry.weight);
        assert.ok(Math.abs(reachOf(reach[player], entry.combo) - direct) <= 1e-15, `${path} ${entry.combo}`);
      }
    }
    checked += 1;
    if (node.kind !== "player") return;
    const actions = node.actions.map(edge => edge.action);
    for (const edge of node.actions) {
      const next = [...reach];
      next[node.player] = applyStrategy(reach[node.player], combo => sigma(path, actions, combo, edge.action));
      visit(edge.next, `${path}/${key(edge.action)}`, [...steps, { player: node.player, path, actions, action: edge.action }], next);
    }
  };
  visit(root, "", [], [rangeFromBridge(spot.ranges[0]), rangeFromBridge(spot.ranges[1])]);
  assert.ok(checked > 5, `visited ${checked} nodes`);
});

test("reach: σ outside [0, 1] is refused; a dealt card removes only the combos it blocks", () => {
  const range = { source: "t", entries: [{ combo: "AsKs", weight: 1 }, { combo: "QhJh", weight: 0.5 }] };
  assert.throws(() => applyStrategy(range, () => 1.5), /outside/);
  assert.deepEqual(removeCard(range, "Ks").entries, [{ combo: "QhJh", weight: 0.5 }]);
  assert.deepEqual(removeCard(range, "2c").entries, range.entries);
});

const unit = fc.double({ min: 0, max: 5, noNaN: true });
test("pseudo-harmonic: f(A)=1, f(B)=0, monotone in x, in [0, 1], and scale-invariant in chips", () => {
  assert.ok(Math.abs(pseudoHarmonicProbabilityA(0.5, 1, 0.75) - 3 / 7) < 1e-12, "spec example: 43%");
  fc.assert(fc.property(unit, unit, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 1e-3, max: 1e3, noNaN: true }), (p, q, t1, t2, k) => {
      const a = Math.min(p, q), b = Math.max(p, q);
      fc.pre(b - a > 1e-6);
      assert.ok(Math.abs(pseudoHarmonicProbabilityA(a, b, a) - 1) < 1e-9);
      assert.ok(Math.abs(pseudoHarmonicProbabilityA(a, b, b)) < 1e-9);
      const x1 = a + Math.min(t1, t2) * (b - a), x2 = a + Math.max(t1, t2) * (b - a);
      const f1 = pseudoHarmonicProbabilityA(a, b, x1), f2 = pseudoHarmonicProbabilityA(a, b, x2);
      assert.ok(f1 >= f2 - 1e-12 && f1 <= 1 + 1e-12 && f2 >= -1e-12);
      const pot = 550;
      const chips = pseudoHarmonicProbabilityChips(pot, a * pot, b * pot, x1 * pot);
      assert.ok(Math.abs(pseudoHarmonicProbabilityChips(k * pot, k * a * pot, k * b * pot, k * x1 * pot) - chips) < 1e-9);
    }));
  assert.throws(() => pseudoHarmonicProbabilityA(1, 0.5, 0.75), /A < B/);
  assert.throws(() => pseudoHarmonicProbabilityA(0.5, 1, 1.2), /outside/);
});
