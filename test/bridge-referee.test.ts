import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { BRIDGE_FLOAT32_TOLERANCE_CHIPS, refereeGates, refereeRangeMismatches, refereeWalk } from "../src/lib/solver/bridge/referee";
import {
  ISOMORPHISM_PROBE_REQUEST, REFEREE_GAMES, isomorphismProbeSpot, turnV2RefereeEngine,
} from "../src/lib/solver/bridge/referee-node";

// Needs the native binary (npm run build:bridge); the CI bridge job builds it first.
const skip = existsSync(BRIDGE_BINARY) ? false : "solver-bridge binary not built";
// Deliberately untyped: corruption tests write shapes the result type forbids.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const clone = <T>(value: T): T => structuredClone(value);
const game = (id: string) => REFEREE_GAMES.find(g => g.id === id)!;
const results = new Map<string, Promise<BridgeResultV1>>();
const solved = (id: string) => {
  if (!results.has(id)) results.set(id, runBridgeSpot(buildBridgeFixture(id as Parameters<typeof buildBridgeFixture>[0])).then(run => run.result));
  return results.get(id)!;
};

test("each referee spot hands postflop-solver exactly our engine's ranges", () => {
  for (const referee of REFEREE_GAMES) assert.deepEqual(refereeRangeMismatches(referee.engine(), buildBridgeFixture(referee.id)), [], referee.id);
});

test("the bridge's exported tree equals our engine's public tree for every referee game", { skip }, async () => {
  for (const referee of REFEREE_GAMES) {
    const walk = refereeWalk(referee.engine(), await solved(referee.id));
    assert.deepEqual(walk.mismatches, [], referee.id);
    assert.ok(walk.policy.size > 0 && walk.stats.maximumStrategySumError < 1e-5, referee.id);
  }
});

test("referee gates pass on the river game and use our grader, not the self-report", { skip }, async () => {
  const referee = game("referee-river-v3-demo"), result = await solved(referee.id), engine = referee.engine();
  const ours = engine.grade(refereeWalk(engine, result).policy);
  assert.equal(ours.grader, "gradeFactorizedRiverStrategy");
  const gates = refereeGates(result, ours, BRIDGE_FLOAT32_TOLERANCE_CHIPS, referee.bounds);
  assert.deepEqual(gates.failures, []);
  // A self-report that is off by more than the tolerance fails gate (a) even though the strategy is fine.
  const lying = clone(result) as Loose;
  lying.exploitability.chips += 2 * BRIDGE_FLOAT32_TOLERANCE_CHIPS;
  assert.match(refereeGates(lying, ours, BRIDGE_FLOAT32_TOLERANCE_CHIPS, referee.bounds).failures.join(), /\(a\) self-reported exploitability/);
  const shifted = clone(result) as Loose;
  shifted.root.ev[0] = shifted.root.ev[0].map((v: number) => v + 0.01);
  assert.match(refereeGates(shifted, ours, BRIDGE_FLOAT32_TOLERANCE_CHIPS, referee.bounds).failures.join(), /\(b\) self-reported value/);
});

test("a corrupted exported tree fails with a precise path", { skip }, async () => {
  const referee = game("referee-river-v3-demo"), result = await solved(referee.id), engine = referee.engine();
  const mismatch = (mutate: (tree: Loose[]) => void) => {
    const copy = clone(result) as Loose; mutate(copy.tree);
    return refereeWalk(engine, copy).mismatches.join("\n");
  };
  const root = result.tree[0] as Loose;
  const betChild = root.actions[1].child, betLabel = `${root.actions[1].action.type}${root.actions[1].action.to}`;
  assert.match(mismatch(tree => { tree[0].actions[1].action.to += 1; }), /^root: actions \[check, bet51, bet100, bet200\] ≠ ours \[check, bet50, bet100, bet200\]/);
  assert.match(mismatch(tree => { tree[betChild].player = 0; }), new RegExp(`^root/${betLabel}: actor 0 ≠ ours 1`));
  assert.match(mismatch(tree => { tree[betChild].actions.pop(); tree[betChild].strategy.pop(); }), new RegExp(`^root/${betLabel}: actions`));
  const fold = result.tree.findIndex(node => node.kind === "terminal" && node.outcome === "fold");
  assert.match(mismatch(tree => { tree[fold].folder = 1 - tree[fold].folder; }), /terminal fold\/\d ≠ ours fold\/\d/);
  assert.match(mismatch(tree => { tree[fold].committed = [0, 0]; }), /committed \[0, 0\] ≠ ours/);
  assert.match(mismatch(tree => { tree[0].strategy.forEach((row: Loose[]) => { row[3] = null; }); }), /^root: bridge has no strategy for/);
  assert.match(mismatch(tree => { tree[0].strategy[0][0] += 0.01; }), /^root: strategy for .* sums to/);
});

test("a corrupted exported strategy is caught by our independent grade", { skip }, async () => {
  const referee = game("referee-river-v3-demo"), result = await solved(referee.id), engine = referee.engine();
  // Every player-0 hand checks at the root: a legal profile, but not the one postflop-solver reports.
  const copy = clone(result) as Loose;
  copy.tree[0].strategy = copy.tree[0].strategy.map((row: number[], a: number) => row.map(() => (a === 0 ? 1 : 0)));
  const walk = refereeWalk(engine, copy);
  assert.deepEqual(walk.mismatches, []);
  const gates = refereeGates(copy, engine.grade(walk.policy), BRIDGE_FLOAT32_TOLERANCE_CHIPS, referee.bounds);
  assert.match(gates.failures.join("\n"), /\(a\) self-reported exploitability/);
  assert.match(gates.failures.join("\n"), /\(b\) self-reported value/);
});

test("turn chance nodes: every real card must be dealt or provably impossible", { skip }, async () => {
  const referee = game("referee-turn-v2-dry-value"), result = await solved(referee.id), engine = referee.engine();
  const chance = result.tree.findIndex(node => node.kind === "chance");
  const mismatch = (mutate: (node: Loose) => void) => {
    const copy = clone(result) as Loose; mutate(copy.tree[chance]);
    return refereeWalk(engine, copy).mismatches.join("\n");
  };
  assert.match(mismatch(node => { node.children.pop(); }), /our card \w\w is neither dealt nor listed impossible/);
  assert.match(mismatch(node => { node.impossibleCards.push(node.children.pop().card); }), /bridge never deals \w\w, but our engine has a live private pair/);
  assert.match(mismatch(node => { const [a, b] = node.children; [a.card, b.card] = [b.card, a.card]; }), /board .* ≠ ours/);
  assert.match(mismatch(node => { node.truncated = true; }), /truncated/);
});

test("suit-isomorphic cards: swapped subtrees map to the real hands (probe game)", { skip }, async () => {
  const spot = isomorphismProbeSpot(), engine = turnV2RefereeEngine(ISOMORPHISM_PROBE_REQUEST);
  assert.deepEqual(refereeRangeMismatches(engine, spot), []);
  const { result } = await runBridgeSpot(spot);
  const walk = refereeWalk(engine, result);
  assert.deepEqual(walk.mismatches, []);
  assert.ok(walk.stats.nonRepresentativeChildren > 0, "probe must exercise suit swaps");
  const ours = engine.grade(walk.policy);
  assert.deepEqual(refereeGates(result, ours, BRIDGE_FLOAT32_TOLERANCE_CHIPS, null).failures, []);

  // Undo the swap inside non-representative subtrees (what a missing card permutation would
  // export): each hand gets its clubs↔diamonds image's strategy. Our grade must notice.
  const swap = (combo: string) => combo.replace(/[cd]/g, s => (s === "c" ? "d" : "c"));
  const index = result.hands.map(hands => new Map(hands.map((combo, h) => [combo, h])));
  const partner = result.hands.map((hands, p) => hands.map(combo => {
    const cards = [swap(combo.slice(0, 2)), swap(combo.slice(2))];
    return index[p].get(cards.join("")) ?? index[p].get(`${cards[1]}${cards[0]}`)!;
  }));
  const copy = clone(result) as Loose;
  const permute = (id: number): void => {
    const node = copy.tree[id];
    if (node.kind === "player") {
      // Only between two live hands (a blocked partner would be caught earlier, as a null strategy).
      const live = (h: number) => node.strategy[0][h] !== null && node.strategy[0][partner[node.player][h]] !== null;
      node.strategy = node.strategy.map((row: number[]) => row.map((p, h) => (live(h) ? row[partner[node.player][h]] : p)));
      node.actions.forEach((a: Loose) => permute(a.child));
    }
  };
  for (const node of copy.tree) if (node.kind === "chance") for (const child of node.children) if (!child.representative) permute(child.child);
  const corrupted = refereeWalk(engine, copy);
  assert.deepEqual(corrupted.mismatches, []);
  // Measured: exploitability 0.0094 → 0.115 chips, value off by 0.011 (tolerance 2e-4).
  const failures = refereeGates(copy, engine.grade(corrupted.policy), BRIDGE_FLOAT32_TOLERANCE_CHIPS, null).failures.join("\n");
  assert.match(failures, /\(a\) self-reported exploitability/);
  assert.match(failures, /\(b\) self-reported value/);
});
