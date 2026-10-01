import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { BRIDGE_BINARY, type BridgeRun } from "../scripts/bridge-runner";
import { probeLibraryPrefixes } from "../scripts/hu-play-library-probe";
import { rangeFromBridge } from "../src/lib/hu-play/reach";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";

test("native play source uses one float32 thread and the same full-range adapter and quality gate", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/native.ts"), "NativeResolveSource is required for independent production-source audits");
  const { NativeResolveSource } = await import("../src/lib/hu-play/sources/native");
  const root = probeLibraryPrefixes([4]).roots.find(r => r.publicState.street === "river")!;
  assert.ok(root);
  const request: HumanModelRequest = { publicState: root.publicState, aiSeat: 0,
    ranges: { ai: rangeFromBridge(root.spot.ranges[0]), human: rangeFromBridge(root.spot.ranges[1]) } };
  const solved: { spot: BridgeSpotV1; run: BridgeRun }[] = [];
  const source = new NativeResolveSource({ onResult: (spot, run) => { solved.push({ spot, run }); } });
  await source.prepare(request);
  assert.equal(solved.length, 1);
  const { spot, run } = solved[0], r = run.result;
  assert.equal(r.engine.threads, 1); assert.equal(r.engine.precision, "float32");
  assert.equal(source.policy(request).provenance.source, "resolve");
  const grade = gradeRiverSubgame({ hands: r.hands, startingPot: spot.startingPot,
    subtree: { path: [], nodes: r.tree, ev: r.root.engineEv, reach: [spot.ranges[0].combos.map(h => h.weight), spot.ranges[1].combos.map(h => h.weight)] } });
  assert.ok(grade.localExploitabilityPctPot <= .3);
  let produced = false;
  const refused = new NativeResolveSource({ environment: { profile: "unknown", deviceMemoryGiB: .25 }, onResult: () => { produced = true; } });
  await assert.rejects(() => refused.prepare(request), /budget|exceed/i);
  assert.equal(produced, false);
});
