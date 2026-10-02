/** Same public turn/river controllers + real reducer in native/browser P3 observations.
 * Starts at a frozen public parent. It does not replay an unrecorded earlier private deal.
 */
import type { BridgeRange, BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { preparationRequest } from "../src/lib/hu-play/async-hand";
import { handLog, startHand, type HumanModelRequest } from "../src/lib/hu-play/hand";
import { applyPlayHumanActionAsync } from "../src/lib/hu-play/play-hand";
import { dealFromSeed } from "../src/lib/hu-play/rng";
import { PostflopPlaySource } from "../src/lib/hu-play/sources/postflop-play";
import { TurnPlaySource } from "../src/lib/hu-play/sources/turn-play";
import { RiverPlaySource } from "../src/lib/hu-play/sources/river-play";
import { hasCompatibleAction } from "../src/lib/hu-play/sources/nested-river";
import { ResolvedPolicySource, type PublicSolve, type ResolvedTreeSnapshot } from "../src/lib/hu-play/sources/resolved";
import type { DecisionProvenance, PrivateDeal } from "../src/lib/hu-play/types";
import { sha256 } from "../src/lib/solver/bridge/live/loader";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import type { makeTurnOffTreeCase } from "./hu-play-p3-corpus";
import type { NodePolicy } from "../src/lib/hu-play/sources/policy";

/** Fixed public-only preference, including wagers if the model gives every passive
 * action zero support. This is a scripted test opponent, not a human poker strategy.
 */
export function scriptedContinuationAction(request: HumanModelRequest, policy: NodePolicy) {
  const action = ["check", "call", "fold", "bet", "raise"].flatMap(type => policy.actions.filter(a => a.type === type))
    .find(a => hasCompatibleAction(request, policy, a));
  if (!action) throw new Error("P3 scripted continuation has no supported action");
  return action;
}

export type TurnOffTreeCase = ReturnType<typeof makeTurnOffTreeCase>;
export async function playTurnCase(c: TurnOffTreeCase, originalRoot: HumanModelRequest, blueprint: BridgeResultV1,
  solve: PublicSolve, signal?: AbortSignal, privateOverride?: Partial<Pick<PrivateDeal, "humanHand">>) {
  const aiSeat = c.request.aiSeat;
  const root: HumanModelRequest = { ...originalRoot, aiSeat, ranges: aiSeat === originalRoot.aiSeat ? originalRoot.ranges
    : { ai: originalRoot.ranges.human, human: originalRoot.ranges.ai } };
  const onTree = new ResolvedPolicySource(async (spot, abort) => {
    if (spot.board.river !== null) return solve(spot, abort); // actual dealt river, not the truncated turn continuation
    const hash = await sha256(new TextEncoder().encode(canonicalSolverJson(spot)));
    if (hash !== blueprint.spotHash) throw new Error("P3 baseline belongs to a different turn-root game");
    return blueprint;
  });
  const observations: { request: HumanModelRequest; snapshot: ResolvedTreeSnapshot; provenance: DecisionProvenance }[] = [];
  let started = 0, responseElapsedMs: number | null = null;
  class ObservedSource extends PostflopPlaySource {
    override async prepare(request: HumanModelRequest, abort?: AbortSignal) {
      await super.prepare(request, abort);
      if (request.publicState.toAct === aiSeat && request.publicState.street === "turn"
        && request.publicState.events.length === c.request.publicState.events.length + 1) {
        observations.push({ request: structuredClone(request), snapshot: this.publicTree(request), provenance: this.policy(request).provenance });
        responseElapsedMs = performance.now() - started;
      }
    }
  }
  const source = new ObservedSource(new TurnPlaySource(onTree, solve, c.seed), new RiverPlaySource(onTree, solve, c.seed));
  await source.prepare(root, signal); await source.prepare(c.request, signal);
  const previous = source.publicTree(c.request), p = c.request.publicState;
  const bySeat = aiSeat === 0 ? [c.request.ranges.ai, c.request.ranges.human] : [c.request.ranges.human, c.request.ranges.ai];
  const ranges = bySeat.map(r => ({ source: r.source, combos: r.entries })) as [BridgeRange, BridgeRange];
  const dealt = dealFromSeed(c.seed, p.flop, ranges, aiSeat);
  // First sampled remaining card other than the known turn is uniform over legal rivers.
  // This private runout lives only in the reducer; no source/spot/cache gets either field.
  const river = dealt.runout[0] === p.board.turn ? dealt.runout[1] : dealt.runout[0];
  const deal = { ...dealt, ...privateOverride, runout: [p.board.turn!, river] as const };
  const config = { handSeed: c.seed, aiSeat, startingPot: p.startingPot, startingStack: p.startingStack, minimumBet: p.minimumBet, flop: p.flop };
  const state = { ...startHand(config, deal, c.request.ranges), public: p };
  started = performance.now();
  let out = await applyPlayHumanActionAsync(state, c.actual, source, signal);
  for (let guard = 0; out.status === "human" && guard < 20; guard++) {
    const q = preparationRequest(out.state), policy = source.policy(q);
    // No actual human hand, solve speed or eventual result enters this preference.
    const action = scriptedContinuationAction(q, policy);
    out = await applyPlayHumanActionAsync(out.state, action, source, signal);
  }
  const elapsedMs = performance.now() - started;
  if (out.status !== "complete" || !out.state.result || observations.length !== 1 || responseElapsedMs === null) {
    throw new Error(`P3 case ${c.seed} did not complete: ${out.status}: ${out.reason ?? "missing/duplicate response"}`);
  }
  const total = out.state.public.stacks[0] + out.state.public.stacks[1] + out.state.result.payouts[0] + out.state.result.payouts[1];
  if (total !== p.startingPot + 2 * p.startingStack || out.state.result.net[0] + out.state.result.net[1] !== 0) {
    throw new Error("P3 continuation did not conserve real chips");
  }
  const observed = observations[0], log = handLog(out.state), logHash = await sha256(new TextEncoder().encode(canonicalSolverJson(log)));
  return { state: out.state, log, logHash, elapsedMs, responseElapsedMs: responseElapsedMs as number, previous, response: observed.snapshot,
    responseRequest: observed.request, provenance: observed.provenance };
}
