import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { applyPublicEvent, actionToken } from "../src/lib/hu-play/public-state";
import { applyStrategy, removeCard } from "../src/lib/hu-play/reach";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";
import { RiverPlaySource } from "../src/lib/hu-play/sources/river-play";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { smallTurnRequest } from "./helpers/hu-play-turn";
import { RIVER_DECK } from "../src/lib/solver/river/cards";

const needsWasm = { skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required" };
test("P3 turn controller composes nested play with explicit resource fallback and deterministic translation", needsWasm, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/turn-play.ts"), "P3 production turn controller required");
  const { TurnPlaySource } = await import("../src/lib/hu-play/sources/turn-play");
  const { bindings } = await loadWasm(), q = smallTurnRequest(), actual = { type: "bet" as const, to: 37 };
  for (const fallback of [false, true]) {
    const run = async () => {
      let calls = 0;
      const solve = async (s: BridgeSpotV1) => runWasmSpot(bindings, s);
      const source = new TurnPlaySource(new ResolvedPolicySource(solve), async s => {
        calls++; if (fallback && calls === 1) throw new Error("Test expanded admission refusal"); return solve(s);
      }, 123);
      assert.equal(await source.prepareHumanAction(q, actual), fallback ? "translation" : "nested");
      const next = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action: actual }),
        ranges: { ...q.ranges, human: applyStrategy(q.ranges.human, source.humanModel(q, actual)) } };
      await source.prepare(next);
      const snapshot = source.publicTree(next), policy = source.policy(next);
      assert.deepEqual(snapshot.result.tree[snapshot.parentNode].committed, [37, 0]);
      assert.equal(calls, fallback ? 2 : 1);
      if (fallback) {
        assert.equal(policy.provenance.source, "translation");
        if (policy.provenance.source !== "translation") throw new Error("provenance");
        assert.equal(policy.provenance.reason, "solve-unavailable");
        assert.equal(policy.provenance.mappingBasis, "increment-after-call");
      }
      return { next, provenance: policy.provenance };
    };
    assert.deepEqual(await run(), await run());
  }
});

test("P3 controller does not hide malformed results or cancellation behind a fallback", needsWasm, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/turn-play.ts"));
  const { TurnPlaySource } = await import("../src/lib/hu-play/sources/turn-play");
  const { bindings } = await loadWasm(), q = smallTurnRequest(), actual = { type: "bet" as const, to: 37 };
  for (const cancel of [true, false]) {
    const c = new AbortController(); let calls = 0;
    const source = new TurnPlaySource(new ResolvedPolicySource(async s => runWasmSpot(bindings, s)), async s => {
      calls++; const r = runWasmSpot(bindings, s);
      if (cancel) { c.abort(); return r; } return { ...r, spotHash: "0".repeat(64) };
    }, 5);
    await assert.rejects(() => source.prepareHumanAction(q, actual, c.signal)); assert.equal(calls, 1);
    assert.throws(() => source.humanModel(q, actual), /on.tree/);
  }
});

test("P3 real zero-support turn all-in uses a supported old likelihood but responds at the actual price", needsWasm, async () => {
  const { TurnPlaySource } = await import("../src/lib/hu-play/sources/turn-play");
  const { bindings } = await loadWasm(), base = smallTurnRequest();
  // QQ versus a set of sevens on A-7-4-2: a deterministic tiny counterexample to
  // assuming that every newly inserted action has positive solver-model reach.
  const q = { ...base, ranges: {
    human: { ...base.ranges.human, entries: base.ranges.human.entries.filter(h => h.combo === "QdQc") },
    ai: { ...base.ranges.ai, entries: base.ranges.ai.entries.filter(h => h.combo === "7h7c") },
  } };
  const actual = { type: "bet" as const, to: 1800 }, spots: BridgeSpotV1[] = [];
  const source = new TurnPlaySource(new ResolvedPolicySource(async s => runWasmSpot(bindings, s)), async s => {
    spots.push(s); return runWasmSpot(bindings, s);
  }, 17);
  assert.equal(await source.prepareHumanAction(q, actual), "translation");
  assert.equal(spots.length, 2, "The zero-support parent and the real-price response are two different games");
  const next = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action: actual }),
    ranges: { ...q.ranges, human: applyStrategy(q.ranges.human, source.humanModel(q, actual)) } };
  assert.ok(next.ranges.human.entries.every(h => h.weight > 0));
  await source.prepare(next);
  const policy = source.policy(next), snapshot = source.publicTree(next);
  assert.equal(policy.provenance.source, "translation");
  if (policy.provenance.source !== "translation") throw new Error("translation provenance");
  assert.equal(policy.provenance.reason, "zero-support");
  assert.deepEqual(snapshot.result.tree[snapshot.parentNode].committed, [1800, 0]);
  assert.deepEqual(policy.actions.map(a => a.type), ["fold", "call"]);
  assert.ok(policy.probability({ type: "call" }, "7h7c") > 0);
  assert.equal(spots[1].startingPot, 100); assert.equal(spots[1].effectiveStack, 1800);
});

test("P3 combined public source discards the turn continuation and solves the actual river with the played ranges", needsWasm, async () => {
  assert.ok(existsSync("src/lib/hu-play/sources/turn-play.ts"));
  assert.ok(existsSync("src/lib/hu-play/sources/postflop-play.ts"), "P3 public street router required");
  const { TurnPlaySource } = await import("../src/lib/hu-play/sources/turn-play");
  const { PostflopPlaySource } = await import("../src/lib/hu-play/sources/postflop-play");
  const { bindings } = await loadWasm(), q = smallTurnRequest(), actual = { type: "bet" as const, to: 37 };
  const spots: BridgeSpotV1[] = [], solve = async (s: BridgeSpotV1) => { spots.push(s); return runWasmSpot(bindings, s); };
  const onTree = new ResolvedPolicySource(solve);
  const source = new PostflopPlaySource(new TurnPlaySource(onTree, solve, 5), new RiverPlaySource(onTree, solve, 5));
  await source.prepareHumanAction(q, actual);
  const response = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: 0, action: actual }),
    ranges: { ...q.ranges, human: applyStrategy(q.ranges.human, source.humanModel(q, actual)) } };
  await source.prepare(response);
  const policy = source.policy(response), call = policy.actions.find(a => a.type === "call")!;
  assert.ok(response.ranges.ai.entries.some(h => h.weight > 0 && policy.probability(call, h.combo) > 0));
  const called = { ...response, publicState: applyPublicEvent(response.publicState, { kind: "action", player: 1, action: call }),
    ranges: { ...response.ranges, ai: applyStrategy(response.ranges.ai, h => policy.probability(call, h)) } };
  assert.equal(called.publicState.status, "chance");
  // Pick a card from public ranges only for this test; production deals through the reducer.
  const card = RIVER_DECK.find(c => ![...q.publicState.board.flop, q.publicState.board.turn].includes(c)
    && [...called.ranges.ai.entries, ...called.ranges.human.entries].every(h => !h.combo.includes(c)))!;
  const river = { ...called, publicState: applyPublicEvent(called.publicState, { kind: "card", street: "river", card }),
    ranges: { ai: removeCard(called.ranges.ai, card), human: removeCard(called.ranges.human, card) } };
  const before = spots.length; await source.prepare(river);
  assert.equal(spots.length, before + 1); assert.equal(spots.at(-1)!.board.river, card);
  assert.equal(spots.at(-1)!.startingPot, 174); assert.equal(spots.at(-1)!.effectiveStack, 1763);
  assert.deepEqual(source.publicTree(river).rootRequest.ranges, river.ranges);
  assert.equal(source.policy(river).provenance.source, "resolve");
  assert.equal(source.policy(river).provenance.ladder?.profile, "play-v1");
  const later = { type: "bet" as const, to: 1 };
  assert.ok(!source.policy(river).actions.some(a => actionToken(a) === actionToken(later)));
  assert.ok(["nested", "translation"].includes(await source.prepareHumanAction(river, later)));
  assert.equal(spots.at(-1)!.tree.mode, "river-subgame-v1", "P2 off-tree river solving remains available after a custom turn");
});
