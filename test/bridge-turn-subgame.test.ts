import assert from "node:assert/strict";
import test from "node:test";
import { validateBridgeSpot, type BridgeExplicitNode } from "../src/lib/solver/bridge/contract";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";

const terminal = (outcome: "fold" | "showdown"): BridgeExplicitNode => ({ kind: "terminal", outcome });
const checks: BridgeExplicitNode = { kind: "player", player: 0, actions: [
  { action: { type: "check" }, next: { kind: "player", player: 1, actions: [
    { action: { type: "check" }, next: terminal("showdown") },
  ] } },
] };
const response: BridgeExplicitNode = { kind: "player", player: 1, actions: [
  { action: { type: "fold" }, next: terminal("fold") },
  { action: { type: "call" }, next: { kind: "chance", next: checks } },
] };
function spot(root: BridgeExplicitNode = { kind: "player", player: 0, actions: [
  { action: { type: "bet", to: 50 }, next: response },
] }) {
  const base = buildBridgeFixture("referee-river-v3-demo");
  return { ...base, board: { ...base.board, river: null }, effectiveStack: 100,
    tree: { mode: "turn-subgame-v1", prefixLength: 1, root } };
}

test("turn-subgame-v1 keeps a continuing forced turn prefix and the unseen river chance", () => {
  assert.deepEqual(validateBridgeSpot(spot()).tree, spot().tree);
  assert.throws(() => validateBridgeSpot({ ...spot(), tree: { mode: "explicit", root: spot().tree.root } }), /offer check/);
  assert.throws(() => validateBridgeSpot({ ...spot(), tree: { ...spot().tree, prefixLength: 0 } }), /offer check/);
  for (const board of [{ ...spot().board, turn: null }, { ...spot().board, river: buildBridgeFixture("referee-river-v3-demo").board.river }]) {
    assert.throws(() => validateBridgeSpot({ ...spot(), board }), /known turn|undealt river/);
  }
  for (const prefixLength of [-1, .5, 9]) assert.throws(() => validateBridgeSpot({ ...spot(),
    tree: { ...spot().tree, prefixLength } }), /prefixLength/);
  assert.throws(() => validateBridgeSpot({ ...spot(), tree: { ...spot().tree, humanHand: "AsKs" } }), /unknown fields/);
  assert.throws(() => validateBridgeSpot({ ...spot(), tree: { ...spot().tree, mode: "river-subgame-v1" } }), /known river/);
});

test("turn subgame cannot omit/double chance, hide river alternatives, or force a street-ending action", () => {
  for (const next of [checks, terminal("showdown"), { kind: "chance", next: { kind: "chance", next: checks } } as BridgeExplicitNode]) {
    const root: BridgeExplicitNode = { kind: "player", player: 0, actions: [{ action: { type: "bet", to: 50 }, next: {
      kind: "player", player: 1, actions: [{ action: { type: "fold" }, next: terminal("fold") }, { action: { type: "call" }, next }],
    } }] };
    assert.throws(() => validateBridgeSpot(spot(root)), /chance|player/);
  }
  const closes: BridgeExplicitNode = { kind: "player", player: 0, actions: [{ action: { type: "check" }, next: {
    kind: "player", player: 1, actions: [{ action: { type: "check" }, next: { kind: "chance", next: checks } }],
  } }] };
  assert.throws(() => validateBridgeSpot({ ...spot(closes), tree: { ...spot(closes).tree, prefixLength: 2 } }), /continue.*decision/);
  const missing = structuredClone(spot());
  const root = missing.tree.root; assert.equal(root.kind, "player");
  if (root.kind !== "player" || root.actions[0].next.kind !== "player") throw new Error("shape");
  const call = root.actions[0].next.actions[1].next;
  if (call.kind !== "chance") throw new Error("chance");
  Object.assign(call, { next: { kind: "player", player: 0, actions: [{ action: { type: "bet", to: 50 }, next: {
    kind: "player", player: 1, actions: [{ action: { type: "fold" }, next: terminal("fold") }, { action: { type: "call" }, next: terminal("showdown") }],
  } }] } });
  assert.throws(() => validateBridgeSpot(missing), /offer check/);
});

test("turn all-in call runs out to showdown, never to an extra river decision", () => {
  const allIn = (next: BridgeExplicitNode) => spot({ kind: "player", player: 0, actions: [
    { action: { type: "bet", to: 100 }, next: { kind: "player", player: 1, actions: [
      { action: { type: "fold" }, next: terminal("fold") }, { action: { type: "call" }, next },
    ] } },
  ] });
  assert.doesNotThrow(() => validateBridgeSpot(allIn(terminal("showdown"))));
  assert.throws(() => validateBridgeSpot(allIn({ kind: "chance", next: checks })), /terminal/);
});
