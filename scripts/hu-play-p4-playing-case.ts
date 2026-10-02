/** Public-parent continuation, not a claim to replay the earlier unobserved private deal. */
import type { BridgeRange } from "../src/lib/solver/bridge/contract";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { sha256 } from "../src/lib/solver/bridge/live/loader";
import { preparationRequest } from "../src/lib/hu-play/async-hand";
import { handLog, startHand, type HumanModelRequest } from "../src/lib/hu-play/hand";
import { applyPlayHumanActionAsync } from "../src/lib/hu-play/play-hand";
import { dealFromSeed } from "../src/lib/hu-play/rng";
import { scriptedSettlement } from "../src/lib/hu-play/scripted";
import type { PrivateDeal } from "../src/lib/hu-play/types";
import { FlopPlaySource, type FlopDescription } from "../src/lib/hu-play/sources/flop-play";
import { loadLibraryPolicySource } from "../src/lib/hu-play/sources/library";
import type { PlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { PostflopPlaySource } from "../src/lib/hu-play/sources/postflop-play";
import { ResolvedPolicySource, type PublicSolve } from "../src/lib/hu-play/sources/resolved";
import { RiverPlaySource } from "../src/lib/hu-play/sources/river-play";
import { TranslatedHeadsUpPlaySource } from "../src/lib/hu-play/sources/translated-heads-up";
import { TurnPlaySource } from "../src/lib/hu-play/sources/turn-play";
import { scriptedContinuationAction } from "./hu-play-p3-playing-case";
import type { FlopOffTreeCase } from "./hu-play-p4-corpus";

export async function playFlopCase(c: FlopOffTreeCase, catalog: PlayCatalog, solve: PublicSolve,
  signal?: AbortSignal, fetcher: typeof fetch = fetch, privateOverride?: Partial<Pick<PrivateDeal, "humanHand">>) {
  const library = await loadLibraryPolicySource(catalog, c.librarySpotId, signal, fetcher), aiSeat = c.request.aiSeat;
  const root = new ResolvedPolicySource(solve);
  const responses: { request: HumanModelRequest; description: FlopDescription }[] = [];
  let started = 0, responseElapsedMs: number | null = null;
  class ObservedSource extends TranslatedHeadsUpPlaySource {
    override async prepare(request: HumanModelRequest, abort?: AbortSignal) {
      await super.prepare(request, abort);
      if (request.publicState.street === "flop" && request.publicState.toAct === aiSeat) {
        responses.push({ request: structuredClone(request), description: this.flopDescription(request) });
        if (request.publicState.events.length === c.request.publicState.events.length + 1) responseElapsedMs = performance.now() - started;
      }
    }
  }
  const source = new ObservedSource(new FlopPlaySource(library, c.seed), new PostflopPlaySource(
    new TurnPlaySource(root, solve, c.seed), new RiverPlaySource(root, solve, c.seed)));
  await source.prepare(c.request, signal);
  const p = c.request.publicState, bySeat = aiSeat === 0 ? [c.request.ranges.ai, c.request.ranges.human] : [c.request.ranges.human, c.request.ranges.ai];
  const ranges = bySeat.map(r => ({ source: r.source, combos: r.entries })) as [BridgeRange, BridgeRange];
  const deal = { ...dealFromSeed(c.seed, p.flop, ranges, aiSeat), ...privateOverride };
  const config = { handSeed: c.seed, aiSeat, startingPot: p.startingPot, startingStack: p.startingStack, minimumBet: p.minimumBet, flop: p.flop };
  const state = { ...startHand(config, deal, c.request.ranges), public: p };
  started = performance.now(); let out = await applyPlayHumanActionAsync(state, c.actual, source, signal);
  for (let guard = 0; out.status === "human" && guard < 40; guard++) {
    const q = preparationRequest(out.state), action = scriptedContinuationAction(q, source.policy(q));
    out = await applyPlayHumanActionAsync(out.state, action, source, signal);
  }
  const elapsedMs = performance.now() - started;
  if (out.status !== "complete" || !out.state.result || responseElapsedMs === null) {
    throw new Error(`P4 case ${c.seed} did not complete: ${out.status}: ${out.reason ?? "missing initial response"}`);
  }
  const ledger = scriptedSettlement(out.state);
  if (out.state.result.net[0] + out.state.result.net[1] !== 0) throw new Error("P4 net chips do not conserve");
  const log = handLog(out.state), logHash = await sha256(new TextEncoder().encode(canonicalSolverJson(log)));
  // TypeScript does not track the awaited override's assignment through this closure.
  // The explicit null guard above remains the runtime requirement.
  return { state: out.state, log, logHash, ledger, responses, elapsedMs, responseElapsedMs: responseElapsedMs as number,
    passiveResponses: responses.filter(r => r.description.passiveContinuation).length };
}
