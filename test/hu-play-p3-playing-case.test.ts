import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { makeTurnOffTreeCase } from "../scripts/hu-play-p3-corpus";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { parseBridgeCombo } from "../src/lib/solver/bridge/contract";
import { smallTurnRequest } from "./helpers/hu-play-turn";
import { nodePolicy } from "../src/lib/hu-play/sources/policy";

test("P3 scripted tail uses a supported wager when the model has no supported passive action", async () => {
  const driver = await import("../scripts/hu-play-p3-playing-case");
  assert.ok(typeof driver.scriptedContinuationAction === "function", "Public-only total continuation selector required");
  const q = smallTurnRequest(), hands = q.ranges.human.entries.map(h => h.combo);
  const policy = nodePolicy(q, { player: 0, hands, encoding: "float32",
    actions: [{ type: "check" }, { type: "bet", to: 37 }], rows: [hands.map(() => 0), hands.map(() => 1)],
    provenance: { source: "library", spotHash: "a".repeat(64), librarySpotId: "test-only" } });
  assert.deepEqual(driver.scriptedContinuationAction(q, policy), { type: "bet", to: 37 });
  const none = { ...policy, probability: () => 0 };
  assert.throws(() => driver.scriptedContinuationAction(q, none), /supported/i);
});

const needsWasm = { skip: existsSync(`${WASM_BUILD_ROOT}/manifest.json`) ? false : "build:wasm required" };
test("P3 shared native/browser case driver completes a real reducer continuation and exactly replays direct and fallback cases", needsWasm, async () => {
  assert.ok(existsSync("scripts/hu-play-p3-playing-case.ts"), "Real reducer P3 measurement driver required");
  const { playTurnCase } = await import("../scripts/hu-play-p3-playing-case");
  const { bindings } = await loadWasm(), root = smallTurnRequest(), blueprint = runWasmSpot(bindings, buildPlaySpot(root));
  const c = makeTurnOffTreeCase(0, root, blueprint);
  for (const failExpanded of [false, true]) {
    const play = async () => {
      let calls = 0; const keys: string[] = [];
      const out = await playTurnCase(c, root, blueprint, async spot => {
        keys.push(hashBridgeSpot(spot));
        if (failExpanded && calls++ === 0) throw new Error("Test expanded-turn admission refusal");
        return runWasmSpot(bindings, spot);
      });
      assert.ok(out.state.result); assert.equal(out.state.result.net[0] + out.state.result.net[1], 0);
      assert.equal(out.responseRequest.publicState.events.length, c.request.publicState.events.length + 1);
      assert.deepEqual(out.response.result.tree[out.response.parentNode].committed, out.responseRequest.publicState.streetPut);
      assert.equal(out.provenance.source, failExpanded ? "translation" : "resolve");
      assert.ok(Number.isFinite(out.responseElapsedMs) && out.responseElapsedMs > 0
        && out.responseElapsedMs <= out.elapsedMs, "Measure action-to-first-AI-response separately from the full runout");
      assert.deepEqual(out.state.humanActions[0], c.actual);
      return { logHash: out.logHash, keys };
    };
    assert.deepEqual(await play(), await play());
  }
});

test("P3 case solving never depends on the human's actual hand, including the fresh river solve", needsWasm, async () => {
  assert.ok(existsSync("scripts/hu-play-p3-playing-case.ts"));
  const { playTurnCase } = await import("../scripts/hu-play-p3-playing-case");
  const { bindings } = await loadWasm(), root = smallTurnRequest(), blueprint = runWasmSpot(bindings, buildPlaySpot(root));
  const c = makeTurnOffTreeCase(0, root, blueprint), keys: string[] = [];
  const solve = async (spot: ReturnType<typeof buildPlaySpot>) => { keys.push(hashBridgeSpot(spot)); return runWasmSpot(bindings, spot); };
  const a = await playTurnCase(c, root, blueprint, solve), first = [...keys]; keys.length = 0;
  const blocked = [...parseBridgeCombo(a.state.deal.aiHand), ...a.state.config.flop, ...a.state.deal.runout];
  const other = c.request.ranges.human.entries.find(h => h.weight > 0 && h.combo !== a.state.deal.humanHand
    && parseBridgeCombo(h.combo).every(card => !blocked.includes(card)));
  assert.ok(other);
  const b = await playTurnCase(c, root, blueprint, solve, undefined, { humanHand: other.combo });
  assert.deepEqual(keys, first); assert.deepEqual(b.state.decisions, a.state.decisions);
  assert.deepEqual(b.state.public, a.state.public); assert.deepEqual(b.responseRequest, a.responseRequest);
});
