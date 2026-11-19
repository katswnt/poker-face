import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { actionToken } from "../src/lib/hu-play/public-state";
import { preparationRequest, advanceAsync } from "../src/lib/hu-play/async-hand";
import { applyPlayHumanActionAsync } from "../src/lib/hu-play/play-hand";
import { handLog } from "../src/lib/hu-play/hand";

const fetcher: typeof fetch = async input => {
  assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/);
  assert.ok(!String(input).includes("..")); return new Response(readFileSync(`public${input}`));
};
async function api() {
  assert.ok(existsSync("src/lib/hu-play/ui-controller.ts"), "P5 needs its real UI state layer");
  return import("../src/lib/hu-play/ui-controller");
}
test("P5 UI controller uses the real P4 reducer, hides AI private data, and settles each completed hand once", async () => {
  const { PlayController, loadPlayHand } = await api();
  const solve = async () => { throw new Error("No live solve after flop all-in"); };
  const create = (seed: number, human: 0 | 1, signal?: AbortSignal) => loadPlayHand(seed, human, solve, signal, fetcher);
  const c = new PlayController(create);
  await c.start(0, 0); const view = c.getSnapshot();
  assert.equal(view.phase, "human"); assert.ok(view.hand);
  assert.equal(view.hand.aiHand, null); assert.equal(view.hand.public.pot, 550);
  assert.ok(view.decisions.every(d => d.actor !== "ai" || (d.strategy === null && d.actionEvs === null)));
  assert.throws(() => c.completedLog(), /complete/i);
  assert.deepEqual(Object.keys(c.equityInput(view.decisions[0].key)).sort(), ["aiRange", "board", "humanHand"]);
  await c.act({ type: "bet", to: 9750 });
  const end = c.getSnapshot(); assert.equal(end.phase, "complete", end.message);
  assert.equal(end.ledger.length, 1); assert.equal(end.ledger[0].humanNet + end.ledger[0].aiNet, 50);
  assert.equal(end.hand!.finalStacks![0] + end.hand!.finalStacks![1], 20050);
  assert.ok(end.hand!.aiHand); assert.ok(end.decisions.some(d => d.actor === "ai" && d.strategy));
  await c.resume(); assert.equal(c.getSnapshot().ledger.length, 1);
  const direct = await create(0, 0), initial = await advanceAsync(direct.state, direct.source);
  const played = await applyPlayHumanActionAsync(initial.state, {type: "bet", to: 9750}, direct.source);
  assert.deepEqual(c.completedLog(), handLog(played.state));
  await c.start(0, 0); await c.act({type: "bet", to: 9750});
  assert.equal(c.getSnapshot().ledger.length, 2, "replaying the same seed is a new practice hand");
  assert.deepEqual(c.completedLog(), handLog(played.state)); c.dispose();
});
test("P5 controller cancellation before commitment retains chips, and retry does not replay a bet", async () => {
  const { PlayController, loadPlayHand } = await api();
  let release: (() => void) | undefined, gate = false;
  const c = new PlayController(async (seed, human, signal) => {
    const b = await loadPlayHand(seed, human, async () => { throw new Error("No turn required"); }, signal, fetcher);
    const prepare = b.source.prepareHumanAction.bind(b.source);
    b.source.prepareHumanAction = async (q, action, s) => {
      if (gate) await new Promise<void>(resolve => { release = resolve; });
      return prepare(q, action, s);
    };
    return b;
  });
  await c.start(0, 0); const before = c.getSnapshot().hand!.public;
  gate = true; const pending = c.act({type: "bet", to: 101});
  c.cancel(); release!(); await pending;
  assert.equal(c.getSnapshot().phase, "cancelled"); assert.deepEqual(c.getSnapshot().hand!.public, before);
  gate = false; await c.resume(); assert.equal(c.getSnapshot().phase, "human");
  assert.equal(c.getSnapshot().hand!.public.events.length, 0); c.dispose();
});
test("P5 controller stale loading, disposal and recoverable errors cannot publish a hand or duplicate the ledger", async () => {
  const { PlayController, loadPlayHand } = await api();
  const b = await loadPlayHand(0, 0, async () => { throw new Error("unused"); }, undefined, fetcher);
  let finish: (() => void) | undefined, calls = 0, disposed = 0;
  const c = new PlayController(async () => {
    if (calls++ === 0) await new Promise<void>(resolve => { finish = resolve; });
    else throw new Error("Network unavailable");
    return { ...b, dispose: () => { disposed++; } };
  });
  const pending = c.start(0, 0); await c.start(1, 0); finish!(); await pending;
  assert.equal(c.getSnapshot().phase, "error"); assert.match(c.getSnapshot().message, /Network unavailable/);
  assert.equal(c.getSnapshot().hand, null); assert.equal(c.getSnapshot().ledger.length, 0);
  assert.equal(disposed, 1); const snapshot = c.getSnapshot(); c.dispose();
  assert.equal(c.getSnapshot(), snapshot); assert.throws(() => c.equityInput("missing"), /decision/i);
});
test("P5 refusal keeps a valid decision and legal action labels retain exact integer chip totals", async () => {
  const { PlayController, loadPlayHand } = await api();
  const c = new PlayController((s, h, signal) => loadPlayHand(s, h, async () => { throw new Error("forced refusal"); }, signal, fetcher));
  await c.start(0, 0); const before = c.getSnapshot().hand!.public;
  await c.act({type: "bet", to: 1});
  assert.deepEqual(c.getSnapshot().hand!.public, before); assert.equal(c.getSnapshot().ledger.length, 0);
  assert.match(c.getSnapshot().message, /minimum/i);
  await c.resume(); assert.equal(c.getSnapshot().phase, "human");
  assert.ok(c.getSnapshot().decisions[0].strategy!.every(r => typeof actionToken(r.action) === "string"));
  assert.ok(preparationRequest((await loadPlayHand(0, 0, async () => {throw new Error("unused");}, undefined, fetcher)).state));
  c.dispose();
});

test("P5 cancellation after commitment preserves the actual bet and card; retry never pays them twice", async () => {
  const { PlayController, loadPlayHand } = await api();
  let entered!: () => void, release!: () => void, once = true;
  const waiting = new Promise<void>(r => { entered = r; });
  const c = new PlayController(async (seed, human, signal) => {
    const b = await loadPlayHand(seed, human, async () => { throw new Error("Deliberate retry solve failure"); }, signal, fetcher);
    const prepare = b.source.prepare.bind(b.source);
    b.source.prepare = async (q, abort) => {
      if (q.publicState.street === "turn" && once) {
        once = false; entered(); await new Promise<void>(r => { release = r; }); abort?.throwIfAborted();
      }
      return prepare(q, abort);
    };
    return b;
  });
  await c.start(1, 0);
  const pending = c.act({type: "bet", to: 237}); await waiting; c.cancel(); release(); await pending;
  const paused = c.getSnapshot(); assert.equal(paused.phase, "cancelled");
  assert.equal(paused.hand!.public.street, "turn"); assert.equal(paused.hand!.public.pot, 1024);
  assert.equal(paused.hand!.public.stacks[0], 9513); assert.equal(paused.hand!.public.stacks[1], 9513);
  assert.deepEqual(paused.hand!.public.path.slice(0, 2), ["b237", "c"]);
  assert.equal(paused.hand!.aiHand, null); assert.equal(paused.ledger.length, 0);
  await c.resume(); assert.equal(c.getSnapshot().phase, "error");
  assert.match(c.getSnapshot().message, /Deliberate retry solve failure/);
  assert.deepEqual(c.getSnapshot().hand!.public, paused.hand!.public);
  assert.equal(c.getSnapshot().ledger.length, 0); c.dispose();
});

test("P5 public preparation and teaching projections never expose the hidden deal", async () => {
  const { PlayController, loadPlayHand } = await api();
  const requests: unknown[] = [];
  const c = new PlayController(async (seed, human, signal) => {
    const b = await loadPlayHand(seed, human, async () => { throw new Error("unused"); }, signal, fetcher);
    const prepare = b.source.prepare.bind(b.source), prepareHuman = b.source.prepareHumanAction.bind(b.source);
    b.source.prepare = async (q, abort) => { requests.push(structuredClone(q)); return prepare(q, abort); };
    b.source.prepareHumanAction = async (q, a, abort) => { requests.push(structuredClone(q)); return prepareHuman(q, a, abort); };
    return b;
  });
  await c.start(0, 0); await c.act({type: "bet", to: 9750});
  assert.ok(requests.length >= 2);
  for (const q of requests) {
    assert.deepEqual(Object.keys(q as object).sort(), ["aiSeat", "publicState", "ranges"]);
    assert.doesNotMatch(JSON.stringify(q), /"(?:humanHand|aiHand|runout|deal)":/);
  }
  for (const d of c.getSnapshot().decisions) {
    const input = c.equityInput(d.key);
    assert.deepEqual(Object.keys(input).sort(), ["aiRange", "board", "humanHand"]);
    assert.equal(input.board.length, 3, "Future cards cannot enter earlier decision equity");
    assert.equal(d.public.board.turn, null);
  }
  c.dispose();
});
