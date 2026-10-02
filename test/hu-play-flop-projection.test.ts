import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { mulberry32 } from "../src/lib/poker/equity";
import { applyPublicEvent, illegalActionReason, initialPublicState } from "../src/lib/hu-play/public-state";
import type { BridgeAction } from "../src/lib/solver/bridge/contract";

const root = () => initialPublicState({ startingPot: 550, startingStack: 9750,
  minimumBet: 100, flop: ["Ks", "7h", "2d"] });
const bet = (to: number) => applyPublicEvent(root(), { kind: "action", player: 0, action: { type: "bet", to } });
async function projection() {
  assert.ok(existsSync("src/lib/hu-play/flop-projection.ts"), "P4 needs an explicit real-price projection, not a changed ledger");
  return import("../src/lib/hu-play/flop-projection");
}

test("P4 projects saved increments into real legal chips, preserves all-ins, and never raises an all-in", async () => {
  const { projectFlopAction } = await projection();
  const saved = bet(182), real = bet(101), before = structuredClone([saved, real]);
  // Saved increment 548 / saved pot-after-call 914, applied to real pot-after-call 752.
  assert.deepEqual(projectFlopAction(real, saved, { type: "raise", to: 730 }), { type: "raise", to: 552 });
  assert.deepEqual(projectFlopAction(real, saved, { type: "raise", to: 9750 }), { type: "raise", to: 9750 });
  assert.deepEqual(projectFlopAction(bet(9750), saved, { type: "raise", to: 730 }), { type: "call" });
  assert.deepEqual(projectFlopAction(bet(500), saved, { type: "raise", to: 364 }), { type: "raise", to: 1000 });
  assert.deepEqual([saved, real], before);
  const checked = applyPublicEvent(root(), { kind: "action", player: 0, action: { type: "check" } });
  assert.deepEqual(projectFlopAction(bet(100), checked, { type: "check" }), { type: "call" });
  assert.deepEqual(projectFlopAction(bet(100), checked, { type: "bet", to: 363 }), { type: "raise", to: 595 });
  assert.throws(() => projectFlopAction(root(), saved, { type: "call" }), /actor|player|decision/i);
  assert.throws(() => projectFlopAction(real, saved, { type: "raise", to: 183 }), /illegal|minimum/i);
});

test("P4 preserves the unchanged menu exactly and 10,000 seeded real/saved projections remain legal", async () => {
  const { projectFlopAction } = await projection(), rng = mulberry32(0x50340001);
  for (let i = 0; i < 10000; i++) {
    const saved = bet(100 + Math.floor(rng() * 9651)), real = bet(100 + Math.floor(rng() * 9651));
    const amount = Math.min(9750, Math.max(...saved.streetPut) * 2);
    const actions: BridgeAction[] = [{ type: "fold" }, { type: "call" }];
    if (saved.streetPut[0] < 9750) actions.push({ type: "raise", to: amount });
    for (const action of actions) {
      assert.deepEqual(projectFlopAction(saved, saved, action), action);
      const actual = projectFlopAction(real, saved, action);
      assert.equal(illegalActionReason(real, actual), null, JSON.stringify({ i, action, actual }));
      const next = applyPublicEvent(real, { kind: "action", player: 1, action: actual });
      assert.equal(next.pot + next.stacks[0] + next.stacks[1], 20050);
    }
  }
});

test("P4 groups terminal/all-in collisions explicitly and refuses an ambiguous nonterminal branch", async () => {
  const api = await projection();
  assert.equal(typeof api.projectFlopMenu, "function", "P4 must preserve every projected action probability");
  const saved = bet(182), real = bet(9750);
  const menu = api.projectFlopMenu(real, saved, [{ type: "fold" }, { type: "call" }, { type: "raise", to: 730 }]);
  assert.deepEqual(menu.map(g => g.action), [{ type: "fold" }, { type: "call" }]);
  assert.deepEqual(menu[1].saved, [{ type: "call" }, { type: "raise", to: 730 }]);
  assert.deepEqual(menu[1].representative, { type: "call" });
  const narrow = initialPublicState({ startingPot: 100, startingStack: 1000, minimumBet: 100, flop: root().flop });
  const wide = initialPublicState({ startingPot: 550, startingStack: 9750, minimumBet: 1, flop: root().flop });
  assert.throws(() => api.projectFlopMenu(narrow, wide,
    [{ type: "bet", to: 100 }, { type: "bet", to: 200 }]), /ambigu|branch/i);
});
