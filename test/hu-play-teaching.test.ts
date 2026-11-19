import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { applyPublicEvent, initialPublicState } from "../src/lib/hu-play/public-state";
import { handScore } from "../src/lib/poker/eval";
import { requiredEquity } from "../src/lib/drills/generators";
import { RIVER_DECK, riverCardObject, parseRiverCombo, type RiverCard } from "../src/lib/solver/river/cards";

async function api() {
  assert.ok(existsSync("src/lib/hu-play/teaching.ts"), "P5 requires independently checked decision math");
  return import("../src/lib/hu-play/teaching");
}
const root = () => initialPublicState({ startingPot: 550, startingStack: 9750, minimumBet: 100, flop: ["Ks", "7h", "2d"] });
test("P5 price math distinguishes the call price from a raise's newly risked chips", async () => {
  const { decisionPrice } = await api();
  let s = root();
  assert.equal(decisionPrice(s), null, "no invented price when checking is free");
  for (const [player, action] of [[0, { type: "bet", to: 200 }], [1, { type: "raise", to: 650 }],
    [0, { type: "raise", to: 1377 }]] as const) {
    const before = s, risk = action.to - before.streetPut[player];
    s = applyPublicEvent(s, { kind: "action", player, action });
    const p = decisionPrice(s)!; const call = action.to - before.streetPut[1 - player];
    assert.equal(p.call, call); assert.equal(p.potBeforeCall, s.pot);
    assert.equal(p.requiredEquity, call / (s.pot + call));
    assert.equal(p.polarBluffShare, p.requiredEquity);
    assert.equal(p.potBeforeAggression, before.pot); assert.equal(p.aggressorRisk, risk);
    assert.equal(p.minimumDefence, before.pot / s.pot);
    assert.ok(Math.abs((1 - p.minimumDefence) * before.pot - p.minimumDefence * risk) < 1e-10);
    assert.ok(Math.abs(p.polarBluffShare * s.pot - (1 - p.polarBluffShare) * call) < 1e-10);
    assert.ok(Math.abs(p.requiredEquity * 100 - requiredEquity(s.pot - call, call)) < 1e-12);
  }
  assert.notEqual(decisionPrice(s)!.call, decisionPrice(s)!.aggressorRisk);
  s = applyPublicEvent(s, { kind: "action", player: 1, action: { type: "call" } });
  assert.equal(decisionPrice(s), null);
});

function oracle(hero: string, board: readonly RiverCard[], rows: readonly {combo: string; weight: number}[]) {
  const hole = parseRiverCombo(hero), known = [...hole, ...board];
  let mass = 0, win = 0, tie = 0, outcomes = 0, hands = 0;
  for (const row of rows) {
    const opponent = parseRiverCombo(row.combo);
    if (row.weight <= 0 || opponent.some(c => known.includes(c))) continue;
    hands++;
    const deck = RIVER_DECK.filter(c => ![...known, ...opponent].includes(c));
    const runouts: RiverCard[][] = board.length === 5 ? [[]] : board.length === 4 ? deck.map(c => [c])
      : deck.flatMap((c, i) => deck.slice(i + 1).map(d => [c, d]));
    for (const runout of runouts) {
      const b = [...board, ...runout].map(riverCardObject);
      const a = handScore(hole.map(riverCardObject), b), v = handScore(opponent.map(riverCardObject), b);
      const w = row.weight / runouts.length;
      mass += w; win += (a > v ? w : 0); tie += (a === v ? w : 0); outcomes++;
    }
  }
  return { equity: mass ? (win + tie / 2) / mass : null, hands, outcomes };
}
test("P5 exact weighted range equity enumerates flop/turn/river runouts and removes hero blockers", async () => {
  const { exactRangeEquity } = await api();
  const rows = [{ combo: "AsAd", weight: 0.2 }, { combo: "QcQh", weight: 0.7 }, { combo: "KsKh", weight: 0.8 },
    { combo: "8c8d", weight: 0 }];
  for (const board of [["2s", "7s", "Jh"], ["2s", "7s", "Jh", "9d"], ["2s", "7s", "Jh", "9d", "Tc"]] as const) {
    const input = { humanHand: "KsQs", board: [...board], aiRange: { source: "test weights", entries: rows } };
    const expected = oracle(input.humanHand, input.board, rows), progress: number[] = [];
    const got = exactRangeEquity(input, p => progress.push(p.completedHands));
    assert.equal(got.method, "exact-enumeration"); assert.equal(got.compatibleHands, expected.hands);
    assert.equal(got.outcomes, expected.outcomes); assert.ok(Math.abs(got.equity! - expected.equity!) < 1e-12);
    assert.ok(Math.abs(got.win + got.tie + got.loss - 1) < 1e-12);
    assert.equal(got.equity, got.win + got.tie / 2);
    assert.ok(Math.abs(got.groups.reduce((sum, g) => sum + g.share, 0) - 1) < 1e-12);
    assert.equal(progress.at(-1), expected.hands);
    const scaled = exactRangeEquity({ ...input, aiRange: { ...input.aiRange, entries: rows.map(r => ({...r, weight: r.weight * 1e200})) } });
    assert.ok(Math.abs(got.equity! - scaled.equity!) < 1e-12);
  }
});
test("P5 equity reports ties and unavailable support honestly, and refuses hidden or malformed inputs", async () => {
  const { exactRangeEquity } = await api();
  const input = { humanHand: "2c3d", board: ["As", "Ks", "Qs", "Js", "Ts"] as RiverCard[],
    aiRange: { source: "test", entries: [{ combo: "7c8d", weight: 1 }] } };
  const tied = exactRangeEquity(input); assert.equal(tied.equity, 0.5); assert.equal(tied.tie, 1);
  const empty = exactRangeEquity({ ...input, aiRange: { source: "blocked", entries: [{combo: "AsAd", weight: 1}] } });
  assert.equal(empty.equity, null); assert.equal(empty.outcomes, 0); assert.equal(empty.compatibleHands, 0);
  assert.throws(() => exactRangeEquity({ ...input, actualAiHand: "7c8d" } as typeof input), /fields|public|hidden/i);
  assert.throws(() => exactRangeEquity({ ...input, board: ["As", "As", "Qs"] }), /duplicate/i);
  assert.throws(() => exactRangeEquity({ ...input, aiRange: { source: "bad", entries: [{combo: "7c8d", weight: -1}] } }), /weight/i);
});
