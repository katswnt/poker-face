import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { BRIDGE_BINARY } from "../scripts/bridge-runner";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { NativeResolveSource } from "../src/lib/hu-play/sources/native";
import { handLog } from "../src/lib/hu-play/hand";
import { hashHandLog } from "../src/lib/hu-play/log-node";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";

const fetcher: typeof fetch = async input => new Response(readFileSync(`public${String(input)}`));

test("scripted formation plays and replays a complete real-source hand, accounting for the dead blind", {
  skip: existsSync(BRIDGE_BINARY) ? false : "build:bridge required",
}, async () => {
  assert.ok(existsSync("src/lib/hu-play/scripted.ts"), "Scripted deal and complete-hand driver are required");
  const { loadScriptedHand, playBotHand, scriptedSettlement } = await import("../src/lib/hu-play/scripted");
  const { PlayPolicySource } = await import("../src/lib/hu-play/sources/play");
  const catalog = await loadPlayCatalog(undefined, fetcher), seed = 0;
  const dealt = await loadScriptedHand(catalog, seed, 0, undefined, fetcher);
  const results = new Map<string, BridgeResultV1>();
  const native = new NativeResolveSource({ onResult: (spot, run) => { results.set(hashBridgeSpot(spot), run.result); } });
  const source = new PlayPolicySource(dealt.library, native);
  const complete = await playBotHand(dealt.state, source);
  assert.ok(complete.result);
  assert.ok(results.size > 0, "seed 0 must exercise a real continuation solve");
  const replaySource = new PlayPolicySource(dealt.library, new ResolvedPolicySource(async spot => {
    const result = results.get(hashBridgeSpot(spot)); assert.ok(result, "replay requested a different public spot"); return result;
  }));
  const replayed = await playBotHand(dealt.state, replaySource);
  assert.equal(hashHandLog(handLog(complete)), hashHandLog(handLog(replayed)));
  const settlement = scriptedSettlement(complete);
  assert.equal(settlement.finalStacks[0] + settlement.finalStacks[1], 20050);
  assert.equal(settlement.netSinceBeforeBlinds[0] + settlement.netSinceBeforeBlinds[1], 50);
  assert.equal(settlement.externalDeadBlind, 50);
  for (const p of [0, 1]) assert.equal(settlement.netSinceBeforeBlinds[p], complete.result.net[p] + 25);
  for (const d of complete.decisions) assert.deepEqual(d.provenance.ladder?.prunedMass, [0, 0]);
});
