import { test } from "node:test";
import assert from "node:assert/strict";
import { comparisonActions, comparisonAnchor, comparisonField, comparisonInput, sameComparisonDecision,
  riverValueBounds, riverValueChangeBounds, type RiverComparisonAnchor, type RiverComparisonChange, type RiverComparisonEvent } from "../src/lib/solver/river/lab/comparison";
import { riverComparisonPreflight } from "../src/lib/solver/river/lab/comparison-input";
import { createRiverComparisonRuntime } from "../src/lib/solver/river/lab/comparison-runtime";
import { riverLabExample } from "../src/lib/solver/river/lab/example";
import { inspectRiverLabDecision } from "../src/lib/solver/river/lab/teaching";
import { EXAMPLE_INPUT, SMALL_INPUT, type RiverLabQuality } from "../src/lib/solver/river/lab/model";
import { parseRiverLabInput } from "../src/lib/solver/river/lab/input";
import { solveConfigurableRiverV3 } from "../src/lib/solver/river/configurable-v3/solve";
import { createRiverLabContext } from "../src/lib/solver/river/lab/teaching";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { kuhnGame } from "../src/lib/solver/toy/kuhn";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";

const example = riverLabExample();
const pinned = comparisonAnchor(example.result, example.result.initialDecision);
const small: RiverComparisonAnchor = { input: { ...SMALL_INPUT, iterations: "123" }, decision: pinned.decision };
const change: RiverComparisonChange = { kind: "range", value: "AsQs AhAd 7h6h:25%" };

function harness() {
  const events: RiverComparisonEvent[] = [];
  let tick = 0;
  const runtime = createRiverComparisonRuntime({ emit: event => events.push(structuredClone(event)), now: () => tick++, yield: async () => {} });
  return { runtime, events };
}

test("pin copies the exact result inputs and anchor, independently of later form edits", () => {
  assert.deepEqual(pinned.input, EXAMPLE_INPUT);
  assert.equal(pinned.decision.player, 1);
  assert.deepEqual(pinned.decision.history, ["bet-to-50"]);
  assert.notEqual(pinned.decision.history, example.result.initialDecision.facts.history);
  assert.notEqual(pinned.decision.privateCards, example.result.initialDecision.facts.privateCards);
});

test("a comparison edits exactly one allowed field, including the correct opponent for either position", () => {
  for (const player of [0, 1] as const) for (const kind of ["range", "bets", "stack"] as const) {
    const anchor = { ...pinned, decision: { ...pinned.decision, player } };
    const before = structuredClone(anchor);
    const field = comparisonField(anchor, kind);
    assert.equal(field, kind === "bets" ? "bets" : `${kind}${1 - player}`);
    const next = comparisonInput(anchor, { kind, value: "changed" });
    assert.deepEqual(Object.keys(next).filter(key => next[key as keyof typeof next] !== anchor.input[key as keyof typeof next]), [field]);
    assert.deepEqual(anchor, before);
  }
  assert.throws(() => comparisonInput(pinned, { kind: "board" as "range", value: "As" }));
  assert.throws(() => comparisonInput(pinned, { kind: "range", value: "A".repeat(2001) }));
});

test("preflight rejects semantic no-ops, malformed values, invalid anchors, and excessive iterations", () => {
  for (const noChange of [
    { kind: "range", value: "76s:50% AQs:0.5 AA:0.5" },
    { kind: "bets", value: "200,100,50" }, { kind: "stack", value: "0200" },
  ] as const) assert.throws(() => riverComparisonPreflight(pinned, noChange), /Change the selected assumption/);
  for (const bad of [{ kind: "range", value: "AA+" }, { kind: "bets", value: "50 50" }, { kind: "stack", value: "0" }] as const) {
    assert.throws(() => riverComparisonPreflight(pinned, bad));
  }
  assert.throws(() => riverComparisonPreflight({ ...small, input: { ...small.input, iterations: "2001" } }, change));
  assert.throws(() => riverComparisonPreflight({ ...small, decision: { ...small.decision, history: ["bet-to-999"] } }, change), /pinned decision/);
  assert.throws(() => riverComparisonPreflight({ ...small, decision: { ...small.decision, player: 0 } }, change), /pinned decision/);
});

test("preflight counts both games and reports a deleted history without silently matching another decision", () => {
  const result = riverComparisonPreflight(pinned, { kind: "bets", value: "100 200" });
  assert.equal(result.preflight.before.counts.projectedFullStates, 11089);
  assert.equal(result.preflight.allowed, true);
  assert.equal(result.preflight.decisionAvailable, false);
  assert.equal(result.preflight.totalStates, 11089 + result.preflight.after.counts.projectedFullStates);
  assert.equal(result.input.iterations, "1000");
});

test("two individually allowed games can exceed the conservative combined-state limit", async () => {
  const wide = "AA QQ JJ TT AQs AJs ATs KQs KJs QJs 76s";
  const anchor = { ...pinned, input: { ...EXAMPLE_INPUT, range0: wide, range1: wide, bets: "50 100", raises: "100 200", maxRaises: "1" } };
  const edit: RiverComparisonChange = { kind: "range", value: wide.replace("76s", "76s:50%") };
  const { preflight } = riverComparisonPreflight(anchor, edit);
  assert.equal(preflight.before.allowed, true); assert.equal(preflight.after.allowed, true);
  assert.equal(preflight.totalStates, 135698); assert.equal(preflight.allowed, false);
  const { runtime, events } = harness();
  await runtime.handle({ type: "solve", id: 1, anchor, change: edit });
  assert.equal(events.at(-1)?.type, "error");
  assert.equal(events.some(e => e.type === "progress" && e.iterations > 0), false);
  assert.equal(events.some(e => e.type === "result"), false);
});

test("decision matching uses player, unordered own cards, and exact history, not opaque keys", () => {
  assert.ok(sameComparisonDecision(pinned.decision, { ...pinned.decision, privateCards: [pinned.decision.privateCards[1], pinned.decision.privateCards[0]] }));
  assert.equal(sameComparisonDecision(pinned.decision, { ...pinned.decision, player: 0 }), false);
  assert.equal(sameComparisonDecision(pinned.decision, { ...pinned.decision, history: ["bet-to-100"] }), false);
  assert.equal(sameComparisonDecision(pinned.decision, { ...pinned.decision, privateCards: ["As", "Ah"] }), false);
});

test("action deltas are by identity and percentage points; absent and off-path values are not zero", () => {
  const before = example.result.initialDecision;
  const after = structuredClone(before);
  const fact = before.facts.actions[0];
  after.facts = { ...after.facts, actions: [
    { ...fact, frequency: fact.frequency + 0.1, expectedAdditionalValue: fact.expectedAdditionalValue! + 2 },
    ...after.facts.actions.slice(2).reverse(),
  ] };
  const rows = comparisonActions(before, after);
  assert.ok(Math.abs(rows[0].frequencyDifference! - 10) < 1e-12);
  assert.equal(rows[0].valueDifference, 2);
  assert.equal(rows[1].after, null); assert.equal(rows[1].frequencyDifference, null); assert.equal(rows[1].valueDifference, null);
  const offPath = { ...after, facts: { ...after.facts, offPath: true } };
  assert.ok(comparisonActions(before, offPath).every(row => row.valueDifference === null && row.frequencyDifference === null));
  assert.throws(() => comparisonActions(before, { ...after, facts: { ...after.facts, history: [] } }), /same player/);
});

test("whole-game value bounds enclose Kuhn's known equilibrium for both players, including poorly trained profiles", () => {
  for (const iterations of [1, 3, 50]) {
    const solved = solveCfr(kuhnGame, { iterations });
    const grade = gradeStrategy(kuhnGame, solved.averageStrategy);
    const quality: RiverLabQuality = { iteration: iterations, value: grade.value, gains: grade.gains, exploitability: grade.exploitability };
    for (const player of [0, 1] as const) {
      const expected = player === 0 ? -1 / 18 : 1 / 18;
      const bounds = riverValueBounds(quality, player);
      assert.ok(bounds.low <= expected + 1e-12 && bounds.high >= expected - 1e-12);
      const opposite = riverValueBounds(quality, player === 0 ? 1 : 0);
      assert.ok(Math.abs(bounds.low + opposite.high) < 1e-12);
    }
    const delta = riverValueChangeBounds(quality, quality, 0);
    assert.ok(delta.low <= 0 && delta.high >= 0);
    assert.ok(Math.abs(delta.high - grade.nashGap) < 1e-12);
  }
});

test("comparison worker uses one resumable solve and matches the synchronous independent grade and exact teaching facts", async () => {
  const { runtime, events } = harness();
  await runtime.handle({ type: "solve", id: 11, anchor: small, change });
  const last = events.at(-1);
  assert.equal(last?.type, "result");
  if (last?.type !== "result") return;
  const expected = solveConfigurableRiverV3(parseRiverLabInput(comparisonInput(small, change)).request,
    { iterations: 123, algorithm: "cfr-plus", averagingDelay: 20, includeDecisionFacts: true });
  assert.deepEqual(last.comparison.result.quality.value, expected.grade.value);
  assert.deepEqual(last.comparison.result.quality.gains, expected.grade.gains);
  assert.equal(last.comparison.result.quality.exploitability, expected.grade.exploitability);
  const facts = expected.decisions!.find(d => sameComparisonDecision(d, small.decision))!;
  const context = createRiverLabContext(expected.game, expected.result.averageStrategy);
  assert.deepEqual(last.comparison.decision, inspectRiverLabDecision(context, facts.informationSet));
  const progress = events.filter(e => e.type === "progress");
  assert.ok(progress.some(e => e.iterations > 0 && e.iterations < 123));
  assert.ok(progress.every((e, i) => i === 0 || e.iterations >= progress[i - 1].iterations));
  assert.ok(progress.every(e => !e.quality || e.quality.iteration <= e.iterations));
  assert.equal(events.filter(e => e.type === "result").length, 1);
});

test("interval subtraction encloses the known equilibrium difference between distinct shifted Kuhn games", () => {
  const shifted: typeof kuhnGame = { ...kuhnGame, node(state) {
    const node = kuhnGame.node(state);
    return node.kind === "terminal" ? { ...node, utility: [node.utility[0] + 2, node.utility[1] - 2] } : node;
  } };
  const quality = (game: typeof kuhnGame, iterations: number): RiverLabQuality => {
    const solved = solveCfr(game, { iterations });
    const grade = gradeStrategy(game, solved.averageStrategy);
    return { iteration: iterations, value: grade.value, gains: grade.gains, exploitability: grade.exploitability };
  };
  const before = quality(kuhnGame, 31), after = quality(shifted, 17);
  for (const player of [0, 1] as const) {
    const trueDifference = player === 0 ? 2 : -2;
    const bounds = riverValueChangeBounds(before, after, player);
    assert.ok(bounds.low <= trueDifference && bounds.high >= trueDifference);
  }
});

test("a removed history or fully blocked own hand publishes no substitute decision", async () => {
  for (const edit of [{ kind: "bets", value: "100" }, { kind: "range", value: "JhAh" }] as const) {
    const { runtime, events } = harness();
    await runtime.handle({ type: "solve", id: 1, anchor: { ...small, input: { ...small.input, iterations: "21" } }, change: edit });
    const result = events.at(-1);
    assert.equal(result?.type, "result");
    if (result?.type === "result") assert.equal(result.comparison.decision, null);
  }
});

test("cancelling every progress phase discards partial results and does not poison the next solve", async () => {
  for (const phase of ["preparing", "solving", "grading", "explaining"] as const) {
    const events: RiverComparisonEvent[] = [];
    const runtime = createRiverComparisonRuntime({ now: () => 0, yield: async () => {}, emit: event => {
      events.push(event);
      if (event.id === 1 && event.type === "progress" && event.phase === phase) void runtime.handle({ type: "cancel", id: 1 });
    } });
    await runtime.handle({ type: "solve", id: 1, anchor: small, change });
    assert.equal(events.at(-1)?.type, "cancelled");
    assert.equal(events.filter(e => e.type === "cancelled").length, 1);
    assert.equal(events.some(e => e.type === "result"), false);
    await runtime.handle({ type: "solve", id: 2, anchor: small, change });
    assert.equal(events.at(-1)?.type, "result");
  }
});

test("cancellation during final matching is atomic, and overlapping commands or stale cancels cannot replace a run", async () => {
  for (const cancelYield of [3, 4]) {
    const events: RiverComparisonEvent[] = [];
    let explaining = false, yields = 0;
    const runtime = createRiverComparisonRuntime({ now: () => 0, emit: event => {
      events.push(event); if (event.type === "progress" && event.phase === "explaining") explaining = true;
    }, yield: async () => {
      if (explaining && ++yields === cancelYield) await runtime.handle({ type: "cancel", id: 1 });
    } });
    await runtime.handle({ type: "solve", id: 1, anchor: small, change });
    assert.equal(events.at(-1)?.type, "cancelled");
    assert.equal(events.some(e => e.type === "result"), false);
  }
  let release!: () => void;
  const events: RiverComparisonEvent[] = [];
  let firstYield = true;
  const runtime = createRiverComparisonRuntime({ now: () => 0, emit: e => events.push(e), yield: async () => {
    if (firstYield) { firstYield = false; await new Promise<void>(resolve => { release = resolve; }); }
  } });
  const running = runtime.handle({ type: "solve", id: 1, anchor: small, change });
  await runtime.handle({ type: "solve", id: 2, anchor: small, change });
  assert.equal(events.at(-1)?.type, "error");
  await runtime.handle({ type: "cancel", id: 2 }); release(); await running;
  assert.equal(events.at(-1)?.type, "result");
});
