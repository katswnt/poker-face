import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { initialPublicState, applyPublicEvent, actionToken } from "../src/lib/hu-play/public-state";
import { rangeFromBridge } from "../src/lib/hu-play/reach";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import type { BridgeAction, BridgeExplicitNode, BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { mathProjection } from "../scripts/hu-play-wide-measurement";
import { gradeBridgeTurn } from "../src/lib/solver/bridge/turn-referee";
import { firstStreetProjection } from "../scripts/hu-play-p1-corpus";
import { RIVER_DECK } from "../src/lib/solver/river/cards";
import { buildLeanRiverTree } from "../src/lib/hu-play/river-menu";

function request(): HumanModelRequest {
  const s = buildBridgeFixture("referee-river-v3-demo");
  let p = initialPublicState({ startingPot: 100, startingStack: 1800, minimumBet: 1, flop: s.board.flop });
  p = applyPublicEvent(p, { kind: "action", player: 0, action: { type: "check" } });
  p = applyPublicEvent(p, { kind: "action", player: 1, action: { type: "check" } });
  p = applyPublicEvent(p, { kind: "card", street: "turn", card: s.board.turn! });
  return { publicState: p, aiSeat: 1, ranges: { ai: rangeFromBridge(s.ranges[1]), human: rangeFromBridge(s.ranges[0]) } };
}

test("P3 adds the actual turn action only at its parent and preserves chips, chance and full arriving ranges", async () => {
  assert.ok(existsSync("src/lib/hu-play/turn-tree.ts"), "P3 public-only turn builder required");
  const { buildNestedTurnSpot, buildLeanTurnTree } = await import("../src/lib/hu-play/turn-tree");
  const q = request(), actual: BridgeAction = { type: "bet", to: 37 };
  const s = buildNestedTurnSpot(q, actual), lean = buildLeanTurnTree(q.publicState);
  assert.equal(s.tree.mode, "turn-subgame-v1");
  if (s.tree.mode !== "turn-subgame-v1" || s.tree.root.kind !== "player" || lean.kind !== "player") throw new Error("wrong tree");
  assert.equal(s.board.river, null); assert.equal(s.solve.exportScope, "first-street");
  assert.equal(s.tree.prefixLength, 0);
  assert.deepEqual(s.tree.root.actions.map(a => actionToken(a.action)), ["x", "b37", "b66"]);
  for (const edge of lean.actions) assert.deepEqual(s.tree.root.actions.find(a => actionToken(a.action) === actionToken(edge.action)), edge);
  assert.ok(JSON.stringify(s.tree).includes('"chance"'));
  const after = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action: { type: "bet", to: 66 } }),
    aiSeat: 0 as const, ranges: { ai: q.ranges.human, human: q.ranges.ai } };
  const nested = buildNestedTurnSpot(after, { type: "raise", to: 137 });
  assert.equal(nested.startingPot, 100); assert.equal(nested.effectiveStack, 1800);
  if (nested.tree.mode !== "turn-subgame-v1" || nested.tree.root.kind !== "player") throw new Error("wrong tree");
  assert.equal(nested.tree.prefixLength, 1);
  assert.deepEqual(nested.tree.root.actions.map(e => e.action), [{ type: "bet", to: 66 }]);
  assert.deepEqual(nested.ranges.map(r => r.combos.length), [q.ranges.human.entries.length, q.ranges.ai.entries.length]);
  assert.throws(() => buildNestedTurnSpot({ ...after, humanHand: "AsKs" } as HumanModelRequest, { type: "raise", to: 137 }), /unexpected|public/i);
  assert.throws(() => buildNestedTurnSpot(after, { type: "raise", to: 131 }), /minimum|illegal/i);
  assert.throws(() => buildNestedTurnSpot(q, { type: "bet", to: 66 }), /on.tree/i);
});

test("P3 translated response embeds the real turn price; an all-in never admits a raise", async () => {
  assert.ok(existsSync("src/lib/hu-play/turn-tree.ts"), "P3 public-only turn builder required");
  const { buildTurnResponseSpot } = await import("../src/lib/hu-play/turn-tree");
  const q = request(), p = applyPublicEvent(q.publicState, { kind: "action", player: 0, action: { type: "bet", to: 1800 } });
  const s = buildTurnResponseSpot({ ...q, publicState: p });
  if (s.tree.mode !== "turn-subgame-v1" || s.tree.root.kind !== "player") throw new Error("wrong tree");
  assert.equal(s.tree.prefixLength, 1);
  assert.deepEqual(s.tree.root.actions[0].action, { type: "bet", to: 1800 });
  const n = s.tree.root.actions[0].next; assert.equal(n.kind, "player");
  if (n.kind !== "player") throw new Error("response");
  assert.deepEqual(n.actions.map(e => e.action), [{ type: "fold" }, { type: "call" }]);
  assert.deepEqual(n.actions[1].next, { kind: "terminal", outcome: "showdown" });
  assert.throws(() => buildTurnResponseSpot(q), /response/);
});

function structure(r: BridgeResultV1, id = 0): BridgeExplicitNode {
  const n = r.tree[id];
  if (n.kind === "terminal") return { kind: "terminal", outcome: n.outcome };
  if (n.kind === "chance") {
    assert.equal(n.truncated, false); assert.ok(n.children.length);
    const next = structure(r, n.children[0].child);
    for (const child of n.children.slice(1)) assert.deepEqual(structure(r, child.child), next, "Future betting menu cannot depend on the representative river");
    return { kind: "chance", next };
  }
  return { kind: "player", player: n.player, actions: n.actions.map(e => ({ action: e.action, next: structure(r, e.child) })) };
}

test("P3 structural river witness never changes a continuation for any of the 48 public river cards", async () => {
  const { buildLeanTurnTree } = await import("../src/lib/hu-play/turn-tree");
  const q = request();
  const walk = (n: BridgeExplicitNode, p: HumanModelRequest["publicState"]) => {
    if (n.kind === "terminal") return;
    if (n.kind === "chance") {
      for (const card of RIVER_DECK.filter(c => !p.board.flop.includes(c) && c !== p.board.turn)) {
        assert.deepEqual(n.next, buildLeanRiverTree(applyPublicEvent(p, { kind: "card", street: "river", card })));
      }
      return;
    }
    for (const e of n.actions) walk(e.next, applyPublicEvent(p, { kind: "action", player: n.player, action: e.action }));
  };
  walk(buildLeanTurnTree(q.publicState), q.publicState);
});

test("P3 lean explicit turn/river menu matches the native tree at deep, shallow, rounding and short all-in boundaries", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  const { buildLeanTurnTree } = await import("../src/lib/hu-play/turn-tree");
  for (const [pot, stack] of [[100, 1800], [102, 57], [100, 25], [550, 9750], [1088, 231], [222, 300]]) {
    const q = request();
    let p = initialPublicState({ startingPot: pot, startingStack: stack, minimumBet: 1, flop: q.publicState.flop });
    for (const event of q.publicState.events) p = applyPublicEvent(p, event);
    const s = buildPlaySpot({ ...q, publicState: p });
    const { result } = await runBridgeSpot({ ...s, solve: { ...s.solve, maxIterations: 1, exportScope: "full" } }, { threads: 1 });
    assert.deepEqual(buildLeanTurnTree(p), structure(result), `${pot}/${stack}`);
  }
});

test("P3 nested native/WASM parity and independent complete turn grades preserve prefix and first-street export", {
  skip: existsSync(BRIDGE_BINARY) && existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "native + WASM builds required",
}, async () => {
  const { buildNestedTurnSpot } = await import("../src/lib/hu-play/turn-tree");
  const { bindings } = await loadWasm(), fixture = buildBridgeFixture("referee-turn-v2-dry-value");
  let root = initialPublicState({ startingPot: 100, startingStack: 1800, minimumBet: 1, flop: fixture.board.flop });
  root = applyPublicEvent(root, { kind: "action", player: 0, action: { type: "check" } });
  root = applyPublicEvent(root, { kind: "action", player: 1, action: { type: "check" } });
  root = applyPublicEvent(root, { kind: "card", street: "turn", card: fixture.board.turn! });
  const cases: [BridgeAction[], BridgeAction][] = [
    [[], { type: "bet", to: 37 }], [[{ type: "check" }], { type: "bet", to: 1800 }],
    [[{ type: "bet", to: 66 }], { type: "raise", to: 137 }],
    [[{ type: "bet", to: 66 }, { type: "raise", to: 205 }], { type: "raise", to: 400 }],
  ];
  for (const [prefix, actual] of cases) {
    let p = root;
    for (const action of prefix) p = applyPublicEvent(p, { kind: "action", player: p.toAct!, action });
    const aiSeat = (1 - p.toAct!) as 0 | 1;
    const q = { publicState: p, aiSeat, ranges: { ai: rangeFromBridge(fixture.ranges[aiSeat]), human: rangeFromBridge(fixture.ranges[1 - aiSeat]) } };
    const partial = buildNestedTurnSpot(q, actual), full = { ...partial, solve: { ...partial.solve, exportScope: "full" as const } };
    const { result: native } = await runBridgeSpot(full, { threads: 1 });
    const wasm = runWasmSpot(bindings, full), first = runWasmSpot(bindings, partial);
    assert.deepEqual(mathProjection(wasm), mathProjection(native));
    assert.deepEqual(firstStreetProjection(first), firstStreetProjection(native));
    const vector = gradeBridgeTurn(full, native), naive = gradeBridgeTurn(full, native, "naive");
    assert.ok(vector.exploitabilityPctPot <= .3);
    assert.ok(Math.abs(vector.exploitability - native.exploitability.chips) <= 2e-4);
    assert.ok(Math.abs(vector.exploitability - naive.exploitability) < 1e-9);
    assert.throws(() => gradeBridgeTurn(partial, first), /complete export/);
    let id = 0;
    for (const action of prefix) {
      const n = native.tree[id]; if (n.kind !== "player") throw new Error("prefix");
      assert.deepEqual(n.actions.map(e => e.action), [action]); assert.ok(n.strategy[0].every(v => v === 1)); id = n.actions[0].child;
    }
    assert.deepEqual(native.tree[id].committed, p.streetPut);
  }
});
