import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { advance, applyHumanAction, handLog, startHand } from "../src/lib/hu-play/hand";
import { testConfig, initialRanges, flopRanges } from "./hu-play-helpers";
import { dealFromSeed } from "../src/lib/hu-play/rng";
import { createStubSource } from "../src/lib/hu-play/stub-source";
import { LEAN_SRP_TREE } from "../src/lib/solver/bridge/fixtures";

test("async preparation uses the real reducer and preserves a complete seeded check/call replay", async () => {
  assert.ok(existsSync("src/lib/hu-play/async-hand.ts"), "Public-only asynchronous controller is required");
  const { advanceAsync, applyHumanActionAsync } = await import("../src/lib/hu-play/async-hand");
  const config = testConfig(7, 0, 0), ranges = initialRanges(config.flop, config.aiSeat);
  const deal = dealFromSeed(7, config.flop, flopRanges(config.flop), config.aiSeat);
  const plain = createStubSource({ tree: LEAN_SRP_TREE }), prepared: string[] = [];
  const source = { ...plain, prepare: async (r: { publicState: unknown; aiSeat: unknown; ranges: unknown }) => {
    assert.deepEqual(Object.keys(r).sort(), ["aiSeat", "publicState", "ranges"]);
    prepared.push(JSON.stringify(r)); await Promise.resolve();
  } };
  let sync = advance(startHand(config, deal, ranges), plain);
  let async = await advanceAsync(startHand(config, deal, ranges), source);
  assert.deepEqual(async.state, sync);
  for (let guard = 0; !sync.result && guard < 100; guard++) {
    const facing = Math.max(...sync.public.streetPut) > sync.public.streetPut[sync.public.toAct!];
    const action = { type: facing ? "call" as const : "check" as const };
    sync = applyHumanAction(sync, action, plain);
    async = await applyHumanActionAsync(async.state, action, source);
    assert.deepEqual(async.state, sync);
  }
  assert.ok(sync.result);
  assert.equal(async.status, "complete");
  assert.deepEqual(handLog(async.state), handLog(sync));
  assert.ok(prepared.length > 1);
  assert.ok(prepared.every(s => !/aiHand|humanHand|runout/.test(s)));
});

test("cancel or failed preparation returns the pending state without a half-applied action", async () => {
  assert.ok(existsSync("src/lib/hu-play/async-hand.ts"), "Public-only asynchronous controller is required");
  const { advanceAsync } = await import("../src/lib/hu-play/async-hand");
  const config = testConfig(9, 0, 0), ranges = initialRanges(config.flop, 0);
  const initial = startHand(config, dealFromSeed(9, config.flop, flopRanges(config.flop), 0), ranges);
  const source = createStubSource({ tree: LEAN_SRP_TREE });
  let calls = 0;
  const controller = new AbortController();
  const cancelled = await advanceAsync(initial, { ...source, prepare: async () => { calls++; controller.abort(); } }, controller.signal);
  assert.equal(cancelled.status, "cancelled"); assert.deepEqual(cancelled.state, initial); assert.equal(calls, 1);
  const failed = await advanceAsync(initial, { ...source, prepare: async () => { throw new Error("No measured admission rung"); } });
  assert.equal(failed.status, "unavailable"); assert.deepEqual(failed.state, initial);
  assert.match(failed.reason ?? "", /admission/);
});
