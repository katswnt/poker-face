/** Same public source + real reducer in native and browser audits. Starts at a frozen river
 * parent, not a claim to replay the unrecorded earlier private deal or full hand decisions.
 */
import type { BridgeRange, BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { startHand, handLog } from "../src/lib/hu-play/hand";
import { applyPlayHumanActionAsync } from "../src/lib/hu-play/play-hand";
import { dealFromSeed } from "../src/lib/hu-play/rng";
import { RiverPlaySource } from "../src/lib/hu-play/sources/river-play";
import { ResolvedPolicySource, type PublicSolve, type ResolvedTreeSnapshot } from "../src/lib/hu-play/sources/resolved";
import { sha256 } from "../src/lib/solver/bridge/live/loader";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import type { DecisionProvenance, PrivateDeal } from "../src/lib/hu-play/types";
import type { makeRiverOffTreeCase } from "./hu-play-p2-corpus";

export type RiverOffTreeCase = ReturnType<typeof makeRiverOffTreeCase>;

export async function playRiverCase(c: RiverOffTreeCase, originalRoot: HumanModelRequest, blueprint: BridgeResultV1,
  solve: PublicSolve, signal?: AbortSignal, privateOverride?: Partial<Pick<PrivateDeal, "humanHand">>) {
  const aiSeat = c.request.aiSeat;
  const root: HumanModelRequest = { ...originalRoot, aiSeat, ranges: aiSeat === originalRoot.aiSeat ? originalRoot.ranges
    : { ai: originalRoot.ranges.human, human: originalRoot.ranges.ai } };
  const onTree = new ResolvedPolicySource(async spot => {
    const hash = await sha256(new TextEncoder().encode(canonicalSolverJson(spot)));
    if (hash !== blueprint.spotHash) throw new Error("P2 baseline belongs to a different street-root game");
    return blueprint; // checked frozen P1 policy, not a new baseline solve inside timed preparation
  });
  let response: { request: HumanModelRequest; snapshot: ResolvedTreeSnapshot; provenance: DecisionProvenance } | null = null;
  class ObservedSource extends RiverPlaySource {
    override async prepare(request: HumanModelRequest, abort?: AbortSignal) {
      await super.prepare(request, abort);
      if (request.publicState.toAct === aiSeat && request.publicState.events.length === c.request.publicState.events.length + 1) {
        response = { request: structuredClone(request), snapshot: this.publicTree(request), provenance: this.policy(request).provenance };
      }
    }
  }
  const source = new ObservedSource(onTree, solve, c.seed);
  await source.prepare(root, signal); await source.prepare(c.request, signal);
  const previous = source.publicTree(c.request), p = c.request.publicState;
  const bySeat = aiSeat === 0 ? [c.request.ranges.ai, c.request.ranges.human] : [c.request.ranges.human, c.request.ranges.ai];
  const ranges = bySeat.map(r => ({ source: r.source, combos: r.entries })) as [BridgeRange, BridgeRange];
  const deal = { ...dealFromSeed(c.seed, p.flop, ranges, aiSeat), ...privateOverride, runout: [p.board.turn!, p.board.river!] as const };
  const config = { handSeed: c.seed, aiSeat, startingPot: p.startingPot, startingStack: p.startingStack, minimumBet: p.minimumBet, flop: p.flop };
  const state = { ...startHand(config, deal, c.request.ranges), public: p };
  const started = performance.now();
  let out = await applyPlayHumanActionAsync(state, c.actual, source, signal);
  for (let guard = 0; out.status === "human" && guard < 4; guard++) {
    // A fixed, labelled scripted continuation, never a peek at the human's hand.
    out = await applyPlayHumanActionAsync(out.state, { type: "call" }, source, signal);
  }
  const elapsedMs = performance.now() - started;
  if (out.status !== "complete" || !out.state.result || !response) throw new Error(`P2 case ${c.seed} did not complete: ${out.status}: ${out.reason ?? "missing response"}`);
  const total = out.state.public.stacks[0] + out.state.public.stacks[1] + out.state.result.payouts[0] + out.state.result.payouts[1];
  if (total !== p.startingPot + 2 * p.startingStack || out.state.result.net[0] + out.state.result.net[1] !== 0) throw new Error("P2 continuation did not conserve chips");
  // Assignment occurs in the observed callback; do not mistake it for a statically null value.
  const observed = response as { request: HumanModelRequest; snapshot: ResolvedTreeSnapshot; provenance: DecisionProvenance };
  const log = handLog(out.state), logHash = await sha256(new TextEncoder().encode(canonicalSolverJson(log)));
  return { state: out.state, log, logHash, elapsedMs, previous, response: observed.snapshot,
    responseRequest: observed.request, provenance: observed.provenance };
}
