// P0 no-leak invariant (tasks/heads-up-play-resolving-spec.md 2.2): the human's hole cards never
// enter a spot, its hash input, a cache key, a decision-source request or a pre-showdown log.
import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { parseBridgeCombo } from "../src/lib/solver/bridge/contract";
import { LEAN_SRP_TREE } from "../src/lib/solver/bridge/fixtures";
import { initialPublicState, applyPublicEvent } from "../src/lib/hu-play/public-state";
import { buildResolveSpot, HU_RESOLVE_SOLVE, type ResolveSpotInput } from "../src/lib/hu-play/resolve-spot";
import { leakedCards } from "../src/lib/hu-play/leak";
import type { RiverCard } from "../src/lib/solver/river/cards";
import { advance, applyHumanAction, startHand, type DecisionSource } from "../src/lib/hu-play/hand";
import { createStubSource } from "../src/lib/hu-play/stub-source";
import { flopRanges, initialRanges, playHand, testConfig } from "./hu-play-helpers";

const choice = fc.tuple(fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }));
const handArb = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }), aiSeat: fc.constantFrom(0 as const, 1 as const),
  flopIndex: fc.nat(2), choices: fc.array(choice, { minLength: 1, maxLength: 12 }),
});

/** Everything in a spot except the two range lists, where every combo legitimately appears. */
function spotWithoutRanges(spot: object): unknown {
  return omit(spot, "ranges");
}

function omit(value: object, ...keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

test("human hole cards never reach a spot, hash input, cache key, request or pre-showdown log", () => {
  fc.assert(fc.property(handArb, ({ seed, aiSeat, flopIndex, choices }) => {
    const config = testConfig(seed, aiSeat, flopIndex);
    const hand = playHand(config, choices);
    const human = parseBridgeCombo(hand.state.deal.humanHand) as unknown as RiverCard[];
    assert.ok(hand.spots.length >= 1, "at least the flop root spot is built");
    for (const capture of hand.spots) {
      assert.deepEqual(leakedCards(spotWithoutRanges(capture.spot), human), []);
      assert.deepEqual(leakedCards(spotWithoutRanges(JSON.parse(capture.hashInput)), human), []);
      assert.deepEqual(leakedCards(capture.cacheKey, human), []);
      assert.match(capture.cacheKey, /^[0-9a-f]{64}$/);
    }
    for (const request of hand.requests) {
      assert.deepEqual(leakedCards(omit(JSON.parse(request), "ranges", "aiHand"), human), []);
    }
    for (const record of hand.log.decisions) assert.deepEqual(leakedCards(record, human), []);
    for (const log of hand.midHandLogs) {
      assert.equal(log.reveal, null);
      assert.deepEqual(leakedCards(log, human), []);
    }
  }), { numRuns: 60 });
});

test("non-interference: a different human hand with the same public line yields byte-identical spots and keys", () => {
  fc.assert(fc.property(handArb, fc.nat(), ({ seed, aiSeat, flopIndex, choices }, pickIndex) => {
    const config = testConfig(seed, aiSeat, flopIndex);
    const hand = playHand(config, choices);
    const deal = hand.state.deal;
    const dead = new Set<string>([...config.flop, ...parseBridgeCombo(deal.aiHand), ...deal.runout, ...parseBridgeCombo(deal.humanHand)]);
    const alternatives = flopRanges(config.flop)[1 - aiSeat].combos.map(e => e.combo)
      .filter(combo => !parseBridgeCombo(combo).some(c => dead.has(c)));
    fc.pre(alternatives.length > 0);
    const other = playHand(config, [], { ...deal, humanHand: alternatives[pickIndex % alternatives.length] }, hand.log.humanActions);
    assert.deepEqual(other.state.public.events, hand.state.public.events);
    assert.deepEqual(other.spots.map(s => s.hashInput), hand.spots.map(s => s.hashInput));
    assert.deepEqual(other.spots.map(s => s.cacheKey), hand.spots.map(s => s.cacheKey));
    assert.deepEqual(other.requests, hand.requests);
    assert.deepEqual(other.log.decisions, hand.log.decisions);
  }), { numRuns: 40 });
});

function flopRootInput(aiSeat: 0 | 1 = 0): ResolveSpotInput {
  const flop = ["Ks", "7h", "2d"] as const;
  return {
    publicState: initialPublicState({ startingPot: 550, startingStack: 9750, minimumBet: 100, flop: [...flop] }),
    aiSeat, ranges: initialRanges([...flop], aiSeat), tree: LEAN_SRP_TREE, solve: HU_RESOLVE_SOLVE, minimumRelativeReach: 0,
  };
}

test("the builder's type and runtime guard both refuse hole cards", () => {
  const input = flopRootInput();
  // @ts-expect-error: the builder has no field for anyone's hole cards.
  assert.throws(() => buildResolveSpot({ ...input, humanHand: "AsKs" }), /unexpected fields humanHand/);
  // A private field smuggled into the public state (e.g. by spreading a full hand state) is rejected too.
  const smuggled = { ...input, publicState: { ...input.publicState, holeCards: ["As", "Kd"] } };
  assert.throws(() => buildResolveSpot(smuggled), /unexpected fields holeCards/);
  const nested = { ...input, ranges: { ...input.ranges, humanHand: "AsKs" } };
  assert.throws(() => buildResolveSpot(nested), /unexpected fields humanHand/);
});

test("the flop-root spot is the library formation: same board, pot, stack, tree and ranges", () => {
  for (const aiSeat of [0, 1] as const) {
    const spot = buildResolveSpot(flopRootInput(aiSeat));
    const library = flopRanges(["Ks", "7h", "2d"]);
    assert.equal(spot.startingPot, 550);
    assert.equal(spot.effectiveStack, 9750);
    assert.deepEqual(spot.tree, LEAN_SRP_TREE);
    for (const player of [0, 1] as const) assert.deepEqual(spot.ranges[player].combos, library[player].combos);
  }
});

test("turn-root spot: actual pot and stacks, AI reach placed in the AI's seat, dealt streets nulled", () => {
  const input = flopRootInput(1);
  let state = input.publicState;
  for (const action of [{ type: "check" }, { type: "bet", to: 363 }, { type: "call" }] as const) {
    state = applyPublicEvent(state, { kind: "action", player: state.toAct!, action });
  }
  state = applyPublicEvent(state, { kind: "card", street: "turn", card: "Qh" });
  const ai = { source: "AI exact reach", entries: input.ranges.ai.entries.filter(e => !e.combo.includes("Qh")).map((e, i) => ({ ...e, weight: i % 2 ? e.weight : 0 })) };
  const spot = buildResolveSpot({ ...input, publicState: state, ranges: { ...input.ranges, ai } });
  assert.equal(spot.startingPot, 1276);
  assert.equal(spot.effectiveStack, 9387);
  assert.deepEqual(spot.board, { flop: ["Ks", "7h", "2d"], turn: "Qh", river: null });
  assert.equal(spot.tree.mode === "menu" && spot.tree.flop, null);
  assert.equal(spot.ranges[1].source, "AI exact reach");
  assert.equal(spot.ranges[1].combos.length, ai.entries.filter(e => e.weight > 0).length);
  assert.ok(spot.ranges[0].combos.every(e => !e.combo.includes("Qh")));
  // Mid-street roots are not expressible in contract v1 and must be refused.
  const mid = applyPublicEvent(state, { kind: "action", player: 0, action: { type: "check" } });
  assert.throws(() => buildResolveSpot({ ...input, publicState: mid, ranges: { ...input.ranges, ai } }), /street root/);
});

test("reducer guards: a source that writes the human's cards into a log line, or offers an illegal action, is refused", () => {
  const config = testConfig(7, 0, 0);
  const deal = { aiHand: "AsAd", humanHand: "QdQc", runout: ["3c", "4d"] } as const;
  const honest = createStubSource({ tree: LEAN_SRP_TREE });
  const leaky: DecisionSource = {
    humanModel: honest.humanModel,
    decide(request) {
      const response = honest.decide(request);
      return { ...response, provenance: { source: "library", spotHash: "0".repeat(64), librarySpotId: `peek-${"QdQc"}` } };
    },
  };
  assert.throws(() => advance(startHand(config, deal, initialRanges(config.flop, 0)), leaky), /Leak guard: Qd, Qc/);
  const illegal: DecisionSource = {
    humanModel: honest.humanModel,
    decide(request) {
      const response = honest.decide(request);
      return { ...response, strategy: [{ action: { type: "bet", to: 99_999 }, probability: 1 }] };
    },
  };
  assert.throws(() => advance(startHand(config, deal, initialRanges(config.flop, 0)), illegal), /illegal action/);
  // The human cannot act out of turn or illegally.
  const humanFirst = advance(startHand({ ...config, aiSeat: 1 }, deal, initialRanges(config.flop, 1)), honest);
  assert.equal(humanFirst.public.toAct, 0);
  assert.throws(() => applyHumanAction(humanFirst, { type: "call" }, honest), /only legal facing a bet/);
  assert.equal(applyHumanAction(humanFirst, { type: "check" }, honest).decisions.length, 1, "the AI answers the check");
  const aiTurn = startHand(config, deal, initialRanges(config.flop, 0));
  assert.throws(() => applyHumanAction(aiTurn, { type: "check" }, honest), /not the human's turn/);
  assert.throws(() => startHand(config, { ...deal, humanHand: "AsQs" }, initialRanges(config.flop, 0)), /repeats a card/);
});
