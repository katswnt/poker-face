import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { loadP1ProductionRoots } from "../scripts/hu-play-p1-corpus";
import { dealFromSeed } from "../src/lib/hu-play/rng";
import { startHand, handLog } from "../src/lib/hu-play/hand";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";
import { RiverPlaySource } from "../src/lib/hu-play/sources/river-play";
import { hashHandLog } from "../src/lib/hu-play/log-node";

test("P2 reducer boundary commits an off-tree action once, conserves real chips, replays, and keeps cancellation before the bet", {
  skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/play-hand.ts"), "P2 asynchronous reducer boundary required");
  const { applyPlayHumanActionAsync } = await import("../src/lib/hu-play/play-hand");
  const { bindings } = await loadWasm(), root = loadP1ProductionRoots()[0], aiSeat = 1 as const;
  const q = { ...root.request, aiSeat, ranges: root.request.aiSeat === aiSeat ? root.request.ranges
    : { ai: root.request.ranges.human, human: root.request.ranges.ai } };
  const p = q.publicState, config = { handSeed: 7, aiSeat, startingPot: p.startingPot, startingStack: p.startingStack,
    minimumBet: p.minimumBet, flop: p.flop };
  const ranges = [q.ranges.human, q.ranges.ai].map(r => ({ source: r.source, combos: r.entries })) as [typeof root.spot.ranges[0], typeof root.spot.ranges[1]];
  const deal = { ...dealFromSeed(7, p.flop, ranges, aiSeat), runout: [p.board.turn!, p.board.river!] as const };
  const state = { ...startHand(config, deal, q.ranges), public: p };
  const play = async () => {
    const solve = async (s: typeof root.spot) => runWasmSpot(bindings, s);
    const source = new RiverPlaySource(new ResolvedPolicySource(solve), solve, 7);
    let out = await applyPlayHumanActionAsync(state, { type: "bet", to: 101 }, source);
    if (out.status === "human") out = await applyPlayHumanActionAsync(out.state, { type: "call" }, source);
    assert.equal(out.status, "complete", out.reason); assert.ok(out.state.result);
    assert.deepEqual(out.state.humanActions[0], { type: "bet", to: 101 });
    assert.equal(out.state.result.net[0] + out.state.result.net[1], 0);
    assert.equal(out.state.public.stacks[0] + out.state.public.stacks[1] + out.state.result.payouts[0] + out.state.result.payouts[1], p.startingPot + 2 * p.startingStack);
    return hashHandLog(handLog(out.state));
  };
  assert.equal(await play(), await play());
  const c = new AbortController();
  const cancelled = new RiverPlaySource(new ResolvedPolicySource(async s => runWasmSpot(bindings, s)),
    async s => { c.abort(); return runWasmSpot(bindings, s); }, 7);
  const out = await applyPlayHumanActionAsync(state, { type: "bet", to: 101 }, cancelled, c.signal);
  assert.equal(out.status, "cancelled"); assert.equal(out.state, state); assert.equal(out.state.humanActions.length, 0);
});
