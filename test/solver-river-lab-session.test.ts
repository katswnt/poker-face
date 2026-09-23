import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import artifact from "../src/lib/solver/river/configurable-v3/artifacts/configurable-river-v3.json";
import { serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { createFactorizedRiverCfrSession, solveCompiledFactorizedRiverCfr } from "../src/lib/solver/river/factorized/cfr";
import { compileFactorizedRiverGame } from "../src/lib/solver/river/factorized/game";
import { configurableRiverV3DemoGame } from "../src/lib/solver/river/configurable-v3/fixture";
import { prepareConfigurableRiverV3, solveConfigurableRiverV3 } from "../src/lib/solver/river/configurable-v3/solve";
import { parseRiverLabInput, riverLabPreflight, RiverLabInputError } from "../src/lib/solver/river/lab/input";
import { AVERAGING_DELAY, EXAMPLE_INPUT, SMALL_INPUT, type RiverLabEvent } from "../src/lib/solver/river/lab/model";
import { createRiverLabRuntime } from "../src/lib/solver/river/lab/runtime";

const small = prepareConfigurableRiverV3(parseRiverLabInput(SMALL_INPUT).request);
const compiled = compileFactorizedRiverGame(small.game);
const wideInput = {
  ...EXAMPLE_INPUT, board: "2c 3d 4h 7s 9c",
  range0: "AA KK QQ JJ TT 88 66 55 AKs AQs AJs ATs KQs KJs QJs",
  range1: "AA KK QQ JJ TT 88 66 55 AKs AQs AJs ATs KQs KJs QJs",
  bets: "50 100", raises: "100", stack0: "100", stack1: "100", maxRaises: "1",
};

test("resumable ordinary CFR matches the independent readable solver across arbitrary chunks", () => {
  const reference = solveCfr(small.game, { iterations: 47, checkpointIterations: [1, 19, 47] });
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 10 }), chunks => {
    const session = createFactorizedRiverCfrSession(compiled, { iterations: 47, checkpointIterations: [1, 19, 47] });
    let i = 0;
    while (!session.done) {
      session.advance(chunks[i++ % chunks.length]);
      session.snapshot(); // Inspection and grading must not change subsequent arithmetic.
    }
    const result = session.snapshot();
    assert.deepEqual(result.averageStrategy, reference.averageStrategy);
    assert.deepEqual(result.currentStrategy, reference.currentStrategy);
    assert.deepEqual(result.cumulativeRegrets, reference.cumulativeRegrets);
    assert.deepEqual(result.checkpoints, reference.checkpoints);
  }), { numRuns: 15, seed: 62991 });
});

test("CFR+ chunking preserves delay, checkpoint strategies, regrets, and old snapshots", () => {
  const options = { iterations: 103, algorithm: "cfr-plus" as const, averagingDelay: 20, checkpointIterations: [1, 20, 21, 73, 103] };
  const reference = solveCompiledFactorizedRiverCfr(compiled, options);
  for (const chunk of [1, 7, 16, 29, 200]) {
    const session = createFactorizedRiverCfrSession(compiled, options);
    session.advance(1);
    const before = session.snapshot();
    const saved = serializeBehavioralStrategy(before.averageStrategy);
    while (!session.done) { session.advance(chunk); session.snapshot(); }
    assert.deepEqual(session.snapshot(), reference);
    assert.deepEqual(serializeBehavioralStrategy(before.averageStrategy), saved);
    assert.equal(before.iterations, 1);
    session.advance(10);
    assert.equal(session.iterations, 103);
  }
});

test("chunked 1000-iteration v3 result preserves the checked-in exact strategy bytes", () => {
  const session = createFactorizedRiverCfrSession(compileFactorizedRiverGame(configurableRiverV3DemoGame),
    { iterations: 1000, algorithm: "cfr-plus", averagingDelay: 20 });
  while (!session.done) session.advance(13);
  assert.deepEqual(serializeBehavioralStrategy(session.snapshot().averageStrategy), artifact.strategy);
  assert.equal(session.snapshot().fullDealRegretPasses, 2000);
  assert.equal(session.snapshot().reachOnlyPasses, 1000);
});

test("session rejects invalid chunks and options without advancing", () => {
  const session = createFactorizedRiverCfrSession(compiled, { iterations: 10 });
  for (const count of [0, -1, 0.5, NaN, Infinity]) assert.throws(() => session.advance(count), /positive safe integer/);
  assert.equal(session.iterations, 0);
  assert.throws(() => createFactorizedRiverCfrSession(compiled, { iterations: 0 }));
});

test("browser preflight counts the saved example and refuses a valid larger script game", () => {
  const { preflight } = riverLabPreflight(EXAMPLE_INPUT);
  assert.equal(preflight.counts.compatibleDeals, 176);
  assert.equal(preflight.counts.publicStatesPerDeal, 63);
  assert.equal(preflight.counts.projectedFullStates, 11089);
  assert.equal(preflight.approximateNodeVisits, 11088 * 5 * 1000);
  assert.equal(preflight.allowed, true);
  const wide = riverLabPreflight(wideInput);
  assert.equal(wide.preflight.counts.projectedFullStates, 106093);
  assert.equal(wide.preflight.allowed, false);
});

test("browser input validation preserves explicit weights and reports field-specific errors", () => {
  const request = parseRiverLabInput({ ...SMALL_INPUT, range0: "AsQs:50% AhAd:0.25" }).request;
  assert.deepEqual(prepareConfigurableRiverV3(request).scenario.ranges[0].map(entry => entry.weight).sort(), [0.25, 0.5]);
  const invalid = { ...SMALL_INPUT, board: "As As 4s 2c 9d", pot: "101", stack0: "1e3", bets: "50 50", iterations: "2001" };
  assert.throws(() => parseRiverLabInput(invalid), error => {
    assert.ok(error instanceof RiverLabInputError);
    assert.deepEqual(Object.keys(error.errors).sort(), ["bets", "board", "iterations", "pot", "stack0"]);
    return true;
  });
  for (const range0 of ["AA+", "AA AsAh", "AsQs:-1", "", "A".repeat(2001)]) {
    assert.throws(() => parseRiverLabInput({ ...SMALL_INPUT, range0 }), RiverLabInputError);
  }
  assert.equal(parseRiverLabInput({ ...SMALL_INPUT, maxRaises: "0", raises: "" }).request.maxRaises, 0);
});

test("worker boundary emits real progress, independently grades, and reproduces the script API", async () => {
  const events: RiverLabEvent[] = [];
  let tick = 0;
  const runtime = createRiverLabRuntime({ emit: event => events.push(structuredClone(event)), now: () => tick++, yield: async () => {} });
  const input = { ...SMALL_INPUT, iterations: "123" };
  await runtime.handle({ type: "solve", id: 1, input });
  const progress = events.filter(event => event.type === "progress");
  assert.ok(progress.length > 5);
  assert.equal(progress[0].iterations, 0);
  assert.ok(progress.some(event => event.iterations > 0 && event.iterations < 123));
  assert.ok(progress.every((event, i) => i === 0 || event.iterations >= progress[i - 1].iterations));
  assert.ok(progress.filter(event => event.quality).every(event => event.quality!.iteration <= event.iterations));
  const final = events.at(-1);
  assert.equal(final?.type, "result");
  if (final?.type !== "result") return;
  const reference = solveConfigurableRiverV3(parseRiverLabInput(input).request,
    { iterations: 123, algorithm: "cfr-plus", averagingDelay: AVERAGING_DELAY, includeDecisionFacts: true });
  assert.deepEqual(final.result.quality.value, reference.grade.value);
  assert.deepEqual(final.result.quality.gains, reference.grade.gains);
  assert.equal(final.result.quality.exploitability, reference.grade.exploitability);
  for (const facts of reference.decisions!) {
    await runtime.handle({ type: "inspect", id: 2, source: "custom", key: facts.informationSet });
    const event = events.at(-1);
    assert.equal(event?.type, "decision");
    if (event?.type === "decision") assert.deepEqual(event.decision.facts, facts);
  }
});

test("cancellation at preparation, iteration, grading, and explanation yields never publishes a result", async () => {
  for (const phase of ["preparing", "solving", "grading", "explaining"] as const) {
    const events: RiverLabEvent[] = [];
    let tick = 0;
    const runtime = createRiverLabRuntime({
      emit: event => {
        events.push(event);
        if (event.type === "progress" && event.phase === phase) void runtime.handle({ type: "cancel", id: 7 });
      }, now: () => tick++, yield: async () => {},
    });
    await runtime.handle({ type: "solve", id: 7, input: { ...SMALL_INPUT, iterations: "123" } });
    assert.equal(events.at(-1)?.type, "cancelled");
    assert.equal(events.some(event => event.type === "result"), false);
    if (phase === "solving") {
      const last = events.at(-1);
      assert.ok(last?.type === "cancelled" && last.iterations > 0 && last.iterations <= 16);
    }
    await runtime.handle({ type: "solve", id: 8, input: { ...SMALL_INPUT, iterations: "21" } });
    assert.equal(events.at(-1)?.type, "result"); // Old cancellation cannot poison a new run.
  }
});

test("direct worker commands cannot bypass the browser limits and malformed input can be corrected", async () => {
  const events: RiverLabEvent[] = [];
  const runtime = createRiverLabRuntime({ emit: event => events.push(event), now: () => 0, yield: async () => {} });
  for (const input of [wideInput, { ...SMALL_INPUT, iterations: "2001" }, { ...SMALL_INPUT, range0: "garbage" }]) {
    events.length = 0;
    await runtime.handle({ type: "solve", id: 1, input });
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.some(event => event.type === "progress" && event.iterations > 0), false);
    assert.equal(events.some(event => event.type === "result"), false);
  }
  await runtime.handle({ type: "preflight", id: 2, input: SMALL_INPUT });
  assert.equal(events.at(-1)?.type, "preflight");
});

test("an overlapping command and stale cancel cannot replace the running session", async () => {
  const events: RiverLabEvent[] = [];
  let release: (() => void) | undefined;
  const runtime = createRiverLabRuntime({ emit: event => events.push(event), now: () => 0,
    yield: () => new Promise<void>(resolve => { release = resolve; }) });
  const first = runtime.handle({ type: "solve", id: 11, input: SMALL_INPUT });
  await runtime.handle({ type: "solve", id: 12, input: SMALL_INPUT });
  assert.equal(events.at(-1)?.type, "error");
  await runtime.handle({ type: "cancel", id: 12 });
  await runtime.handle({ type: "cancel", id: 11 });
  release!();
  await first;
  assert.equal(events.at(-1)?.type, "cancelled");
});
