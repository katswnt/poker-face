import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { smallTurnRequest } from "./helpers/hu-play-turn";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";
import { NestedTurnSource } from "../src/lib/hu-play/sources/nested-turn";
import { NestedRiverSource } from "../src/lib/hu-play/sources/nested-river";
import { localDecisionValueInput } from "../src/lib/hu-play/sources/policy";
import { applyPublicEvent } from "../src/lib/hu-play/public-state";
import { applyStrategy } from "../src/lib/hu-play/reach";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";

test("resolved and nested sources attach the exact node's local values without changing reaches or requests", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  const { bindings } = await loadWasm();
  for (const kind of ["root", "nested-turn", "nested-river"] as const) {
    const spots: BridgeSpotV1[] = [];
    const solve = async (s: BridgeSpotV1) => { spots.push(s); return runWasmSpot(bindings, s, 7, { decisionValues: true }); };
    const frozen = loadP1ProductionRoots()[0].request;
    const q = kind === "nested-river" ? { ...frozen, aiSeat: 1 as const,
      ranges: frozen.aiSeat === 1 ? frozen.ranges : { ai: frozen.ranges.human, human: frozen.ranges.ai } } : smallTurnRequest();
    const source = kind === "root" ? new ResolvedPolicySource(solve) : kind === "nested-turn" ? new NestedTurnSource(solve) : new NestedRiverSource(solve);
    const actual = { type: "bet" as const, to: kind === "nested-river" ? 101 : 37 };
    if (source instanceof ResolvedPolicySource) await source.prepare(q); else await source.prepareOffTree(q, actual);
    const check = (request: typeof q) => {
      const policy = source.policy(request), snapshot = source.publicTree(request);
      assert.equal(policy.actionEvBasis, "local-solved-policy", kind);
      const n = snapshot.result.tree[snapshot.parentNode]; if (n.kind !== "player") throw new Error("Player required");
      const entry = snapshot.result.decisionValues!.nodes.find(e => e.nodeId === n.id)!;
      snapshot.result.hands[n.player].forEach((combo, h) => assert.deepEqual(policy.actionEvs(combo), entry.actionEv.map(row => row[h])));
      assert.deepEqual(localDecisionValueInput(snapshot.result, n.id, { source: "translation", spotHash: "0".repeat(64),
        x: 1, a: 1, b: 1, probabilityA: 1, mappedTo: "a" }), {}, "Translation must not inherit a local grade");
      const bad = { ...snapshot.result, decisionValues: { ...snapshot.result.decisionValues!, spotHash: "0".repeat(64) } };
      assert.throws(() => localDecisionValueInput(bad, n.id, policy.provenance), /model/);
      return policy;
    };
    const policy = check(q), action = kind === "root" ? { type: "check" as const } : actual;
    const next = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action }),
      ranges: { ...q.ranges, human: applyStrategy(q.ranges.human, combo => policy.probability(action, combo)) } };
    await source.prepare(next); check(next);
    assert.equal(spots.length, 1, "Teaching must not trigger another solve");
    assert.ok(spots.every(s => !/aiHand|humanHand|runout/.test(JSON.stringify(s))));
  }
});
