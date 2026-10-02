import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { preparationRequest } from "../src/lib/hu-play/async-hand";
import { handLog } from "../src/lib/hu-play/hand";
import { hashHandLog } from "../src/lib/hu-play/log-node";
import { applyPlayHumanActionAsync } from "../src/lib/hu-play/play-hand";
import { loadScriptedHand, scriptedSettlement } from "../src/lib/hu-play/scripted";
import { FlopPlaySource } from "../src/lib/hu-play/sources/flop-play";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { PostflopPlaySource } from "../src/lib/hu-play/sources/postflop-play";
import { ResolvedPolicySource, type PublicSolve } from "../src/lib/hu-play/sources/resolved";
import { RiverPlaySource } from "../src/lib/hu-play/sources/river-play";
import { TurnPlaySource } from "../src/lib/hu-play/sources/turn-play";
import { assertNoCards } from "../src/lib/hu-play/leak";
import { parseBridgeCombo } from "../src/lib/solver/bridge/contract";
import { RIVER_DECK } from "../src/lib/solver/river/cards";

const fetcher: typeof fetch = async input => {
  assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/);
  assert.ok(!String(input).includes("..")); return new Response(readFileSync(`public${input}`));
};
async function setup(seed: number, solve: PublicSolve) {
  assert.ok(existsSync("src/lib/hu-play/sources/translated-heads-up.ts"), "P4 needs full-hand translation routing");
  const { TranslatedHeadsUpPlaySource } = await import("../src/lib/hu-play/sources/translated-heads-up");
  const catalog = await loadPlayCatalog(undefined, fetcher);
  const dealt = await loadScriptedHand(catalog, seed, 1, undefined, fetcher);
  const root = new ResolvedPolicySource(solve);
  const source = new TranslatedHeadsUpPlaySource(new FlopPlaySource(dealt.library, seed), new PostflopPlaySource(
    new TurnPlaySource(root, solve, seed), new RiverPlaySource(root, solve, seed)));
  return { ...dealt, source };
}

test("P4 full-hand all-in uses actual chips, no invented later solve, exact replay and no private-card leak", async () => {
  let solves = 0;
  for (const seed of [0, 1, 2, 3, 4, 5]) {
    const play = async () => {
      const { state, source } = await setup(seed, async () => { solves++; throw new Error("No decision after an all-in call"); });
      const q = preparationRequest(state); await source.prepare(q);
      const description = source.flopDescription(q); assert.equal(description.passiveContinuation, false);
      assert.throws(() => source.publicTree(q), /saved flop|live resolved/i);
      const out = await applyPlayHumanActionAsync(state, { type: "bet", to: 9750 }, source);
      assert.equal(out.status, "complete", out.reason); assert.ok(out.state.result);
      assert.equal(out.state.humanActions.length, 1);
      assert.equal(out.state.public.events[0].kind, "action");
      assert.equal(out.state.result.net[0] + out.state.result.net[1], 0);
      const ledger = scriptedSettlement(out.state); assert.equal(ledger.finalStacks[0] + ledger.finalStacks[1], 20050);
      for (const decision of out.state.decisions) assertNoCards(decision, state.deal.humanHand, "P4 AI decision");
      return hashHandLog(handLog(out.state));
    };
    assert.equal(await play(), await play());
  }
  assert.equal(solves, 0);
});

test("P4 wrapper cancels a prospective flop bet without changing human chips or reach", async () => {
  const { state, source } = await setup(7, async () => { throw new Error("No solve during cancelled flop preparation"); });
  const c = new AbortController(), pending = applyPlayHumanActionAsync(state, { type: "bet", to: 101 }, source, c.signal);
  c.abort(); const out = await pending;
  assert.equal(out.status, "cancelled"); assert.equal(out.state, state);
  assert.deepEqual(state.public.streetPut, [0, 0]); assert.equal(state.humanActions.length, 0);
});

test("P4 actual translated AI response cannot depend on the human's cards or hidden runout", async () => {
  const { state } = await setup(7, async () => { throw new Error("No solve after an all-in"); });
  const occupied = [...state.config.flop, ...parseBridgeCombo(state.deal.aiHand), ...state.deal.runout];
  const other = state.ranges.human.entries.find(h => h.weight > 0 && h.combo !== state.deal.humanHand
    && parseBridgeCombo(h.combo).every(card => !occupied.includes(card)));
  assert.ok(other);
  const alternateRunout = RIVER_DECK.filter(card => ![...occupied, ...parseBridgeCombo(state.deal.humanHand)].includes(card)).slice(0, 2);
  assert.equal(alternateRunout.length, 2);
  const variants = [state, { ...state, deal: { ...state.deal, humanHand: other.combo } },
    { ...state, deal: { ...state.deal, runout: [alternateRunout[0], alternateRunout[1]] as const } }];
  const records = [];
  for (const variant of variants) {
    assert.deepEqual(preparationRequest(variant), preparationRequest(state));
    const { source } = await setup(7, async () => { throw new Error("No solve after an all-in"); });
    const out = await applyPlayHumanActionAsync(variant, { type: "bet", to: 9750 }, source);
    assert.equal(out.status, "complete", out.reason); assert.equal(out.state.decisions.length, 1);
    records.push(out.state.decisions);
  }
  assert.deepEqual(records[0], records[1]); assert.deepEqual(records[0], records[2]);
});
