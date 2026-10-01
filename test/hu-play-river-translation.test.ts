import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { initialPublicState, applyPublicEvent } from "../src/lib/hu-play/public-state";
import { nodePolicy } from "../src/lib/hu-play/sources/policy";

test("river fallback uses supported public likelihoods and pseudo-harmonic neighbours, including check and call as zero increment", async () => {
  assert.ok(existsSync("src/lib/hu-play/river-translation.ts"), "Measured translation model is required");
  const { chooseRiverTranslation } = await import("../src/lib/hu-play/river-translation");
  let p = initialPublicState({ startingPot: 100, startingStack: 1000, minimumBet: 1, flop: ["Kd", "8c", "4h"] });
  for (const [street, card] of [["turn", "2s"], ["river", "9d"]] as const) {
    p = applyPublicEvent(p, { kind: "action", player: 0, action: { type: "check" } });
    p = applyPublicEvent(p, { kind: "action", player: 1, action: { type: "check" } });
    p = applyPublicEvent(p, { kind: "card", street, card });
  }
  const human = { source: "test", entries: [{ combo: "7s6s", weight: 1 }, { combo: "AsAh", weight: 1 }] };
  const ai = { source: "test", entries: [{ combo: "KsQs", weight: 1 }] };
  const q = { publicState: p, aiSeat: 1 as const, ranges: { ai, human } };
  const provenance = { source: "library" as const, spotHash: "0".repeat(64), librarySpotId: "test" };
  const make = (zero = false) => nodePolicy(q, { player: 0, hands: human.entries.map(h => h.combo),
    actions: [{ type: "check" }, { type: "bet", to: 50 }, { type: "bet", to: 100 }],
    rows: zero ? [[.5, .5], [.5, .5], [0, 0]] : [[.25, .25], [.25, .25], [.5, .5]], encoding: "float32", provenance });
  const a = chooseRiverTranslation(q, make(), { type: "bet", to: 75 }, .2);
  const b = chooseRiverTranslation(q, make(), { type: "bet", to: 75 }, .9);
  assert.ok(Math.abs(a.probabilityA - 3 / 7) < 1e-12);
  assert.deepEqual(a.mappedAction, { type: "bet", to: 50 }); assert.deepEqual(b.mappedAction, { type: "bet", to: 100 });
  const low = chooseRiverTranslation(q, make(), { type: "bet", to: 1 }, 0);
  assert.deepEqual(low.mappedAction, { type: "check" }); assert.equal(low.a, 0);
  const supported = chooseRiverTranslation(q, make(true), { type: "bet", to: 75 }, .9);
  assert.deepEqual(supported.mappedAction, { type: "bet", to: 50 }); assert.equal(supported.probabilityA, 1);
  const facing = { ...q, aiSeat: 0 as const, publicState: applyPublicEvent(p, { kind: "action", player: 0, action: { type: "bet", to: 50 } }) };
  const callOnly = nodePolicy(facing, { player: 1, hands: human.entries.map(h => h.combo), actions: [{ type: "fold" }, { type: "call" }],
    rows: [[.5, .5], [.5, .5]], encoding: "float32", provenance });
  assert.deepEqual(chooseRiverTranslation(facing, callOnly, { type: "raise", to: 137 }, .7).mappedAction, { type: "call" });
  assert.throws(() => chooseRiverTranslation(q, make(), { type: "bet", to: 75 }, 1), /draw/i);
  const later = { ...make(), provenance: { source: "translation" as const, spotHash: "0".repeat(64), x: .7, a: .5, b: 1,
    probabilityA: .5, mappedTo: "a" as const, responseSolve: { spotHash: "1".repeat(64), iterations: 10,
      exploitabilityPctPot: .2, bridgeVersion: "test", engineCommit: "test", precision: "float32" as const } } };
  assert.equal(chooseRiverTranslation(q, later, { type: "bet", to: 75 }, .2).spotHash, "1".repeat(64),
    "A later translation must name the response policy actually played, not its older reference");
});
