import assert from "node:assert/strict";
import test from "node:test";
import { validateBridgeSpot, type BridgeExplicitNode } from "../src/lib/solver/bridge/contract";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";

const terminal = (outcome: "fold" | "showdown"): BridgeExplicitNode => ({ kind: "terminal", outcome });
const response: BridgeExplicitNode = { kind: "player", player: 1, actions: [
  { action: { type: "fold" }, next: terminal("fold") },
  { action: { type: "call" }, next: terminal("showdown") },
] };
const root: BridgeExplicitNode = { kind: "player", player: 0, actions: [
  { action: { type: "bet", to: 50 }, next: response },
] };
function spot() {
  return { ...buildBridgeFixture("referee-river-v3-demo"), effectiveStack: 100,
    tree: { mode: "river-subgame-v1", prefixLength: 1, root } };
}

test("versioned river subgame preserves a forced public prefix without relaxing ordinary explicit trees", () => {
  assert.deepEqual(validateBridgeSpot(spot()).tree, spot().tree);
  assert.throws(() => validateBridgeSpot({ ...spot(), tree: { mode: "explicit", root } }), /offer check/);
  assert.throws(() => validateBridgeSpot({ ...spot(), tree: { ...spot().tree, prefixLength: 0 } }), /offer check/);
  assert.throws(() => validateBridgeSpot({ ...spot(), board: { ...spot().board, river: null } }), /river/i);
  for (const n of [-1, .5, 9]) assert.throws(() => validateBridgeSpot({ ...spot(), tree: { ...spot().tree, prefixLength: n } }), /prefix/i);
  assert.throws(() => validateBridgeSpot({ ...spot(), tree: { ...spot().tree, prefixLength: 2 } }), /single|one action/i);
  assert.throws(() => validateBridgeSpot({ ...spot(), tree: { ...spot().tree, holeCards: "AsAh" } }), /unknown fields/);
});

test("forced prefix cannot end the hand, hide alternatives below the parent, exceed the stack or violate turn order", () => {
  const cases: BridgeExplicitNode[] = [
    { kind: "player", player: 1, actions: [{ action: { type: "bet", to: 50 }, next: response }] },
    { kind: "player", player: 0, actions: [{ action: { type: "bet", to: 101 }, next: response }] },
    { kind: "player", player: 0, actions: [{ action: { type: "bet", to: 50 }, next: {
      kind: "player", player: 1, actions: [{ action: { type: "call" }, next: terminal("showdown") }],
    } }] },
  ];
  for (const bad of cases) assert.throws(() => validateBridgeSpot({ ...spot(), tree: { ...spot().tree, root: bad } }));
  const ends = { kind: "player", player: 0, actions: [{ action: { type: "check" }, next: {
    kind: "player", player: 1, actions: [{ action: { type: "check" }, next: terminal("showdown") }],
  } }] };
  assert.throws(() => validateBridgeSpot({ ...spot(), tree: { ...spot().tree, prefixLength: 2, root: ends } }), /decision|end|terminal/i);
});
