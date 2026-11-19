import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
const input = { humanHand: "2c3d", board: ["As", "Ks", "Qs", "Js", "Ts"],
  aiRange: {source: "test", entries: [{combo: "7c8d", weight: 1}]} } as const;
test("P5 teaching Worker emits actual enumeration progress/result and rejects hidden inputs", async () => {
  assert.ok(existsSync("src/lib/hu-play/teaching-worker.ts"), "A separate exact-equity Worker boundary is required");
  const { runTeachingRequest } = await import("../src/lib/hu-play/teaching-worker");
  const events: import("../src/lib/hu-play/teaching-worker").TeachingEvent[] = [];
  runTeachingRequest({type: "equity", id: 7, input}, e => events.push(e));
  assert.ok(events.every(e => e.id === 7));
  assert.deepEqual(events.filter(e => e.type === "progress").map(e => e.progress.completedHands), [0, 1]);
  const last = events.at(-1)!; assert.equal(last.type, "result");
  if (last.type === "result") { assert.equal(last.result.equity, 0.5); assert.equal(last.result.outcomes, 1); }
  const bad: typeof events = [];
  runTeachingRequest({type: "equity", id: 8, input: {...input, actualAiHand: "7c8d"}}, e => bad.push(e));
  assert.equal(bad.length, 1); assert.equal(bad[0].type, "error");
});
test("P5 teaching client terminates cancelled/superseded Workers and ignores stale replies without synchronous fallback", async () => {
  assert.ok(existsSync("src/lib/hu-play/teaching-client.ts"), "P5 needs a cancellable teaching client");
  const { TeachingClient } = await import("../src/lib/hu-play/teaching-client");
  const workers: {onmessage: ((e: {data: unknown}) => void) | null; onerror: (() => void) | null;
    onmessageerror: (() => void) | null; postMessage(v: unknown): void; terminate(): void; stopped: number; sent: unknown[]}[] = [];
  const events: import("../src/lib/hu-play/teaching-worker").TeachingEvent[] = [];
  const c = new TeachingClient(e => events.push(e), () => {
    const w = { onmessage: null, onerror: null, onmessageerror: null, stopped: 0, sent: [] as unknown[],
      postMessage(v: unknown) { this.sent.push(v); }, terminate() { this.stopped++; } };
    workers.push(w); return w;
  });
  const first = c.start(input), stale = workers[0].onmessage!;
  const second = c.start(input); assert.equal(workers[0].stopped, 1);
  stale({data: {type: "error", id: first, message: "old error"}}); assert.equal(events.length, 0);
  workers[1].onmessage!({data: {type: "error", id: first, message: "wrong id"}}); assert.equal(events.length, 0);
  workers[1].onerror!(); assert.equal(events.length, 1); assert.equal(events[0].id, second);
  assert.equal(events[0].type, "error"); assert.equal(workers[1].stopped, 1);
  c.start(input); c.cancel(); assert.equal(workers[2].stopped, 1);
  assert.equal(events.at(-1)!.type, "cancelled");
  const thirdStale = workers[2].onmessage; c.dispose();
  thirdStale?.({data:{type: "error", id: 3, message: "after dispose"}});
  assert.equal(events.length, 2); assert.throws(() => c.start(input), /disposed/);
});
