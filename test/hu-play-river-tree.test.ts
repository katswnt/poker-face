import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { initialPublicState, applyPublicEvent, actionToken } from "../src/lib/hu-play/public-state";
import { rangeFromBridge } from "../src/lib/hu-play/reach";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import type { BridgeAction, BridgeExplicitNode, BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { runBridgeSpot, BRIDGE_BINARY } from "../scripts/bridge-runner";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { mathProjection } from "../scripts/hu-play-wide-measurement";
import { gradeRiverHands } from "../src/lib/solver/bridge/river-hand-values";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";

function request(pot = 100, stack = 1800): HumanModelRequest {
  const s = buildBridgeFixture("referee-river-v3-demo");
  let p = initialPublicState({ startingPot: pot, startingStack: stack, minimumBet: 1, flop: s.board.flop });
  for (const [street, card] of [["turn", s.board.turn!], ["river", s.board.river!]] as const) {
    p = applyPublicEvent(p, { kind: "action", player: 0, action: { type: "check" } });
    p = applyPublicEvent(p, { kind: "action", player: 1, action: { type: "check" } });
    p = applyPublicEvent(p, { kind: "card", street, card });
  }
  return { publicState: p, aiSeat: 1, ranges: { ai: rangeFromBridge(s.ranges[1]), human: rangeFromBridge(s.ranges[0]) } };
}
function structure(r: BridgeResultV1, id = 0): BridgeExplicitNode {
  const n = r.tree[id];
  if (n.kind === "terminal") return { kind: "terminal", outcome: n.outcome };
  if (n.kind !== "player") throw new Error("river only");
  return { kind: "player", player: n.player, actions: n.actions.map(a => ({ action: a.action, next: structure(r, a.child) })) };
}

test("P2 lean river explicit tree exactly matches the native menu including rounding, raise cap and short all-ins", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/river-tree.ts"), "P2 explicit river builder required");
  const { buildLeanRiverTree } = await import("../src/lib/hu-play/river-tree");
  for (const [pot, stack] of [[100, 1800], [102, 57], [100, 25], [550, 9750], [1088, 231], [222, 300]]) {
    const q = request(pot, stack), base = buildPlaySpot(q);
    const { result } = await runBridgeSpot({ ...base, solve: { ...base.solve, maxIterations: 1 } }, { threads: 1 });
    assert.deepEqual(buildLeanRiverTree(q.publicState), structure(result), `${pot}/${stack}`);
  }
});

test("prepared river sources expose only a detached public blueprint for measured fallback and BR comparison", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  const { bindings } = await loadWasm(), q = request();
  const source = new ResolvedPolicySource(async spot => runWasmSpot(bindings, spot));
  await source.prepare(q);
  assert.equal(typeof source.publicTree, "function", "P2 needs a public-only prepared-tree snapshot");
  const snapshot = source.publicTree(q);
  assert.equal(snapshot.parentNode, 0); assert.deepEqual(snapshot.rootRequest, q);
  assert.ok(!/humanHand|aiHand|runout/.test(JSON.stringify(snapshot)));
  assert.throws(() => source.publicTree({ ...q, humanHand: "AsKs" } as HumanModelRequest), /unexpected|public/i);
  const n = snapshot.result.tree[0]; if (n.kind !== "player") throw new Error("root");
  Object.assign(n.strategy[0], { 0: 1234 });
  const clean = source.publicTree(q).result.tree[0];
  assert.ok(clean.kind === "player" && clean.strategy[0][0]! <= 1);
});

test("nested river embedding has exact native/WASM parity at root, after check, facing a bet and facing a raise", {
  skip: existsSync(BRIDGE_BINARY) && existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "native + WASM builds required",
}, async () => {
  const { buildNestedRiverSpot } = await import("../src/lib/hu-play/river-tree");
  const { bindings } = await loadWasm(), base = request();
  const scenarios: [BridgeAction[], BridgeAction][] = [
    [[], { type: "bet", to: 37 }],
    [[{ type: "check" }], { type: "bet", to: 1800 }],
    [[{ type: "bet", to: 50 }], { type: "raise", to: 137 }],
    [[{ type: "bet", to: 50 }, { type: "raise", to: 170 }], { type: "raise", to: 400 }],
  ];
  for (const [prefix, actual] of scenarios) {
    let p = base.publicState;
    for (const action of prefix) p = applyPublicEvent(p, { kind: "action", player: p.toAct!, action });
    const aiSeat = (1 - p.toAct!) as 0 | 1;
    const q = { publicState: p, aiSeat, ranges: aiSeat === base.aiSeat ? base.ranges : { ai: base.ranges.human, human: base.ranges.ai } };
    const spot = buildNestedRiverSpot(q, actual), { result: native } = await runBridgeSpot(spot, { threads: 1 });
    const wasm = runWasmSpot(bindings, spot);
    assert.deepEqual(mathProjection(wasm), mathProjection(native));
    assert.ok(gradeRiverHands(spot, native).exploitabilityPctPot <= .3);
    let id = 0;
    for (const action of prefix) {
      const n = native.tree[id]; if (n.kind !== "player") throw new Error("Not a forced player");
      assert.equal(n.actions.length, 1); assert.deepEqual(n.actions[0].action, action);
      assert.ok(n.strategy[0].every(v => v === 1)); id = n.actions[0].child;
    }
    assert.deepEqual(native.tree[id].committed, p.streetPut);
  }
});

test("P2 adds the actual action at one parent only, keeps chip prefix and every positive arriving hand", async () => {
  assert.ok(existsSync("src/lib/hu-play/river-tree.ts"));
  const { buildNestedRiverSpot, buildLeanRiverTree } = await import("../src/lib/hu-play/river-tree");
  const base = request(), bet: BridgeAction = { type: "bet", to: 37 };
  const s = buildNestedRiverSpot(base, bet);
  assert.equal(s.tree.mode, "river-subgame-v1");
  if (s.tree.mode !== "river-subgame-v1" || s.tree.root.kind !== "player") throw new Error("wrong tree");
  assert.equal(s.tree.prefixLength, 0);
  assert.deepEqual(s.tree.root.actions.map(a => actionToken(a.action)), ["x", "b37", "b50", "b100"]);
  const lean = buildLeanRiverTree(base.publicState);
  if (lean.kind !== "player") throw new Error("wrong tree");
  for (const edge of lean.actions) assert.deepEqual(s.tree.root.actions.find(a => actionToken(a.action) === actionToken(edge.action)), edge);
  const after = { ...base, publicState: applyPublicEvent(base.publicState, { kind: "action", player: 0, action: { type: "bet", to: 50 } }), aiSeat: 0 as const,
    ranges: { ai: base.ranges.human, human: base.ranges.ai } };
  const nested = buildNestedRiverSpot(after, { type: "raise", to: 137 });
  assert.equal(nested.startingPot, 100); assert.equal(nested.effectiveStack, 1800);
  assert.equal(nested.tree.mode, "river-subgame-v1");
  if (nested.tree.mode !== "river-subgame-v1" || nested.tree.root.kind !== "player") throw new Error("wrong tree");
  assert.equal(nested.tree.prefixLength, 1);
  assert.deepEqual(nested.tree.root.actions.map(e => e.action), [{ type: "bet", to: 50 }]);
  assert.deepEqual(nested.ranges.map(r => r.combos.length), [base.ranges.human.entries.length, base.ranges.ai.entries.length]);
  assert.throws(() => buildNestedRiverSpot({ ...after, humanHand: "AsKs" } as HumanModelRequest, { type: "raise", to: 137 }), /unexpected|public/i);
  assert.throws(() => buildNestedRiverSpot(after, { type: "raise", to: 99 }), /minimum|illegal/i);
  assert.throws(() => buildNestedRiverSpot(base, { type: "bet", to: 50 }), /on.tree/i);
});
