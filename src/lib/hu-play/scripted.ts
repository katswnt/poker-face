/** Scripted preflop and reproducible P1 play. This is not a preflop solver or a session ledger. */
import { mulberry32 } from "../poker/equity";
import { advanceAsync, applyHumanActionAsync, preparationRequest } from "./async-hand";
import { startHand, type HeadsUpHandState } from "./hand";
import { rangeFromBridge } from "./reach";
import { dealFromSeed, decisionDraw, fnv1a, sampleAction } from "./rng";
import type { PlayCatalog } from "./sources/library-data";
import { loadLibraryPolicySource } from "./sources/library";
import type { PreparedPolicySource } from "./sources/policy";

export const SCRIPTED_PREFLOP = Object.freeze({
  initialStack: 10000, postedPerPlayer: 250, stackBehind: 9750, startingPot: 550,
  externalDeadBlind: 50, chipsPerBigBlind: 100, flops: 12,
  label: "Preflop is scripted. Ranges are hand-written approximations, not solved. Flops are limited to 12 saved textures.",
});

export async function loadScriptedHand(catalog: PlayCatalog, seed: number, aiSeat: 0 | 1,
  signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || (aiSeat !== 0 && aiSeat !== 1)) throw new Error("Hand seed must be uint32 and seat must be 0 or 1");
  const formation = catalog.library.formation;
  if (catalog.library.spots.length !== 12 || formation.startingPot !== 550 || formation.effectiveStack !== 9750
    || formation.chipsPerBigBlind !== 100) throw new Error("Only the labelled 12-flop scripted SRP formation is supported");
  // Preserve the frozen admission cohort's seeded flop choice. Hole-card dealing uses an
  // independent stream, so fetching/solving order cannot influence either draw.
  const entry = catalog.library.spots[Math.floor(mulberry32(fnv1a(`hu-probe-flop|${seed}`))() * 12)];
  const library = await loadLibraryPolicySource(catalog, entry.id, signal, fetcher), spot = library.spot;
  const config = { handSeed: seed, aiSeat, startingPot: 550, startingStack: 9750, minimumBet: 100, flop: spot.board.flop };
  const deal = dealFromSeed(seed, config.flop, spot.ranges, aiSeat);
  const ranges = { ai: rangeFromBridge(spot.ranges[aiSeat]), human: rangeFromBridge(spot.ranges[1 - aiSeat]) };
  return { state: startHand(config, deal, ranges), library };
}

/** Offline audit driver, also browser-safe. Human-seat draws never enter source preparation. */
export async function playBotHand(initial: HeadsUpHandState, source: PreparedPolicySource, signal?: AbortSignal): Promise<HeadsUpHandState> {
  let outcome = await advanceAsync(initial, source, signal);
  for (let guard = 0; guard < 200; guard++) {
    if (outcome.status === "complete") return outcome.state;
    if (outcome.status !== "human") throw new Error(`Bot hand ${initial.config.handSeed} ${outcome.status}: ${outcome.reason}`);
    const state = outcome.state, policy = source.policy(preparationRequest(state));
    const draw = decisionDraw(fnv1a(`hu-probe-human|${state.config.handSeed}`), state.humanActions.length, state.public.path);
    const { action } = sampleAction(policy.distribution(state.deal.humanHand), draw);
    outcome = await applyHumanActionAsync(state, action, source, signal);
  }
  throw new Error("Bot hand exceeded the action bound");
}

/** Real starting-stack accounting, kept distinct from P0's zero-sum equal-pot-share origin. */
export function scriptedSettlement(state: HeadsUpHandState) {
  if (!state.result || state.config.startingPot !== 550 || state.config.startingStack !== 9750) throw new Error("A completed scripted hand is required");
  const finalStacks = [0, 1].map(p => state.public.stacks[p] + state.result!.payouts[p]) as [number, number];
  if (!finalStacks.every(Number.isSafeInteger) || finalStacks.some(n => n < 0) || finalStacks[0] + finalStacks[1] !== 20050) {
    throw new Error("Scripted hand does not conserve player stacks plus the external dead blind");
  }
  return { finalStacks, netSinceBeforeBlinds: finalStacks.map(n => n - 10000) as [number, number], externalDeadBlind: 50 as const };
}
