import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateTrainerHand, type TrainerHandInput } from "../src/lib/poker/trainer-hand";
import { createTrainerTaskStore, type TrainerWorkerPort } from "../src/lib/poker/trainer-worker-store";
import { runTrainerWorkerRequest } from "../src/lib/poker/trainer-worker-runtime";
import type { TrainerTask, TrainerWorkerRequest, TrainerWorkerResponse } from "../src/lib/poker/trainer-worker-protocol";
import { cards } from "./helpers";

const input: TrainerHandInput = {
  gs: { hands: [cards("Js", "7c"), cards("Ac", "6s"), cards("8d", "9h"), cards("8s", "5c")], board: cards("2c", "9d", "5d", "2s", "7s"), style: "gto", seed: 314159 },
  dealerIdx: 0, startingStacks: [200, 200, 200, 200], heroIdx: 0, heroChoices: [],
  players: [{ name: "Alice", pos: "Dealer", posShort: "BTN" }, { name: "Bob", pos: "Small Blind", posShort: "SB" }, { name: "Carol", pos: "Big Blind", posShort: "BB" }, { name: "Dan", pos: "UTG", posShort: "UTG" }],
};

const call: TrainerTask = { kind: "call", hole: cards("As", "Ks"), board: cards("Qs", "Js", "Ts", "2d", "3c"), quote: { callCost: 20, contestablePot: 100, requiredEquity: 0.2, allIn: true, layers: [] }, opponents: 1, style: "wild", seed: 123 };

class FakeWorker implements TrainerWorkerPort {
  onmessage: TrainerWorkerPort["onmessage"] = null;
  onerror: TrainerWorkerPort["onerror"] = null;
  onmessageerror: TrainerWorkerPort["onmessageerror"] = null;
  requests: TrainerWorkerRequest[] = [];
  terminated = 0;
  postMessage(request: TrainerWorkerRequest) { this.requests.push(request); }
  terminate() { this.terminated++; }
  reply(response: TrainerWorkerResponse) { this.onmessage?.({ data: response } as MessageEvent<TrainerWorkerResponse>); }
}

test("worker boundary round-trips serializable results with real elapsed time", () => {
  let clock = 20;
  const response = runTrainerWorkerRequest({ id: 1, task: call }, () => (clock += 7));
  assert.equal(response.type, "complete");
  if (response.type !== "complete" || response.result.kind !== "call") return;
  assert.equal(response.elapsedMs, 7);
  assert.equal(response.result.estimate.method, "enumerated");
  assert.equal(response.result.estimate.samples, 990);
  assert.equal(response.result.estimate.expectedReturn, 100);
  assert.deepEqual(structuredClone(response), response);
});

test("pure hand replay preserves chips and optional existing money snapshots", () => {
  const original = structuredClone(input);
  const stages = calculateTrainerHand(input);
  assert.ok(stages.some(stage => stage.street === "flop" && stage.type === "action"));
  assert.ok(stages.some(stage => stage.street === "river" && stage.decision?.equityMethod === "enumerated"));
  assert.deepEqual(input, original, "hand input is not mutated");
  assert.equal(stages.at(-1)?.stacks?.reduce((sum, stack) => sum + stack, 0), 800);
  const again = calculateTrainerHand(input);
  assert.deepEqual(again, stages);
  const withMoney = calculateTrainerHand({ ...input, includeMoneySnapshots: true });
  for (let index = 0; index < stages.length; index++) {
    const snapshot = { ...withMoney[index] };
    const baseline = { ...stages[index] };
    delete snapshot.contributions;
    delete baseline.contributions;
    assert.deepEqual(snapshot, baseline);
  }
  assert.ok(withMoney.filter(stage => stage.type === "street").every(stage => stage.contributions?.length === 4));
  const response = runTrainerWorkerRequest({ id: 2, task: { kind: "hand", input } });
  assert.equal(response.type, "complete");
  if (response.type === "complete" && response.result.kind === "hand") assert.deepEqual(response.result.stages, stages);
});

test("future turn/river cards cannot change earlier trainer decisions", () => {
  const before = calculateTrainerHand(input).filter(stage => stage.street === "preflop" || stage.street === "flop");
  const changed = calculateTrainerHand({ ...input, gs: { ...input.gs, board: cards("2c", "9d", "5d", "8c", "7h") } }).filter(stage => stage.street === "preflop" || stage.street === "flop");
  assert.deepEqual(changed, before);
});

test("worker catches bad requests and invalid input without producing a strategy", () => {
  assert.equal(runTrainerWorkerRequest({ id: 0, task: call }).type, "error");
  assert.equal(runTrainerWorkerRequest({ id: 1, task: { ...call, opponents: 6 } }).type, "error");
  assert.equal(runTrainerWorkerRequest({ id: 1, task: { kind: "unknown" } as unknown as TrainerTask }).type, "error");
});

test("store starts only on subscription and ignores stale IDs", () => {
  const worker = new FakeWorker();
  let creates = 0;
  const store = createTrainerTaskStore(call, () => { creates++; return worker; });
  assert.equal(creates, 0, "render must not create workers");
  assert.equal(store.getSnapshot().status, "pending");
  const unsubscribe = store.subscribe(() => {});
  const request = worker.requests[0];
  worker.reply(runTrainerWorkerRequest({ ...request, id: request.id + 1 }));
  assert.equal(store.getSnapshot().status, "pending");
  worker.reply(runTrainerWorkerRequest(request));
  assert.equal(store.getSnapshot().status, "complete");
  assert.equal(worker.terminated, 1);
  unsubscribe();
});

test("strict-mode restart and unmount terminate the previous worker and reject its late message", () => {
  const workers: FakeWorker[] = [];
  const store = createTrainerTaskStore(call, () => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  const firstUnsubscribe = store.subscribe(() => {});
  const staleCallback = workers[0].onmessage!;
  const staleResponse = runTrainerWorkerRequest(workers[0].requests[0]);
  firstUnsubscribe();
  assert.equal(workers[0].terminated, 1);
  const secondUnsubscribe = store.subscribe(() => {});
  staleCallback({ data: staleResponse } as MessageEvent<TrainerWorkerResponse>);
  assert.equal(store.getSnapshot().status, "pending");
  workers[1].reply(runTrainerWorkerRequest(workers[1].requests[0]));
  assert.equal(store.getSnapshot().status, "complete");
  secondUnsubscribe();
  assert.equal(workers[1].terminated, 1);
});

test("worker creation, runtime and message failures stay explicit without synchronous fallback", () => {
  const unavailable = createTrainerTaskStore(call, () => { throw new Error("unsupported"); });
  unavailable.subscribe(() => {});
  assert.equal(unavailable.getSnapshot().status, "error");
  for (const eventType of ["onerror", "onmessageerror"] as const) {
    const worker = new FakeWorker();
    const store = createTrainerTaskStore(call, () => worker);
    store.subscribe(() => {});
    worker[eventType]!({} as ErrorEvent & MessageEvent);
    assert.equal(store.getSnapshot().status, "error");
    assert.equal(worker.terminated, 1);
  }
});

test("idle stores create nothing and mismatched results fail visibly", () => {
  const idle = createTrainerTaskStore(null, () => { throw new Error("must not run"); });
  idle.subscribe(() => {});
  assert.equal(idle.getSnapshot().status, "idle");
  const worker = new FakeWorker();
  const store = createTrainerTaskStore(call, () => worker);
  store.subscribe(() => {});
  worker.reply({ id: worker.requests[0].id, type: "complete", result: { kind: "hand", stages: [] }, elapsedMs: 1 });
  assert.equal(store.getSnapshot().status, "error");
});
