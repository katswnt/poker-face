import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { initialPublicState } from "../src/lib/hu-play/public-state";
import { nodePolicy } from "../src/lib/hu-play/sources/policy";
import { compareBridgeCombos } from "../src/lib/solver/bridge/contract";

function parent() {
  const hands = ["AhAd", "QhQd"].sort(compareBridgeCombos);
  const request: HumanModelRequest = {
    publicState: initialPublicState({ startingPot: 550, startingStack: 9750, minimumBet: 100, flop: ["Ks", "7h", "2d"] }),
    aiSeat: 1, ranges: { ai: { source: "test AI", entries: [{ combo: "JhJd", weight: 1 }] },
      human: { source: "test human", entries: hands.map(combo => ({ combo, weight: 1 })) } },
  };
  const policy = (rows: number[][]) => nodePolicy(request, { player: 0, hands, encoding: "per-mille",
    actions: [{ type: "check" }, { type: "bet", to: 182 }, { type: "bet", to: 363 }], rows,
    provenance: { source: "library", spotHash: "a".repeat(64), librarySpotId: "test" } });
  return { request, policy, hands };
}

test("P4 human translation uses supported pseudo-harmonic neighbours and preserves the actual price", async () => {
  assert.ok(existsSync("src/lib/hu-play/flop-translation.ts"), "P4 needs a public, supported flop translation rule");
  const { chooseFlopTranslation } = await import("../src/lib/hu-play/flop-translation");
  const { request, policy } = parent(), p = policy([[200, 200], [300, 300], [500, 500]]);
  const original = structuredClone(request), actual = { type: "bet" as const, to: 101 };
  const low = chooseFlopTranslation(request, p, actual, 0), high = chooseFlopTranslation(request, p, actual, .99);
  assert.deepEqual(low.mappedAction, { type: "check" });
  assert.deepEqual(high.mappedAction, { type: "bet", to: 182 });
  assert.ok(Math.abs(low.probabilityA - 44550 / 118482) < 1e-15);
  assert.equal(low.x, 101 / 550);
  assert.deepEqual(chooseFlopTranslation(request, p, { type: "bet", to: 9750 }, .5).mappedAction, { type: "bet", to: 363 });
  const supported = chooseFlopTranslation(request, policy([[0, 0], [500, 500], [500, 500]]), actual, .5);
  assert.deepEqual(supported.omittedUnsupportedActions, [{ type: "check" }]);
  assert.deepEqual(supported.mappedAction, { type: "bet", to: 182 });
  assert.deepEqual(request, original); assert.deepEqual(actual, { type: "bet", to: 101 });
  assert.throws(() => chooseFlopTranslation(request, p, actual, 1), /draw/i);
  assert.throws(() => chooseFlopTranslation({ ...request, humanHand: "AhAd" } as HumanModelRequest, p, actual, .5), /public|unexpected/i);
});

test("P4 excludes a reference with positive marginal mass but no blocker-compatible opponent", async () => {
  assert.ok(existsSync("src/lib/hu-play/flop-translation.ts"), "P4 needs compatible-support checks");
  const { chooseFlopTranslation } = await import("../src/lib/hu-play/flop-translation");
  const { request, policy, hands } = parent(), a = hands.indexOf("AhAd");
  const checks = hands.map((_, i) => i === a ? 1000 : 0), bets = checks.map(v => v ? 0 : 500);
  const blocked = { ...request, ranges: { ...request.ranges, ai: { source: "blocks AA", entries: [{ combo: "AhJh", weight: 1 }] } } };
  const mapped = chooseFlopTranslation(blocked, policy([checks, bets, bets]), { type: "bet", to: 101 }, 0);
  assert.deepEqual(mapped.omittedUnsupportedActions, [{ type: "check" }]);
  assert.deepEqual(mapped.mappedAction, { type: "bet", to: 182 });
});
