import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BRIDGE_SPOT_FORMAT, buildExplicitTree, explicitTreeStats, validateBridgeSpot,
  type BridgeExplicitNode, type BridgeSpotV1,
} from "../src/lib/solver/bridge/contract";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import {
  BENCHMARK_RANGE_SOURCE, BRIDGE_BENCHMARK_ID, BRIDGE_FIXTURE_HASHES, BRIDGE_REFEREE_IDS, bridgeFixtureIds,
  buildBridgeFixture,
} from "../src/lib/solver/bridge/fixtures";
import { configurableRiverV3DemoGame } from "../src/lib/solver/river/configurable-v3/fixture";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const terminal = (outcome: "fold" | "showdown"): BridgeExplicitNode => ({ kind: "terminal", outcome });
const checkDown: BridgeExplicitNode = { kind: "player", player: 0, actions: [
  { action: { type: "check" }, next: { kind: "player", player: 1, actions: [{ action: { type: "check" }, next: terminal("showdown") }] } },
] };
function riverSpot(root: BridgeExplicitNode = checkDown): BridgeSpotV1 {
  return {
    format: BRIDGE_SPOT_FORMAT, version: 1, id: "test-river", board: { flop: ["Kd", "8c", "4h"], turn: "2s", river: "9d" },
    ranges: [{ source: "test", combos: [{ combo: "AhAc", weight: 1 }, { combo: "AsAh", weight: 0.5 }] },
      { source: "test", combos: [{ combo: "3h3c", weight: 1 }] }],
    startingPot: 100, effectiveStack: 50, rake: 0, tree: { mode: "explicit", root },
    solve: { targetExploitabilityPctPot: 0.1, maxIterations: 100, memoryCapBytes: 1 << 20, timeoutMs: 1000,
      compression: "off", exportScope: "full" },
  };
}
// Deliberately untyped: these tests build malformed spots the types would forbid.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const rejects = (mutate: (spot: Loose) => void, pattern: RegExp) => {
  const spot: Loose = clone(riverSpot());
  mutate(spot);
  assert.throws(() => validateBridgeSpot(spot), pattern);
};

test("bridge fixtures validate and match their committed hashes", () => {
  for (const id of bridgeFixtureIds()) {
    const spot = buildBridgeFixture(id);
    assert.equal(hashBridgeSpot(spot), BRIDGE_FIXTURE_HASHES[id], `${id} changed; re-lock only with a documented reason`);
    assert.deepEqual(validateBridgeSpot(JSON.parse(canonicalBridgeSpotJson(spot))), spot);
  }
  for (const id of BRIDGE_REFEREE_IDS) assert.equal(buildBridgeFixture(id).tree.mode, "explicit");
  const benchmark = buildBridgeFixture(BRIDGE_BENCHMARK_ID);
  assert.ok(benchmark.ranges.every(range => range.source.includes("hand-written approximations, not solved")));
  assert.match(BENCHMARK_RANGE_SOURCE, /not solved/);
  assert.equal(benchmark.startingPot, 550); assert.equal(benchmark.effectiveStack, 9750);
  assert.equal(benchmark.solve.targetExploitabilityPctPot, 0.3);
});

test("the river referee tree is exactly the v3 engine's public tree", () => {
  const spot = buildBridgeFixture("referee-river-v3-demo");
  assert.equal(spot.tree.mode, "explicit");
  const stats = explicitTreeStats(spot.tree as Extract<BridgeSpotV1["tree"], { mode: "explicit" }>);
  const preflight = configurableRiverV3DemoGame.preflight;
  assert.equal(stats.players, preflight.publicDecisionStatesPerDeal);
  assert.equal(stats.terminals, preflight.publicTerminalStatesPerDeal);
  assert.equal(stats.chances, 0);
  assert.equal(spot.ranges[0].combos.length, configurableRiverV3DemoGame.scenario.ranges[0].length);
});

test("spot hashes are canonical: key order is irrelevant, content is not", () => {
  const spot = riverSpot(), hash = hashBridgeSpot(spot);
  const reversed = (value: unknown): unknown => Array.isArray(value) ? value.map(reversed)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)])) : value;
  assert.equal(hashBridgeSpot(reversed(spot) as BridgeSpotV1), hash);
  assert.equal(hash, hashBridgeSpot(riverSpot()));
  assert.notEqual(hashBridgeSpot({ ...spot, startingPot: 101 }), hash);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("validation rejects overlapping cards, bad ranges and non-integer chips", () => {
  rejects(s => { s.board.river = "Kd"; }, /repeats a card/);
  rejects(s => { s.board.turn = null; }, /river requires board.turn/);
  rejects(s => { s.ranges[0].combos[0].combo = "Kd2c"; }, /overlaps the board|not canonical/);
  rejects(s => { s.ranges[0].combos[0].combo = "AcAh"; }, /not canonical/);
  rejects(s => { s.ranges[0].combos.reverse(); }, /unique and sorted/);
  rejects(s => { s.ranges[1].combos.length = 0; }, /is empty/);
  rejects(s => { s.ranges[1].combos[0].weight = 0; }, /weight/);
  rejects(s => { s.ranges[1].combos[0].weight = 0.1; }, /float32/);
  rejects(s => { s.ranges[1].combos[0].weight = 2; }, /weight/);
  rejects(s => { s.ranges[1].combos = [{ combo: "AhAc", weight: 1 }]; s.ranges[0].combos = [{ combo: "AhAc", weight: 1 }]; }, /non-overlapping/);
  rejects(s => { s.startingPot = 100.5; }, /whole number/);
  rejects(s => { s.effectiveStack = 0; }, /whole number/);
  rejects(s => { s.rake = 0.05; }, /rake/);
  rejects(s => { s.extra = true; }, /unknown fields extra/);
  rejects(s => { s.solve.compression = "maybe"; }, /compression/);
  rejects(s => { s.solve.maxIterations = 1.5; }, /maxIterations/);
});

test("validation rejects explicit trees that break the betting rules or do not close", () => {
  const player = (p: 0 | 1, actions: { action: object; next: BridgeExplicitNode }[]) => ({ kind: "player", player: p, actions }) as BridgeExplicitNode;
  const facing = (p: 0 | 1, extra: { action: object; next: BridgeExplicitNode }[] = []) =>
    player(p, [{ action: { type: "fold" }, next: terminal("fold") }, { action: { type: "call" }, next: terminal("showdown") }, ...extra]);
  const withBet = (to: number, answer: BridgeExplicitNode) => player(0, [
    { action: { type: "check" }, next: player(1, [{ action: { type: "check" }, next: terminal("showdown") }]) },
    { action: { type: "bet", to }, next: answer },
  ]);
  assert.doesNotThrow(() => validateBridgeSpot(riverSpot(withBet(50, facing(1)))));
  assert.doesNotThrow(() => validateBridgeSpot(riverSpot(withBet(20, facing(1, [{ action: { type: "raise", to: 50 }, next: facing(0) }])))));
  const invalid: [BridgeExplicitNode, RegExp][] = [
    [player(1, checkDown.kind === "player" ? [...checkDown.actions] : []), /player 0 to act/],
    [player(0, [{ action: { type: "check" }, next: terminal("showdown") }]), /must be a player node/],
    [withBet(51, facing(1)), /exceeds the all-in total/],
    [withBet(20, player(1, [{ action: { type: "call" }, next: terminal("showdown") }])), /fold and call/],
    [withBet(20, facing(1, [{ action: { type: "raise", to: 30 }, next: facing(0) }])), /minimum raise/],
    [withBet(50, facing(1, [{ action: { type: "raise", to: 50 }, next: facing(0) }])), /cannot raise an all-in/],
    [withBet(20, player(1, [{ action: { type: "call" }, next: terminal("showdown") }, { action: { type: "fold" }, next: terminal("fold") }])), /canonical order/],
    [withBet(20, facing(1, [{ action: { type: "raise", to: 40 }, next: terminal("showdown") }])), /must be a player node/],
    [player(0, [{ action: { type: "check" }, next: player(1, [{ action: { type: "check" }, next: terminal("fold") }]) }]), /must end in showdown/],
    [player(0, [{ action: { type: "bet", to: 10 }, next: facing(1) }]), /must offer check/],
    [player(0, [{ action: { type: "check" }, next: player(1, [{ action: { type: "check" }, next: terminal("showdown") }]) }, { action: { type: "shove" }, next: terminal("fold") }]), /unknown type/],
  ];
  for (const [root, pattern] of invalid) assert.throws(() => validateBridgeSpot(riverSpot(root)), pattern);
});

test("flop explicit trees need chance nodes between streets and showdown after an all-in call", () => {
  const board = { flop: ["Ks", "8s", "4d"] as const, turn: null, river: null };
  // One 25-chip bet per street with 50 behind: after a flop bet and call, the turn bet is
  // all-in, so its call ends in a showdown with no river chance node.
  const tree = buildExplicitTree(board, 50, (_history, view) => view.streetPut.some(x => x > 0)
    ? [{ type: "fold" }, { type: "call" }]
    : [{ type: "check" }, { type: "bet", to: 25 }]);
  const stats = explicitTreeStats(tree);
  assert.ok(stats.chances > 0);
  const spot = { ...riverSpot(), board, tree } as BridgeSpotV1;
  assert.doesNotThrow(() => validateBridgeSpot(spot));
  // Replacing the flop chance node with a player node is rejected.
  const broken: Loose = clone(tree);
  broken.root.actions[0].next.actions[0].next = terminal("showdown");
  assert.throws(() => validateBridgeSpot({ ...spot, tree: broken }), /must be a chance node/);
});

test("menu trees mirror TreeConfig and reject misplaced sizes", () => {
  const spot = clone(buildBridgeFixture("smoke-upstream-basic")) as BridgeSpotV1 & { tree: Record<string, unknown> };
  assert.doesNotThrow(() => validateBridgeSpot(spot));
  const menu = (mutate: (tree: Record<string, unknown>) => void, pattern: RegExp) => {
    const copy = clone(spot); mutate(copy.tree); assert.throws(() => validateBridgeSpot(copy), pattern);
  };
  menu(t => { t.flop = t.turn; }, /already dealt/);
  menu(t => { t.river = null; }, /tree.river must be an object/);
  menu(t => { (t.turn as { oop: { bet: unknown[] } }).oop.bet.push({ kind: "prevBet", multiple: 2 }); }, /only valid for raises/);
  menu(t => { (t.turn as { oop: { raise: unknown[] } }).oop.raise.push({ kind: "prevBet", multiple: 2.5 }); }, /repeats a size/);
  menu(t => { (t.turn as { ip: { bet: unknown[] } }).ip.bet[0] = { kind: "pot", pct: -5 }; }, /pct/);
  menu(t => { t.turnDonk = [{ kind: "pot", pct: 50 }]; }, /turnDonk must be null/);
  menu(t => { t.mergingThreshold = -1; }, /mergingThreshold/);
  menu(t => { t.maxRaisesPerStreet = 1.5; }, /maxRaisesPerStreet/);
  menu(t => { t.mode = "abstract"; }, /tree.mode/);
});
