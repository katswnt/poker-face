import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { preparationRequest } from "../src/lib/hu-play/async-hand";
import { handLog, startHand, type HumanModelRequest } from "../src/lib/hu-play/hand";
import { hashHandLog } from "../src/lib/hu-play/log-node";
import { applyPlayHumanActionAsync } from "../src/lib/hu-play/play-hand";
import { initialPublicState } from "../src/lib/hu-play/public-state";
import { rangeFromBridge } from "../src/lib/hu-play/reach";
import { dealFromSeed } from "../src/lib/hu-play/rng";
import { loadLibraryPolicySource } from "../src/lib/hu-play/sources/library";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { PostflopPlaySource } from "../src/lib/hu-play/sources/postflop-play";
import { ResolvedPolicySource, type PublicSolve } from "../src/lib/hu-play/sources/resolved";
import { RiverPlaySource } from "../src/lib/hu-play/sources/river-play";
import { TurnPlaySource } from "../src/lib/hu-play/sources/turn-play";
import { parseBridgeCombo, type BridgeRange, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { smallTurnRequest } from "./helpers/hu-play-turn";

const fetcher: typeof fetch = async input => {
  assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/);
  assert.ok(!String(input).includes("..")); return new Response(readFileSync(`public${input}`));
};
const needsWasm = { skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required" };
async function sourceFor(solve: PublicSolve, seed: number, nested: PublicSolve = solve) {
  assert.ok(existsSync("src/lib/hu-play/sources/heads-up.ts"), "Full-game public source must preserve custom-action preparation and translated likelihoods");
  const { HeadsUpPlaySource } = await import("../src/lib/hu-play/sources/heads-up");
  const catalog = await loadPlayCatalog(undefined, fetcher);
  const library = await loadLibraryPolicySource(catalog, catalog.library.spots[0].id, undefined, fetcher);
  const root = new ResolvedPolicySource(solve);
  return { library, source: new HeadsUpPlaySource(library, new PostflopPlaySource(
    new TurnPlaySource(root, nested, seed), new RiverPlaySource(root, nested, seed))) };
}

test("P3 full-game source keeps complete library flop play and refuses unsupported flop sizes", async () => {
  let solves = 0;
  const { source, library } = await sourceFor(async () => { solves++; throw new Error("No live flop solve"); }, 7);
  const q: HumanModelRequest = { publicState: initialPublicState({ startingPot: 550, startingStack: 9750,
    minimumBet: 100, flop: library.spot.board.flop }), aiSeat: 1,
    ranges: { human: rangeFromBridge(library.spot.ranges[0]), ai: rangeFromBridge(library.spot.ranges[1]) } };
  await source.prepare(q);
  assert.equal(source.policy(q).provenance.source, "library");
  assert.equal(await source.prepareHumanAction(q, { type: "check" }), "on-tree");
  const model = source.humanModel(q, { type: "check" });
  assert.deepEqual(q.ranges.human.entries.map(h => model(h.combo)),
    q.ranges.human.entries.map(h => library.policy(q).probability({ type: "check" }, h.combo)));
  await assert.rejects(() => source.prepareHumanAction(q, { type: "bet", to: 101 }), /flop.*outside|outside.*flop/i);
  await assert.rejects(() => source.prepareHumanAction({ ...q, aiSeat: 0 }, { type: "check" }), /human/i);
  assert.equal(solves, 0);
  await assert.rejects(() => source.prepare({ ...q, humanHand: "AsKs" } as HumanModelRequest), /unexpected|public/i);
});

function turnState(seed: number) {
  const q = smallTurnRequest(), p = q.publicState;
  const ranges = [q.ranges.human, q.ranges.ai].map(r => ({ source: r.source, combos: r.entries })) as [BridgeRange, BridgeRange];
  const original = dealFromSeed(seed, p.flop, ranges, q.aiSeat);
  const river = original.runout.find(c => c !== p.board.turn)!;
  const deal = { ...original, runout: [p.board.turn!, river] as const };
  return { ...startHand({ handSeed: seed, aiSeat: q.aiSeat, startingPot: p.startingPot,
    startingStack: p.startingStack, minimumBet: p.minimumBet, flop: p.flop }, deal, q.ranges), public: p };
}

test("P3 full-game reducer preserves custom-turn chips, exact replay, private-card independence and fallback model", needsWasm, async () => {
  const { bindings } = await loadWasm(), initial = turnState(7), actual = { type: "bet" as const, to: 37 };
  for (const fallback of [false, true]) {
    const play = async () => {
      const inputs: BridgeSpotV1[] = []; let custom = 0;
      const solve: PublicSolve = async s => { inputs.push(s); return runWasmSpot(bindings, s); };
      const { source } = await sourceFor(solve, 7, async s => {
        if (fallback && custom++ === 0) throw new Error("Test expanded turn admission refusal"); return solve(s);
      });
      let out = await applyPlayHumanActionAsync(initial, actual, source);
      for (let guard = 0; out.status === "human" && guard < 30; guard++) {
        const p = out.state.public;
        out = await applyPlayHumanActionAsync(out.state,
          { type: Math.max(...p.streetPut) > p.streetPut[p.toAct!] ? "call" : "check" }, source);
      }
      assert.equal(out.status, "complete", out.reason); assert.ok(out.state.result);
      assert.equal(out.state.result.net[0] + out.state.result.net[1], 0);
      assert.equal(out.state.public.stacks[0] + out.state.public.stacks[1]
        + out.state.result.payouts[0] + out.state.result.payouts[1], initial.public.startingPot + 2 * initial.public.startingStack);
      assert.deepEqual(out.state.humanActions[0], actual);
      assert.equal(out.state.public.events.filter(e => e.kind === "action" && e.action.type === "bet" && e.action.to === 37).length, 1);
      assert.equal(out.state.decisions[0].provenance.source, fallback ? "translation" : "resolve");
      assert.ok(inputs.every(s => !/aiHand|humanHand|runout/.test(JSON.stringify(s))));
      return { hash: hashHandLog(handLog(out.state)), inputs };
    };
    assert.deepEqual(await play(), await play());
  }
  // The public preparation boundary cannot see which member of the range was dealt.
  const occupied = [...initial.config.flop, ...initial.deal.runout, ...parseBridgeCombo(initial.deal.aiHand)];
  const otherHand = initial.ranges.human.entries.find(h => h.combo !== initial.deal.humanHand
    && h.weight > 0 && parseBridgeCombo(h.combo).every(c => !occupied.includes(c)));
  assert.ok(otherHand, "Compare two legal positive-weight private deals on the same public line");
  const other = { ...initial, deal: { ...initial.deal, humanHand: otherHand.combo } };
  assert.doesNotThrow(() => startHand(initial.config, other.deal, initial.ranges));
  assert.deepEqual(preparationRequest(initial), preparationRequest(other));
});

test("P3 full-game cancellation before a custom turn leaves the exact reducer state and reaches untouched", needsWasm, async () => {
  const { bindings } = await loadWasm(), initial = turnState(7), c = new AbortController(); let nested = 0;
  const { source } = await sourceFor(async s => runWasmSpot(bindings, s), 7, async s => {
    nested++; c.abort(); return runWasmSpot(bindings, s);
  });
  const out = await applyPlayHumanActionAsync(initial, { type: "bet", to: 37 }, source, c.signal);
  assert.equal(out.status, "cancelled"); assert.equal(out.state, initial); assert.equal(nested, 1);
  assert.equal(out.state.humanActions.length, 0); assert.deepEqual(out.state.public.streetPut, [0, 0]);
});
