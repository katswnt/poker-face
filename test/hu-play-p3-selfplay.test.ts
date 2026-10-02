import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { smallTurnRequest } from "./helpers/hu-play-turn";
import { startHand, handLog, type HumanModelRequest } from "../src/lib/hu-play/hand";
import { dealFromSeed } from "../src/lib/hu-play/rng";
import { playBotHand } from "../src/lib/hu-play/scripted";
import { PreparedPolicySource, preparationKey, nodePolicy } from "../src/lib/hu-play/sources/policy";
import type { BridgeRange } from "../src/lib/solver/bridge/contract";

test("P3 self-play uses prospective action preparation and retains P1's seeded draws and log", async () => {
  assert.ok(existsSync("scripts/hu-play-p3-selfplay.ts"), "Production-action self-play driver required");
  const { playP3BotHand } = await import("../scripts/hu-play-p3-selfplay");
  const q = smallTurnRequest(), ranges = [q.ranges.human, q.ranges.ai]
    .map(r => ({ source: r.source, combos: r.entries })) as [BridgeRange, BridgeRange];
  const config = { handSeed: 7, aiSeat: q.aiSeat, startingPot: 100, startingStack: 1800, minimumBet: 1, flop: q.publicState.flop };
  const initial = startHand(config, dealFromSeed(7, config.flop, ranges, q.aiSeat), q.ranges);
  class CheckSource extends PreparedPolicySource {
    preparedActions = 0;
    async prepare(request: HumanModelRequest) {
      const player = request.publicState.toAct!, incoming = player === request.aiSeat ? request.ranges.ai : request.ranges.human;
      this.prepared = { key: preparationKey(request), policy: nodePolicy(request, { player,
        actions: [{ type: "check" }], hands: incoming.entries.map(h => h.combo), rows: [incoming.entries.map(() => 1)], encoding: "float32",
        provenance: { source: "library", spotHash: "a".repeat(64), librarySpotId: "test-only" } }) };
    }
    async prepareHumanAction(request: HumanModelRequest) { this.preparedActions++; await this.prepare(request); }
  }
  const source = new CheckSource(), current = await playP3BotHand(initial, source), previous = await playBotHand(initial, new CheckSource());
  assert.equal(source.preparedActions, 3); assert.deepEqual(handLog(current), handLog(previous));
  assert.equal(current.result!.net[0] + current.result!.net[1], 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => playP3BotHand(initial, new CheckSource(), controller.signal), /cancel|abort/i);
});
