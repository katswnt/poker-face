import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { makeRiverOffTreeCase } from "../scripts/hu-play-p2-corpus";
import { playRiverCase } from "../scripts/hu-play-p2-playing-case";
import { solveNativePlay } from "../src/lib/hu-play/sources/native";
import type { BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { gradeRiverProfile } from "../src/lib/solver/bridge/river-hand-values";

test("P2 safety grades the composed AI, with per-hand margins and explicit terminal-translation convention", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  assert.ok(existsSync("scripts/hu-play-p2-safety.ts"), "Composed policy comparison required");
  const { compareRiverPolicies } = await import("../scripts/hu-play-p2-safety");
  const roots = loadP1ProductionRoots().filter(r => r.street === "river");
  for (const seed of [0, 1, 64, 96]) {
    const root = roots[seed % 32], { result } = await runBridgeSpot(root.playingSpot, { threads: 1 });
    const c = makeRiverOffTreeCase(seed, root.request, result), solves: { spot: BridgeSpotV1; result: BridgeResultV1 }[] = [];
    const playing = await playRiverCase(c, root.request, result, async spot => {
      const r = await solveNativePlay(spot, {}, undefined, "play-river-v1"); solves.push({ spot, result: r }); return r;
    });
    const compared = compareRiverPolicies(c, solves[0], playing.previous, playing.response);
    const a = compared.grades.actual, b = compared.grades.translated, ai = c.request.aiSeat, human = 1 - ai;
    assert.equal(compared.aiValueDifference, a.value[ai] - b.value[ai]);
    const naive = gradeRiverProfile(compared.expandedSpot, compared.profiles.actual, "naive");
    // Different summation orders, same pre-existing vector-vs-quadratic 1e-10 chip bar.
    for (const p of [0, 1] as const) {
      assert.ok(Math.abs(a.value[p] - naive.value[p]) < 1e-10);
      assert.ok(Math.abs(a.gains[p] - naive.gains[p]) < 1e-10);
      for (const k of ["value", "bestResponse"] as const) a.perHand[p][k].forEach((v, i) => {
        const ref = naive.perHand[p][k][i];
        if (v === null || ref === null) assert.equal(v, ref); else assert.ok(Math.abs(v - ref) < 1e-10);
      });
    }
    assert.equal(compared.margins.length, solves[0].result.hands[human].length);
    for (const [i, m] of compared.margins.entries()) {
      assert.equal(m.hand, solves[0].result.hands[human][i]);
      const actual = a.perHand[human].bestResponse[i], old = compared.grades.blueprint.perHand[human].bestResponse[i];
      assert.equal(m.versusBlueprint, actual === null || old === null ? null : actual - old);
    }
    // Changing the discarded AI strategies on old branches of the expanded solve must
    // not affect the composed-policy report at all.
    const changed = structuredClone(solves[0]);
    for (const n of changed.result.tree) if (n.kind === "player" && n.player === ai) {
      Object.assign(n, { strategy: n.strategy.map((row, a) => row.map(() => a === 0 ? 1 : 0)) });
    }
    assert.deepEqual(compareRiverPolicies(c, changed, playing.previous, playing.response), compared);
    assert.ok(compared.translation.mappedHumanAction);
    if (seed === 0) assert.equal(compared.translation.convention, "old-response-policy");
    if (seed === 96) assert.equal(compared.translation.convention, "terminal-call-through");
  }
});
