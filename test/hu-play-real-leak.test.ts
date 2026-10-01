import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { loadWasm, runWasmSpot, WASM_BUILD_ROOT } from "../scripts/bridge-wasm-runner";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { PlayPolicySource } from "../src/lib/hu-play/sources/play";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";
import { loadScriptedHand, playBotHand } from "../src/lib/hu-play/scripted";
import { advanceAsync, applyHumanActionAsync, preparationRequest } from "../src/lib/hu-play/async-hand";
import { handLog, startHand } from "../src/lib/hu-play/hand";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { parseBridgeCombo, type BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { leakedCards } from "../src/lib/hu-play/leak";

test("real library and solved-policy sources do not observe changed private cards on the same public line", {
  skip: existsSync(join(WASM_BUILD_ROOT, "manifest.json")) ? false : "build:wasm required",
}, async () => {
  const fetcher: typeof fetch = async input => new Response(readFileSync(`public${String(input)}`));
  const catalog = await loadPlayCatalog(undefined, fetcher), { bindings } = await loadWasm();
  let solves = 0, changedHands = 0;
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 1000 }), async seed => {
    const dealt = await loadScriptedHand(catalog, seed, seed % 2 as 0 | 1, undefined, fetcher);
    const cache = new Map<string, BridgeResultV1>(), originalInputs: string[] = [], replayInputs: string[] = [];
    const source = new PlayPolicySource(dealt.library, new ResolvedPolicySource(async spot => {
      const bytes = canonicalBridgeSpotJson(spot); originalInputs.push(bytes); solves++;
      assert.ok(!/humanHand|aiHand|runout/.test(bytes));
      const result = runWasmSpot(bindings, spot); cache.set(hashBridgeSpot(spot), result); return result;
    }));
    const complete = await playBotHand(dealt.state, source), original = handLog(complete);
    const dead = new Set([...dealt.state.config.flop, ...parseBridgeCombo(dealt.state.deal.aiHand), ...dealt.state.deal.runout]);
    const alternative = dealt.state.ranges.human.entries.find(h => h.weight > 0 && h.combo !== dealt.state.deal.humanHand
      && !parseBridgeCombo(h.combo).some(c => dead.has(c)));
    assert.ok(alternative); changedHands++;
    const changed = startHand(dealt.state.config, { ...dealt.state.deal, humanHand: alternative.combo }, dealt.state.ranges);
    // Both hole cards are absent from preparation, even though changing the AI hand may
    // legitimately change the sampled action after preparation.
    assert.deepEqual(preparationRequest(changed), preparationRequest(dealt.state));
    assert.deepEqual(preparationRequest({ ...changed, deal: { ...changed.deal, aiHand: "AsKs" } }), preparationRequest(changed));
    const replaySource = new PlayPolicySource(dealt.library, new ResolvedPolicySource(async spot => {
      replayInputs.push(canonicalBridgeSpotJson(spot));
      const result = cache.get(hashBridgeSpot(spot)); assert.ok(result, "Private change caused a different public solve/cache key"); return result;
    }));
    let outcome = await advanceAsync(changed, replaySource);
    for (const action of original.humanActions) {
      assert.equal(outcome.status, "human");
      const mid = handLog(outcome.state); assert.equal(mid.reveal, null);
      assert.deepEqual(leakedCards(mid, parseBridgeCombo(alternative.combo)), []);
      outcome = await applyHumanActionAsync(outcome.state, action, replaySource);
    }
    assert.equal(outcome.status, "complete");
    const replay = handLog(outcome.state);
    assert.deepEqual(replayInputs, originalInputs);
    assert.deepEqual(replay.events, original.events);
    assert.deepEqual(replay.decisions, original.decisions);
  }), { seed: 20260930, numRuns: 12 });
  assert.equal(changedHands, 12); assert.ok(solves >= 10, "Exercise actual later-street solves, not only early folds");
});
