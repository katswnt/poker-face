// Heads-up public-state bookkeeping: pot/stack accounting matches engine.ts and pots.ts, and
// illegal states are rejected.
import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { runBettingRound } from "../src/lib/poker/engine";
import type { Decision } from "../src/lib/poker/types";
import type { BridgeAction } from "../src/lib/solver/bridge/contract";
import {
  applyPublicEvent, derivePublicState, initialPublicState, validatePublicState, type HuPublicSetup,
} from "../src/lib/hu-play/public-state";
import type { HeadsUpPublicState, HuPublicEvent } from "../src/lib/hu-play/types";
import { playHand, testConfig } from "./hu-play-helpers";

const SETUP: HuPublicSetup = { startingPot: 550, startingStack: 9750, minimumBet: 100, flop: ["Ks", "7h", "2d"] };
const act = (state: HeadsUpPublicState, action: BridgeAction) => applyPublicEvent(state, { kind: "action", player: state.toAct!, action });
const choice = fc.tuple(fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }));
const handArb = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }), aiSeat: fc.constantFrom(0 as const, 1 as const),
  flopIndex: fc.nat(2), choices: fc.array(choice, { minLength: 1, maxLength: 12 }),
});

test("worked example: flop 66% bet and call, then the turn", () => {
  let state = act(initialPublicState(SETUP), { type: "bet", to: 363 });
  assert.equal(state.pot, 913);
  assert.deepEqual(state.stacks, [9387, 9750]);
  assert.equal(state.toAct, 1);
  state = act(state, { type: "call" });
  assert.equal(state.status, "chance");
  assert.equal(state.pot, 1276);
  assert.deepEqual(state.stacks, [9387, 9387]);
  assert.deepEqual(state.path, ["b363", "c"]);
  state = applyPublicEvent(state, { kind: "card", street: "turn", card: "Qh" });
  assert.equal(state.street, "turn");
  assert.equal(state.toAct, 0);
  assert.deepEqual(state.path, ["b363", "c", "Qh"]);
  // Check-raise on the turn: raise-to minimum is bet + (bet − 0).
  state = act(act(state, { type: "check" }), { type: "bet", to: 842 });
  assert.throws(() => act(state, { type: "raise", to: 1683 }), /below the minimum raise to 1684/);
  state = act(state, { type: "raise", to: 1684 });
  assert.equal(state.pot, 1276 + 842 + 1684);
});

test("an all-in call on the flop runs out the board to showdown with no more betting", () => {
  let state = act(act(initialPublicState(SETUP), { type: "bet", to: 9750 }), { type: "call" });
  assert.equal(state.status, "chance");
  state = applyPublicEvent(state, { kind: "card", street: "turn", card: "Qh" });
  assert.equal(state.status, "chance");
  assert.equal(state.toAct, null);
  state = applyPublicEvent(state, { kind: "card", street: "river", card: "3c" });
  assert.equal(state.status, "showdown");
  assert.equal(state.pot, 550 + 2 * 9750);
  assert.deepEqual(state.stacks, [0, 0]);
});

const toDecision = (action: BridgeAction): Decision => ({
  action: action.type, amount: "to" in action ? action.to : undefined, dialogue: "", reasoning: "", thoughts: [], math: [],
});

test("chip accounting street by street equals engine.ts runBettingRound, and settlement conserves chips", () => {
  fc.assert(fc.property(handArb, ({ seed, aiSeat, flopIndex, choices }) => {
    const hand = playHand(testConfig(seed, aiSeat, flopIndex), choices);
    const p = hand.state.public;
    const setup = { startingPot: p.startingPot, startingStack: p.startingStack, minimumBet: p.minimumBet, flop: p.flop };
    // Engine carry-over state.
    let pot = p.startingPot, stacks = [p.startingStack, p.startingStack], contributions = [p.startingPot / 2, p.startingPot / 2];
    let folded = [false, false];
    const events = p.events;
    let start = 0;
    while (start < events.length) {
      if (events[start].kind === "card") { start += 1; continue; }
      let end = start;
      while (end < events.length && events[end].kind === "action") end += 1;
      const script = events.slice(start, end).map(e => (e as Extract<HuPublicEvent, { kind: "action" }>).action);
      let k = 0;
      const round = runBettingRound({
        order: [0, 1], hands: [[], []], board: [], street: "postflop", players: [], pot, contributions, folded, stacks,
        bets: [0, 0], currentBet: 0, raiseCount: 0, countRaises: false, minimumBet: p.minimumBet, heroIdx: null,
        heroChoices: [], heroActionStart: 0, decide: () => toDecision(script[k++]),
      });
      assert.equal(k, script.length, "engine consumed exactly the scripted actions");
      round.stages.forEach((stage, i) => {
        const applied = stage.appliedAction!.decision;
        assert.equal(applied.action, script[i].type);
        if ("to" in script[i]) assert.equal(applied.amount, (script[i] as { to: number }).to);
      });
      ({ pot, stacks, contributions, folded } = round);
      const mine = derivePublicState(setup, events.slice(0, end));
      assert.equal(mine.pot, pot);
      assert.deepEqual([...mine.stacks], stacks);
      assert.deepEqual(contributions, [0, 1].map(i => p.startingPot / 2 + mine.closed + mine.streetPut[i]));
      assert.deepEqual(folded, [mine.folder === 0, mine.folder === 1]);
      start = end;
    }
    const result = hand.state.result!;
    assert.equal(result.payouts[0] + result.payouts[1], p.pot, "the whole pot is paid out");
    assert.equal(result.net[0] + result.net[1], 0, "zero-sum");
    assert.equal(p.pot + p.stacks[0] + p.stacks[1], p.startingPot + 2 * p.startingStack, "chips conserved");
  }), { numRuns: 80 });
});

test("validatePublicState accepts real states and rejects tampered or illegal ones", () => {
  const good = act(act(initialPublicState(SETUP), { type: "bet", to: 363 }), { type: "raise", to: 1200 });
  assert.deepEqual(validatePublicState(JSON.parse(JSON.stringify(good))), good);
  const bad: [string, unknown, RegExp][] = [
    ["tampered pot", { ...good, pot: good.pot + 1 }, /pot disagrees/],
    ["tampered stacks", { ...good, stacks: [9750, 9750] }, /stacks disagrees/],
    ["private field", { ...good, holeCards: ["As", "Kd"] }, /unexpected fields holeCards/],
    ["missing field", Object.fromEntries(Object.entries(good).filter(([k]) => k !== "pot")), /missing fields pot/],
    ["out of turn", { ...good, events: [{ kind: "action", player: 1, action: { type: "check" } }] }, /out of turn/],
    ["bet over stack", { ...good, events: [{ kind: "action", player: 0, action: { type: "bet", to: 9751 } }] }, /exceeds the all-in total/],
    ["bet below minimum", { ...good, events: [{ kind: "action", player: 0, action: { type: "bet", to: 99 } }] }, /below the minimum bet/],
    ["fractional bet", { ...good, events: [{ kind: "action", player: 0, action: { type: "bet", to: 150.5 } }] }, /whole number/],
    ["check facing a bet", { ...good, events: [good.events[0], { kind: "action", player: 1, action: { type: "check" } }] }, /check is illegal/],
    ["card mid-street", { ...good, events: [good.events[0], { kind: "card", street: "turn", card: "Qh" }] }, /no card is due/],
    ["card on the board", { ...good, events: [good.events[0], { kind: "action", player: 1, action: { type: "call" } },
      { kind: "card", street: "turn", card: "Ks" }] }, /already on the board/],
    ["river before turn", { ...good, events: [good.events[0], { kind: "action", player: 1, action: { type: "call" } },
      { kind: "card", street: "river", card: "Qh" }] }, /the turn is due/],
    ["action after a fold", { ...good, events: [good.events[0], { kind: "action", player: 1, action: { type: "fold" } },
      { kind: "action", player: 0, action: { type: "check" } }] }, /out of turn|no one is to act/],
    ["extra action field", { ...good, events: [{ kind: "action", player: 0, action: { type: "check", to: 5 } }] }, /unexpected fields to/],
    ["odd starting pot", { ...good, startingPot: 551 }, /even/],
  ];
  for (const [label, input, pattern] of bad) assert.throws(() => validatePublicState(input), pattern, label);
});

test("raising an all-in is illegal; a short all-in raise is legal", () => {
  const shove = act(initialPublicState({ ...SETUP, startingStack: 1000 }), { type: "bet", to: 1000 });
  assert.throws(() => act(shove, { type: "raise", to: 1000 }), /cannot raise an all-in/);
  const bet = act(initialPublicState({ ...SETUP, startingStack: 1000 }), { type: "bet", to: 600 });
  assert.equal(act(bet, { type: "raise", to: 1000 }).pot, 550 + 1600);
});
