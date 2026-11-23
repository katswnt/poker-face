import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { compareFreshFormationHashes } from "../scripts/reproduce-formation-libraries";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { BRIDGE_SLICE_PLAN_FORMAT, type BridgeSlicePlanV1 } from "../src/lib/solver/bridge/contract";
import { encodeFormationSpot } from "../src/lib/solver/bridge/formations/library";
import { FORMATION_INPUTS } from "../src/lib/solver/bridge/formations/fixtures";
import { prettyJson, sha256 } from "../src/lib/solver/preflop-v2/corpus";

test("fresh reproduction requires the original complete file hashes and iteration count", () => {
  const original = { dataHashes: { root: "a".repeat(64), flop: "b".repeat(64) }, iterations: 160 };
  compareFreshFormationHashes(structuredClone(original), original);
  for (const changed of [{ ...original, iterations: 170 }, { ...original, dataHashes: { root: original.dataHashes.root } },
    { ...original, dataHashes: { ...original.dataHashes, root: "c".repeat(64) } },
    { ...original, dataHashes: { ...original.dataHashes, extra: "d".repeat(64) } }])
    assert.throws(() => compareFreshFormationHashes(changed, original));
});

test("native cache key sorting must not replace the original exported-byte comparison target", { skip: !existsSync(BRIDGE_BINARY) && "build:bridge required" }, async () => {
  const spot = buildBridgeFixture("referee-flop-reference");
  const plan: BridgeSlicePlanV1 = { format: BRIDGE_SLICE_PLAN_FORMAT, version: 1, flop: { maxDepth: null },
    turn: { cards: ["2c"], maxDepth: 2, maxPriorRaises: 0 }, river: { boards: [["2c", "3d"]], maxDepth: 2, maxPriorRaises: 0 },
    subtrees: [], equity: true };
  const run = await runBridgeSpot(spot, { slices: plan, threads: 8 });
  const definition = { id: spot.id, flop: spot.board.flop, texture: "referee only", turnCards: ["2c"] as const, riverBoards: [["2c", "3d"]] as const };
  const encode = (value: unknown) => encodeFormationSpot(FORMATION_INPUTS.formations[0].id, definition, spot, plan, value, run.elapsedMs, run.sampledPeakRssBytes).files;
  const fresh = encode(run.result), cached = encode(JSON.parse(prettyJson(run.result)));
  assert.deepEqual([...fresh.keys()], [...cached.keys()]);
  for (const [url, text] of fresh) assert.deepEqual(JSON.parse(text), JSON.parse(cached.get(url)!));
  const hashes = (files: Map<string, string>) => Object.fromEntries([...files].map(([url, text]) => [url, sha256(text)]));
  const original = { dataHashes: hashes(fresh), iterations: run.result.iterations };
  assert.notDeepEqual(hashes(cached), original.dataHashes, "the old cache comparator must expose the ordering defect");
  compareFreshFormationHashes({ ...original, dataHashes: hashes(fresh) }, original);
  assert.throws(() => compareFreshFormationHashes({ ...original, dataHashes: hashes(cached) }, original));
});
